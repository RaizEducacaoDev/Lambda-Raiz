"""One-function release; default is read-only. No operational reconciliation.

Only an explicit CI release mode may update code. Negative requests are fenced
by missing payment identity or missing product plus an impossible SQL INT branch.
No RM SaveRecord, Dynamo write or Zeev mutation is performed by this script.
"""
import base64
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

FUNCTION = 'lambda-raiz-prod-solicitacaoDePagamento'
TABLE = 'lambda-raiz-prod-pagamento-idpgto'
ACCOUNT = '757843862365'
REGION = 'sa-east-1'
BASELINE = 'Pt8n1Td1BarRUJWuGaQnMcNY5bYXcS8b3TvUaY28U0U='
REVISION = '8e19007a-a781-4bad-b4c9-3c749e5b9318'
CORE = 'cf802a6ef20cd6047e94e0ebdfe45da7ea923a36aafd103dada801cde6bb352e'
HOST = 'https://raizeducacao160286.rm.cloudtotvs.com.br:8051'
ENTRY = 'src/functions/rm/post/solicitacaoDePagamento.js'
CORE_ENTRY = 'src/functions/rm/post/solicitacaoDePagamento.core.cjs'
OUT = Path('.payment-systemic-release')
MARKERS = [b'RAIZ.PG.DOC2', b'DOCUMENT_TYPE_IS_NULL', b'#EVIDENCE#', b'registrarEvidencia',
           b'validarDadosAntesDaCriacao', b'DADOS_PAGAMENTO_INVALIDOS', b'confirmarCriacaoIncerta',
           b'encerrarAntesDoEnvio', b'chavePixParaComparacao']
SENTINELS = [(31, 228063, '453', 468), (31, 228080, '454', 469),
             (31, 228130, '455', 470), (11, 228310, None, None)]
CONTRACTS = {'RAIZ.PG.RECON': 'pagamento-reconciliacao.sql',
             'RAIZ.PG.RETRY': 'pagamento-retomada.sql',
             'RAIZ.PG.FISC': 'pagamento-natureza-fiscal.sql',
             'RAIZ.PG.DOC2': 'pagamento-documento-v2.sql'}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def write(name, value):
    OUT.mkdir(exist_ok=True)
    (OUT / name).write_text(json.dumps(value, indent=2), encoding='utf-8')


def aws(*args, payload=None):
    result = subprocess.run(['aws', *args, '--region', REGION, '--output', 'json'],
                            input=json.dumps(payload) if payload is not None else None,
                            capture_output=True, text=True)
    if result.returncode:
        code = re.search(r'An error occurred \(([^)]+)\)', result.stderr)
        raise RuntimeError('AWS ' + args[0] + '/' + args[1] + ': ' + (code.group(1) if code else 'CLI_ERROR'))
    return json.loads(result.stdout or '{}')


def sha(data):
    return base64.b64encode(hashlib.sha256(data).digest()).decode()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def config_hash(cfg):
    ephemeral = {'CodeSha256', 'CodeSize', 'LastModified', 'RevisionId', 'LastUpdateStatus',
                 'LastUpdateStatusReason', 'LastUpdateStatusReasonCode', 'State', 'StateReason', 'StateReasonCode'}
    return hashlib.sha256(canonical({k: v for k, v in cfg.items() if k not in ephemeral}).encode()).hexdigest()


def root(pk):
    return aws('dynamodb', 'get-item', '--table-name', TABLE, '--consistent-read',
               '--key', json.dumps({'pk': {'S': pk}})).get('Item')


def sentinels():
    result = {}
    for company, ticket, pg, lan in SENTINELS:
        for suffix in [''] + ([f'#FLAN#{lan}'] if lan else []):
            pk = f'prod#PG#{company}#{ticket}{suffix}'
            row = root(pk)
            assert row and row['state']['S'] == ('COMPLETE' if pg else 'CREATING'), 'Sentinel state drift'
            assert (row.get('pg', {}).get('S') == pg) if pg else ('pg' not in row), 'Sentinel movement drift'
            result[pk] = row
    return result


def canary_cases():
    common = {'tipoDaSolicitacao': 'PG', 'tipoDoPagamento': 'NF', 'tipoDeItem': 'Material',
              'codigoDaColigada2': '9', 'codigoDaFilial2': '2147483648',
              'codigoDoFornecedor': '0000154129', 'CODCOLCFO': '0', 'CODCOLPGTO': '9',
              'numeroDaNF': '999999999', 'serie': '1', 'dataDeEmissao': '04/11/2026',
              'dataDeEntrada': '', 'dataDeVencimento': '30/11/2026', 'valorTotal': '1,00',
              'chaveDeAcesso': '', 'itens': [{'codigoDoItem': '', 'qtdDoItem': '1',
                'valorDoItem': '1,00', 'desconto': '0'}], 'tributos': []}
    return [({**common, 'ticketRaiz': '999999990045'}, 'IDPGTO_NAO_CONFIRMADO'),
            ({**common, 'ticketRaiz': '999999990046', 'idpgto': '3'}, 'DADOS_PAGAMENTO_INVALIDOS')]


def canary_roots():
    return {c['ticketRaiz']: root('prod#PG#9#' + c['ticketRaiz']) for c, _ in canary_cases()}


def negative_invocations():
    evidence = []
    assert not any(canary_roots().values()), 'Synthetic ticket already reserved'
    with tempfile.TemporaryDirectory() as directory:
        for i, (fields, expected) in enumerate(canary_cases()):
            path = Path(directory) / f'negative-{i}.json'
            meta = aws('lambda', 'invoke', '--function-name', FUNCTION, '--invocation-type', 'RequestResponse',
                       '--payload', 'fileb:///dev/stdin', str(path), payload={'body': json.dumps(fields)})
            assert not meta.get('FunctionError'), 'Negative canary raised an invocation error'
            response = json.loads(path.read_text())
            assert response['statusCode'] == 422 and json.loads(response['body'])['code'] == expected, 'Negative canary did not fail closed'
            evidence.append({'ticket': fields['ticketRaiz'], 'statusCode': 422, 'code': expected})
    assert not any(canary_roots().values()), 'Negative canary unexpectedly reserved'
    return evidence


def native_contracts(env):
    assert env['STAGE'] == 'prod' and env['PAGAMENTO_IDPGTO_TABLE'] == TABLE
    assert env['RM_PROD'].rstrip('/') == HOST.replace(':8051', '')
    auth = 'Basic ' + base64.b64encode((env['USERNAME_TOTVS'] + ':' + env['PASSWORD_TOTVS']).encode()).decode()
    result = []
    for code, filename in CONTRACTS.items():
        normalize = lambda text: text.replace('\r\n', '\n').replace('\r', '\n').strip()
        expected = normalize((Path('sql') / filename).read_text(encoding='utf-8-sig'))
        envelope = ET.Element('{http://schemas.xmlsoap.org/soap/envelope/}Envelope')
        body = ET.SubElement(envelope, '{http://schemas.xmlsoap.org/soap/envelope/}Body')
        op = ET.SubElement(body, 'ReadRecord', xmlns='http://www.totvs.com/')
        for key, value in {'DataServerName': 'GlbConsSQLData', 'PrimaryKey': f'0;T;{code}',
                           'Contexto': f"CODCOLIGADA=0;CODSISTEMA=G;CODUSUARIO={env['USERNAME_TOTVS']}"}.items():
            ET.SubElement(op, key).text = value
        request = urllib.request.Request(HOST + '/wsDataServer/IwsDataServer', data=ET.tostring(envelope), headers={
            'Authorization': auth, 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': 'http://www.totvs.com/IwsDataServer/ReadRecord'})
        with urllib.request.urlopen(request, timeout=12) as response:
            soap = ET.fromstring(response.read())
        answer = soap.find('.//{http://www.totvs.com/}ReadRecordResult')
        assert answer is not None and answer.text, 'Contract SOAP result missing'
        rows = ET.fromstring(answer.text).findall('GConsSql')
        assert len(rows) == 1 and normalize(rows[0].findtext('SENTENCA', '')) == expected, 'Native SQL contract drift'
        if code in ['RAIZ.PG.RETRY', 'RAIZ.PG.DOC2']:
            assert 'NOLOCK' not in expected.upper() and 'READCOMMITTEDLOCK' in expected.upper(), 'Committed contract required'
        result.append({'code': code, 'sqlSha256': hashlib.sha256(expected.encode()).hexdigest(), 'definitionConfirmed': True})
    return result


def native_timings(env, timeout_seconds):
    """CI-to-RM sequential read proxy, not a claim about Lambda SDK latency."""
    auth = 'Basic ' + base64.b64encode((env['USERNAME_TOTVS'] + ':' + env['PASSWORD_TOTVS']).encode()).decode()
    stages = []

    def timed(name, request, xml=False):
        started = time.perf_counter()
        with urllib.request.urlopen(request, timeout=12) as response:
            data = response.read()
        elapsed = round((time.perf_counter() - started) * 1000, 2)
        parsed = ET.fromstring(data) if xml else json.loads(data)
        assert xml or (isinstance(parsed, list) and parsed), 'Native timing response contract missing'
        stages.append({'stage': name, 'durationMs': elapsed})
        return parsed

    def get(name, code, parameters):
        url = HOST + f'/api/framework/v1/consultaSQLServer/RealizaConsulta/{code}/0/T?' + urllib.parse.urlencode({'parameters': parameters})
        return timed(name, urllib.request.Request(url, headers={'Authorization': auth, 'Accept': 'application/json'}))

    envelope = ET.Element('{http://schemas.xmlsoap.org/soap/envelope/}Envelope')
    body = ET.SubElement(envelope, '{http://schemas.xmlsoap.org/soap/envelope/}Body')
    op = ET.SubElement(body, 'ReadRecord', xmlns='http://www.totvs.com/')
    for key, value in {'DataServerName': 'FinDadosPgtoDataBR', 'PrimaryKey': '11;0;0000173261;2',
                       'Contexto': 'CODSISTEMA=F;CODCOLIGADA=11;CODUSUARIO=p_heflo'}.items():
        ET.SubElement(op, key).text = value
    bank = timed('bank_read', urllib.request.Request(HOST + '/wsDataServer/IwsDataServer', data=ET.tostring(envelope), headers={
        'Authorization': auth, 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': 'http://www.totvs.com/IwsDataServer/ReadRecord'}), xml=True)
    result = bank.find('.//{http://www.totvs.com/}ReadRecordResult')
    assert result is not None and result.text, 'Bank timing SOAP contract missing'
    dataset = ET.fromstring(result.text)
    bank_rows = [r for r in dataset.iter() if r.tag.rsplit('}', 1)[-1] == 'FDadosPgto']
    assert len(bank_rows) == 1 and bank_rows[0].findtext('IDPGTO') == '2', 'Bank timing scope differs'
    scope = 'CODCOLIGADA=11;TICKET=999999990047'
    get('recon_preflight', 'RAIZ.PG.RECON', scope)
    doc = get('document', 'RAIZ.PG.DOC2', 'CODCOLIGADA=11;CODFILIAL=1;CODCOLCFO=0;CODCFO=0000173261;CODTMV=1.2.03;NUMERO=999999999;SERIE=~')
    assert all(r.get('DOC_VERSION') == 2 for r in doc), 'DOC2 timing version differs'
    get('fiscal', 'RAIZ.PG.FISC', 'CODCOLIGADA=11;CODFILIAL=1;CODCOLCFO=0;CODCFO=0000173261;IDNAT=166')
    get('recon_after_reservation', 'RAIZ.PG.RECON', scope)
    get('stock', 'TICKET.RAIZ.0041', 'CODCOLIGADA=11;CODFILIAL=1')
    get('final_census', 'RAIZ.PG.RETRY', scope)
    get('recon_before_dispatch', 'RAIZ.PG.RECON', scope)
    native_ms = round(sum(stage['durationMs'] for stage in stages), 2)
    window = timeout_seconds * 1000 - 25500
    # Root PutCommand is bounded at2s; local assembly allowance250ms. The three
    # SDK Gets remain explicitly unmeasured (CLI startup is not SDK latency).
    estimated = round(native_ms + 2250, 2)
    return {'observedUtc': now(), 'readOnly': True, 'source': 'CI_HTTP_SEQUENTIAL_PROXY',
            'lambdaTimeoutSeconds': timeout_seconds, 'minimumRemainingBeforeEvidenceMs': 25500,
            'availablePreflightWindowMs': window, 'nativeReadTotalMs': native_ms,
            'reservationWriteAllowanceMs': 2000, 'localAssemblyAllowanceMs': 250,
            'lambdaSdkReadLatencyNotMeasured': True, 'fullRuntimeLatencyProven': False,
            'estimatedPreflightMs': estimated, 'estimatedMarginMs': round(window - estimated, 2),
            'proxyFitsWithAllowance': window >= estimated, 'stages': stages}


def package_entries(blob):
    with zipfile.ZipFile(io.BytesIO(blob)) as package:
        result = {}
        for info in package.infolist():
            name = info.filename.replace('\\', '/')
            assert name not in result and not name.startswith('/') and '..' not in name.split('/'), 'Unsafe ZIP entry'
            result[name] = package.read(info)
        assert hashlib.sha256(result[CORE_ENTRY]).hexdigest() == CORE, 'Original core changed'
        return result


def wait_config():
    current = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
    if current.get('LastUpdateStatus') == 'InProgress':
        # A waiter can fail because the update finished unsuccessfully. Always
        # reread before deciding whether our own candidate can be rolled back.
        subprocess.run(['aws', 'lambda', 'wait', 'function-updated-v2', '--function-name', FUNCTION, '--region', REGION],
                       capture_output=True)
        current = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
        if current.get('LastUpdateStatus') == 'InProgress':
            raise RuntimeError('Publication still in progress; no rollback authorized')
    return current


def publish(cfg, candidate, backup, verify):
    candidate_sha = sha(candidate.read_bytes())
    published_revision = None
    try:
        response = aws('lambda', 'update-function-code', '--function-name', FUNCTION, '--revision-id', REVISION,
                       '--zip-file', 'fileb://' + str(candidate))
        published_revision = response.get('RevisionId')
        after = wait_config()
        assert after['CodeSha256'] == candidate_sha and after['State'] == 'Active' and after['LastUpdateStatus'] == 'Successful'
        assert published_revision and after['RevisionId'] == published_revision, 'Publication revision drift'
        assert config_hash(after) == config_hash(cfg), 'Configuration drift after publication'
        verify()
        final = wait_config()
        assert final['CodeSha256'] == candidate_sha and final['RevisionId'] == after['RevisionId'] and config_hash(final) == config_hash(cfg), 'Publication drift during canaries'
        return final
    except Exception as error:
        failure = {'observedUtc': now(), 'errorType': type(error).__name__, 'candidateCodeSha256': candidate_sha,
                   'rollbackAttempted': False, 'publicationOutcomeConfirmed': False}
        try:
            current = wait_config()
            ours = current['CodeSha256'] == candidate_sha and config_hash(current) == config_hash(cfg)
            if published_revision and current['RevisionId'] != published_revision:
                ours = False
            if ours:
                failure['rollbackAttempted'] = True
                try:
                    aws('lambda', 'update-function-code', '--function-name', FUNCTION, '--revision-id', current['RevisionId'],
                        '--zip-file', 'fileb://' + str(backup))
                except Exception as rollback_error:
                    failure['rollbackAcknowledgementErrorType'] = type(rollback_error).__name__
                restored = wait_config()
                failure['rollbackConfirmed'] = restored['CodeSha256'] == BASELINE and config_hash(restored) == config_hash(cfg) and restored['LastUpdateStatus'] == 'Successful'
                failure['publicationOutcomeConfirmed'] = failure['rollbackConfirmed']
            else:
                failure['rollbackSkippedReason'] = 'CURRENT_PACKAGE_OR_CONFIGURATION_NOT_OWNED'
        except Exception as recovery_error:
            failure['recoveryErrorType'] = type(recovery_error).__name__
        write('failed-release.json', failure)
        raise RuntimeError('Systemic release failed; inspect sanitized release evidence') from None


def main():
    assert aws('sts', 'get-caller-identity')['Account'] == ACCOUNT
    active = aws('lambda', 'get-function', '--function-name', FUNCTION)
    cfg = active['Configuration']
    assert cfg['CodeSha256'] == BASELINE and cfg['RevisionId'] == REVISION and cfg['State'] == 'Active' and cfg['LastUpdateStatus'] == 'Successful', 'Production baseline drift'
    assert cfg['Runtime'] == 'nodejs22.x' and cfg['Architectures'] == ['arm64'] and cfg['Handler'] == 'src/functions/rm/post/solicitacaoDePagamento.handler'
    before = sentinels()
    assert not any(canary_roots().values()), 'Synthetic ticket already reserved'
    contracts = native_contracts(cfg['Environment']['Variables'])
    timings = native_timings(cfg['Environment']['Variables'], cfg['Timeout'])
    write('native-timings.json', timings)
    assert timings['proxyFitsWithAllowance'], 'Native read proxy exceeds the pre-dispatch budget; review planning before publication'
    with urllib.request.urlopen(active['Code']['Location'], timeout=30) as response:
        blob = response.read()
    assert sha(blob) == BASELINE
    entries = package_entries(blob)
    for key, value in cfg['Environment']['Variables'].items():
        if re.search('PASSWORD|TOKEN|SECRET|ACCESS_KEY', key, re.I) and value:
            assert all(value.encode() not in data for data in entries.values()), 'Live secret embedded in baseline; do not archive'
    OUT.mkdir(exist_ok=True)
    backup = OUT / 'active-before.zip'
    backup.write_bytes(blob)
    write('baseline.json', {'observedUtc': now(), 'function': FUNCTION, 'codeSha256': BASELINE, 'revisionId': REVISION,
          'configurationSha256': config_hash(cfg), 'sentinels': before, 'nativeContracts': contracts})
    if os.environ.get('PAYMENT_SYSTEMIC_RELEASE_MODE') != 'deploy':
        return
    subprocess.run(['python3', 'scripts/build-pagamento-package.py', '--baseline', str(backup), '--expected-baseline-sha', BASELINE,
                    '--bundle', '.build/solicitacaoDePagamento.cjs', '--output', '.build/payment-systemic.zip'], check=True)
    subprocess.run(['node', 'scripts/smoke-pagamento-package.cjs'], check=True)
    candidate = Path('.build/payment-systemic.zip')
    new_entries = package_entries(candidate.read_bytes())
    assert set(new_entries) == set(entries) and all(new_entries[k] == v for k, v in entries.items() if k != ENTRY), 'Unrelated package entry changed'
    assert all(marker in new_entries[ENTRY] for marker in MARKERS), 'Candidate missing systemic control'
    for key, value in cfg['Environment']['Variables'].items():
        if re.search('PASSWORD|TOKEN|SECRET|ACCESS_KEY', key, re.I) and value:
            assert all(value.encode() not in data for data in new_entries.values()), 'Live secret embedded in candidate'
    native_contracts(cfg['Environment']['Variables'])
    current = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
    assert current['CodeSha256'] == BASELINE and current['RevisionId'] == REVISION and config_hash(current) == config_hash(cfg), 'Production drift before publication'
    canaries = []

    def verify():
        canaries.extend(negative_invocations())
        assert sentinels() == before, 'Completed/inactive sentinels changed'

    after = publish(cfg, candidate, backup, verify)
    evidence = {'function': FUNCTION, 'previousCodeSha256': BASELINE, 'activeCodeSha256': after['CodeSha256'],
                'revisionId': after['RevisionId'], 'configurationSha256': config_hash(after), 'configurationPreserved': True,
                'sentinelsPreserved': True, 'financialWrites': False, 'dynamoWrites': False, 'deployedUtc': now(),
                'commit': os.environ.get('GITHUB_SHA'), 'canaries': canaries, 'nativeContracts': contracts,
                'nativeReadTimingProxy': timings,
                'otherEntrySha256': {k: hashlib.sha256(v).hexdigest() for k, v in entries.items() if k != ENTRY}}
    write('deployment.json', evidence)
    (OUT / 'active-package.zip').write_bytes(candidate.read_bytes())
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        write('preflight-or-release-failure.json', {'observedUtc': now(), 'errorType': type(error).__name__, 'businessWrites': False})
        raise SystemExit('Systemic payment release stopped; inspect sanitized evidence') from None
