"""Incident 226374 ONLY: archive an adjudication and reserve a NEW controlled test.

Default is read-only. Never invokes the financial Lambda, writes RM, changes Zeev,
deletes a reservation or changes IAM/TTL. --apply additionally requires the explicit
business authorization flag; that flag must NOT be supplied before user confirmation.
The supplied digest is an operator-attested intent, not computed from partial fields.
Runtime validation remains mandatory when the user subsequently tests the workflow.
"""
import argparse
import base64
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import socket
import ssl
import sys
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile

ACCOUNT = '757843862365'
REGION = 'sa-east-1'
FUNCTION = 'lambda-raiz-prod-solicitacaoDePagamento'
TABLE = 'lambda-raiz-prod-pagamento-idpgto'
PK = 'prod#PG#9#226374'
DIGEST = 'f6d5bff690ca5fe785705ea08e586f3f4fb4454f9c191ccb77ca450ed1ed3932'
OWNER = '0e4b5367-a872-4668-a268-6f8c8e119db1'
LOCK = 1793630719027
REQUEST = '4efffdfd-b6d7-4a87-857f-fe99421654d3'
HOST = 'https://raizeducacao160286.rm.cloudtotvs.com.br:8051'
ZEEV = 'https://raizeducacao.zeev.it'
ROOT = Path(__file__).resolve().parents[1]
READS = {('sts', 'get-caller-identity'), ('lambda', 'get-function'),
         ('lambda', 'get-function-configuration'), ('dynamodb', 'get-item'),
         ('logs', 'filter-log-events')}
WRITES = {('dynamodb', 'put-item'), ('dynamodb', 'update-item')}
FIELDS = {
    'codigoDaColigada2': '9', 'codigoDaFilial2': '3', 'codigoDoFornecedor': '0000154129',
    'numeroDaNF': '1141', 'serieDaNF': '', 'idpgto': '3', 'codcolpgto': '9',
    'idPagamento': '9$_$0$_$0000154129$_$3', 'idDoMovimento': '', 'idDoLancamento': '',
    'valorTotalDoPagamento': '5.273,40', 'qtdParcelas': '1', 'dataDeEmissao': '22/10/2026',
    'dataDeEntrada': '27/10/2026', 'dataDeVencimento': '10/11/2026',
    'tipoDaSolicitacao': 'PG', 'tipoDoPagamento': 'NF', 'tipoDeItem': 'Serviço',
    'formaDePagamento': 'PIX', 'codigoPagamento': 'S',
    'idDaNaturezaFiscal': '23', 'codigoDaNaturezaFiscal': '1.949.01',
    'tributosCodigoDaReceita': '17080', 'codigoDoCentroDeCusto': '3.08.001',
}


class GateError(RuntimeError):
    pass


def require(ok, message):
    if not ok:
        raise GateError(message)


def canon(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def sha(value):
    return hashlib.sha256(canon(value).encode('utf-8')).hexdigest()


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def validate_root(item):
    expected = {'pk': {'S': PK}, 'state': {'S': 'CREATING'}, 'digest': {'S': DIGEST},
                'owner': {'S': OWNER}, 'lockUntil': {'N': str(LOCK)}}
    require(isinstance(item, dict) and all(item.get(k) == v for k, v in expected.items()),
            'Historical reservation changed; no recovery')
    require(not any(k in item for k in ('pg', 'protocolVersion', 'reconciliationEvidenceKey',
                                       'recuperadaCriacaoIncerta')),
            'Historical reservation has an unexpected recovery/payment marker')
    require(LOCK < int(time.time() * 1000), 'Historical lease is not expired')


def validate_closure(proof):
    require(proof.get('originalRequestId') == REQUEST and all(proof.get(k) is True for k in
            ('endSeen', 'reportSeen', 'logCoverageComplete')), 'Original END/REPORT or log coverage not proven')
    require(proof.get('creationCallsAfterOriginal') == 0, 'Later native creation requires separate reconciliation')
    require(re.fullmatch('[a-f0-9]{64}', proof.get('sourceSha256', '')) and proof.get('auditRunId'),
            'Closure source fingerprint missing')
    observed = dt.datetime.fromisoformat(proof.get('observedUtc', '').replace('Z', '+00:00'))
    require(observed.tzinfo is not None and -30 <= (dt.datetime.now(dt.timezone.utc) - observed).total_seconds() <= 900,
            'Closure proof expired; refresh read-only audit')


def validate_observation(p):
    require(p['fields'] == FIELDS, 'Current Zeev intent is not the exact controlled test')
    rows = p['original']
    require(isinstance(rows, list) and len(rows) == 2 and {r.get('ROW_KIND') for r in rows} == {'MOV', 'LAN'},
            'Independent census contains missing/extra candidates')
    for row in rows:
        expected = {'OBS_VERSION': 1, 'TOTAL_MOVEMENTS': 1, 'TOTAL_LAUNCHES': 1,
                    'CODCOLIGADA': 9, 'CODFILIAL': 3, 'CODCOLCFO': 0, 'CODCFO': '0000154129',
                    'IDMOV': 78497, 'TICKET': '110229', 'ORFAO': 0, 'TICKET_MATCH': 0,
                    'SERIE': '1', 'CODTDO': '002', 'VALOR': 5100}
        require(all(row.get(k) == v for k, v in expected.items()), 'Historical native identity changed')
        for key in ('RECCREATEDON', 'RECMODIFIEDON'):
            value = dt.datetime.fromisoformat(row.get(key, ''))
            require(value.date() < dt.date(2026, 11, 2), 'Historical record modified after original attempt')
        require(str(row.get('DATAEMISSAO', '')).startswith('2025-12-01'), 'Historical issue date changed')
        if row['ROW_KIND'] == 'LAN':
            require(row.get('IDLAN') == 161973 and str(row.get('STATUS')) == '1' and
                    row.get('VALORBAIXADO') == 5100 and row.get('DOCUMENTO') == '000000114/01',
                    'Historical paid launch changed')
        else:
            require(row.get('DOCUMENTO') == '000000114' and row.get('STATUS') == 'Q',
                    'Historical movement changed')
    retry = p['retry']
    require(isinstance(retry, list) and len(retry) == 1, 'Ticket census incomplete')
    expected = {'RETOMADA_VERSION': 1, 'REQUEST_COMPANY': 9, 'REQUEST_TICKET': '226374',
                'TOTAL_MOVEMENTS': 0, 'TOTAL_LAUNCHES': 0, 'ROW_KIND': 'EMPTY'}
    require(all(retry[0].get(k) == v for k, v in expected.items()) and
            all(retry[0].get(k) is None for k in ('IDMOV', 'IDLAN', 'CODCOLIGADA', 'BOLETO_COUNT')),
            'Ticket already has native effects')
    doc = p['document']
    require(isinstance(doc, list) and len(doc) == 1, 'Document census incomplete')
    expected = {'DOC_VERSION': 1, 'REQUEST_COMPANY': 9, 'REQUEST_BRANCH': 3,
                'REQUEST_SUPPLIER_COMPANY': 0, 'REQUEST_SUPPLIER': '0000154129',
                'REQUEST_MOVEMENT_TYPE': '1.2.03', 'REQUEST_NUMBER': '1141', 'REQUEST_SERIES': '',
                'HAS_MOVEMENT_TYPE': 1, 'MASK': '#########', 'PRINCIPAL_COUNT': 1,
                'EFFECTIVE_SERIES': '1', 'EFFECTIVE_NUMBER': '000001141',
                'EFFECTIVE_DOCUMENT_TYPE': '002', 'SERIES_MATCH_COUNT': 1, 'DOC_MATCH_COUNT': 0}
    require(all(doc[0].get(k) == v for k, v in expected.items()) and doc[0].get('IDMOV') is None,
            'Controlled test document preflight failed')
    require(p['bank'] == {'CODCOLIGADA': '9', 'CODCOLCFO': '0', 'CODCFO': '0000154129',
                         'IDPGTO': '3', 'ATIVO': '1', 'FORMAPAGAMENTO': 'S'},
            'Selected bank identity is not active/coherent')
    require(p['laterDispatches'] == 0, 'A later native dispatch requires separate reconciliation')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise GateError('HTTP redirect rejected')


class Live:
    def __init__(self, apply, expected_sha):
        self.apply = apply
        self.expected_sha = expected_sha
        self.opener = urllib.request.build_opener(NoRedirect())

    def aws(self, service, operation, payload):
        require((service, operation) in READS or (self.apply and (service, operation) in WRITES),
                'AWS operation is not allowlisted')
        if service == 'dynamodb':
            require(payload.get('TableName') == TABLE, 'DynamoDB target mismatch')
            if operation == 'put-item':
                require(payload.get('Item', {}).get('pk', {}).get('S', '').startswith(PK + '#ADJUDICATION#') and
                        payload.get('ConditionExpression') == 'attribute_not_exists(pk)', 'Archive target/condition mismatch')
            elif operation == 'update-item':
                require(payload.get('Key') == {'pk': {'S': PK}}, 'CAS root target mismatch')
        if service == 'lambda':
            require(payload.get('FunctionName') == FUNCTION, 'Lambda target mismatch')
        # AWS CLI retries are disabled. In particular, no transparent CAS replay.
        env = {**os.environ, 'AWS_MAX_ATTEMPTS': '1', 'AWS_RETRY_MODE': 'standard', 'AWS_PAGER': ''}
        import tempfile
        with tempfile.TemporaryDirectory(prefix='reconcile-226374-') as directory:
            path = Path(directory) / 'request.json'
            path.write_text(json.dumps(payload), encoding='utf-8')
            result = subprocess.run(['aws', service, operation, '--region', REGION,
                                     '--cli-input-json', 'file://' + str(path), '--output', 'json',
                                     '--no-cli-pager', '--cli-connect-timeout', '5', '--cli-read-timeout', '15'],
                                    capture_output=True, text=True, timeout=25, env=env)
        if result.returncode:
            # Never emit raw CLI messages, Lambda environment, or remote bodies.
            error = re.search(r'An error occurred \(([^)]+)\)', result.stderr)
            raise GateError('AWS ' + (error.group(1) if error else 'CLI_ERROR'))
        return json.loads(result.stdout or '{}')

    def http(self, request, stage):
        require(stage in ('ZEEV_INSTANCE', 'RM_READRECORD', 'RM_QUERY', 'AWS_PACKAGE'), 'Unknown HTTP stage')
        try:
            with self.opener.open(request, timeout=15) as response:
                value = response.read(15_000_001)
        except urllib.error.HTTPError as error:
            status = error.code if isinstance(error.code, int) and 100 <= error.code <= 599 else 'UNKNOWN'
            raise GateError(f'HTTP {stage} status={status}') from None
        except urllib.error.URLError as error:
            # Classify locally; never include remote addresses, exception text or certificates.
            reason = error.reason
            category = ('TLS_CERTIFICATE' if isinstance(reason, ssl.SSLCertVerificationError) else
                        'TLS_ERROR' if isinstance(reason, ssl.SSLError) else
                        'DNS_ERROR' if isinstance(reason, socket.gaierror) else
                        'NETWORK_TIMEOUT' if isinstance(reason, TimeoutError) else
                        'CONNECTION_REFUSED' if isinstance(reason, ConnectionRefusedError) else
                        'NETWORK_ERROR')
            raise GateError(f'HTTP {stage} status={category}') from None
        except TimeoutError:
            raise GateError(f'HTTP {stage} status=TIMEOUT') from None
        require(len(value) <= 15_000_000, 'Remote response exceeds limit')
        return value

    @staticmethod
    def zeev_token(env):
        # Read-only, in-memory override; never mutate or return it in AWS configuration/evidence.
        return os.environ.get('RECONCILE_ZEEV_TOKEN') or env.get('TOKEN_ZEEV', '')

    def config(self):
        cfg = self.aws('lambda', 'get-function-configuration', {'FunctionName': FUNCTION})
        env = cfg.get('Environment', {}).get('Variables', {})
        require(cfg.get('CodeSha256') == self.expected_sha and cfg.get('State') == 'Active' and
                cfg.get('LastUpdateStatus') == 'Successful', 'Runtime hash/state changed')
        require(env.get('STAGE') == 'prod' and env.get('PAGAMENTO_IDPGTO_TABLE') == TABLE and
                env.get('RM_PROD', '').rstrip('/') == HOST.replace(':8051', '') and
                env.get('ZEEV_PROD', '').rstrip('/') == ZEEV, 'Runtime environment mismatch')
        require(all(env.get(k) for k in ('USERNAME_TOTVS', 'PASSWORD_TOTVS')) and self.zeev_token(env),
                'Credentials unavailable')
        return cfg, env

    def bootstrap(self):
        require(self.aws('sts', 'get-caller-identity', {}).get('Account') == ACCOUNT, 'AWS account mismatch')
        cfg, _ = self.config()
        function = self.aws('lambda', 'get-function', {'FunctionName': FUNCTION})
        require(function['Configuration']['CodeSha256'] == self.expected_sha, 'Runtime changed during package read')
        url = function['Code']['Location']
        require(urllib.parse.urlsplit(url).scheme == 'https', 'Non-HTTPS package URL')
        package = self.http(urllib.request.Request(url), 'AWS_PACKAGE')
        require(base64.b64encode(hashlib.sha256(package).digest()).decode() == self.expected_sha,
                'Downloaded package hash mismatch')
        with zipfile.ZipFile(io.BytesIO(package)) as archive:
            bundles = [archive.read(n) for n in archive.namelist() if n.endswith('solicitacaoDePagamento.js')]
        require(len(bundles) == 1 and all(m in bundles[0] for m in
                (b'corrigirReserva', b'confirmarCriacaoIncerta', b'encerrarAntesDoEnvio', b'RAIZ.PG.RETRY')),
                'Runtime does not contain the reviewed recovery protocol')
        return cfg['RevisionId']

    def read_record(self, env, server, key):
        require(server in ('GlbConsSQLData', 'FinDadosPgtoDataBR'), 'ReadRecord server not allowlisted')
        envelope = ET.Element('{http://schemas.xmlsoap.org/soap/envelope/}Envelope')
        body = ET.SubElement(envelope, '{http://schemas.xmlsoap.org/soap/envelope/}Body')
        op = ET.SubElement(body, 'ReadRecord', xmlns='http://www.totvs.com/')
        context = 'CODCOLIGADA=0;CODSISTEMA=G;' if server == 'GlbConsSQLData' else 'CODCOLIGADA=9;CODSISTEMA=F;'
        for name, value in {'DataServerName': server, 'PrimaryKey': key,
                            'Contexto': context + 'CODUSUARIO=' + env['USERNAME_TOTVS']}.items():
            ET.SubElement(op, name).text = value
        raw = self.http(urllib.request.Request(HOST + '/wsDataServer/IwsDataServer', data=ET.tostring(envelope),
                    headers={'Authorization': self.auth(env), 'Content-Type': 'text/xml;charset=UTF-8',
                             'SOAPAction': 'http://www.totvs.com/IwsDataServer/ReadRecord'}), 'RM_READRECORD')
        require(b'<!DOCTYPE' not in raw.upper() and b'<!ENTITY' not in raw.upper(), 'Unsafe XML')
        result = ET.fromstring(raw).find('.//{http://www.totvs.com/}ReadRecordResult')
        require(result is not None and result.text, 'ReadRecord result absent')
        require('<!DOCTYPE' not in result.text.upper() and '<!ENTITY' not in result.text.upper(), 'Unsafe dataset')
        return ET.fromstring(result.text)

    @staticmethod
    def auth(env):
        return 'Basic ' + base64.b64encode((env['USERNAME_TOTVS'] + ':' + env['PASSWORD_TOTVS']).encode()).decode()

    def query(self, env, code, params=''):
        require(code in ('RAIZ.PG.ORIG', 'RAIZ.PG.RETRY', 'RAIZ.PG.DOC'), 'Native query not allowlisted')
        url = HOST + '/api/framework/v1/consultaSQLServer/RealizaConsulta/' + code + '/0/T?'
        return json.loads(self.http(urllib.request.Request(url + urllib.parse.urlencode({'parameters': params}),
                   headers={'Authorization': self.auth(env), 'Accept': 'application/json'}), 'RM_QUERY'))

    def later_dispatches(self):
        count, token, seen = 0, None, set()
        for _ in range(100):
            params = {'logGroupName': '/aws/lambda/' + FUNCTION, 'startTime': 1793630631376,
                      'endTime': int(time.time() * 1000), 'filterPattern': '"226374" "transport_call_started"'}
            if token:
                params['nextToken'] = token
            result = self.aws('logs', 'filter-log-events', params)
            for event in result.get('events', []):
                require(REQUEST not in event.get('message', ''), 'Unexpected repeated original dispatch')
                count += 1
            token = result.get('nextToken')
            if not token:
                return count
            require(token not in seen, 'Incomplete log pagination')
            seen.add(token)
        raise GateError('Log coverage page limit reached')

    def observe(self):
        cfg, env = self.config()
        for code, filename in [('RAIZ.PG.ORIG', 'pagamento-legado-226374.sql'),
                               ('RAIZ.PG.RETRY', 'pagamento-retomada.sql'), ('RAIZ.PG.DOC', 'pagamento-documento.sql')]:
            records = self.read_record(env, 'GlbConsSQLData', '0;T;' + code).findall('GConsSql')
            normalize = lambda value: value.replace('\r\n', '\n').replace('\r', '\n').strip()
            require(len(records) == 1 and normalize(records[0].findtext('SENTENCA', '')) ==
                    normalize((ROOT / 'sql' / filename).read_text(encoding='utf-8-sig')), 'Native SQL contract drift')
        params = [('formFieldNames', key) for key in FIELDS] + [('useCache', 'false'), ('showPendingInstanceTasks', 'true')]
        raw = self.http(urllib.request.Request(ZEEV + '/api/2/instances/226374?' + urllib.parse.urlencode(params),
                   headers={'Authorization': 'Bearer ' + self.zeev_token(env), 'Accept': 'application/json'}), 'ZEEV_INSTANCE')
        data = json.loads(raw)
        require(data.get('id') == 226374 and data.get('flow', {}).get('id') == 299, 'Zeev ticket/flow mismatch')
        require(any(task.get('active') is True and task.get('task', {}).get('name') ==
                    'T07 - Realizar Análise fiscal' for task in data.get('instanceTasks', [])),
                'Expected active fiscal task is absent')
        fields = {}
        for field in data.get('formFields', []):
            if field.get('name') in FIELDS:
                require(field['name'] not in fields, 'Duplicate selected Zeev field')
                fields[field['name']] = str(field.get('value') or '')
        # Explicitly requested absent optional fields may be omitted by Zeev.
        for key in ('idDoMovimento', 'idDoLancamento', 'serieDaNF'):
            fields.setdefault(key, '')
        banks = self.read_record(env, 'FinDadosPgtoDataBR', '9;0;0000154129;3').findall('FDadosPgto')
        require(len(banks) == 1, 'Native bank record absent/ambiguous')
        bank = {k: banks[0].findtext(k) for k in ('CODCOLIGADA', 'CODCOLCFO', 'CODCFO', 'IDPGTO', 'ATIVO', 'FORMAPAGAMENTO')}
        observation = {'fields': fields, 'bank': bank,
                       'original': self.query(env, 'RAIZ.PG.ORIG'),
                       'retry': self.query(env, 'RAIZ.PG.RETRY', 'CODCOLIGADA=9;TICKET=226374'),
                       'document': self.query(env, 'RAIZ.PG.DOC', 'CODCOLIGADA=9;CODFILIAL=3;CODCOLCFO=0;CODCFO=0000154129;CODTMV=1.2.03;NUMERO=1141;SERIE=~'),
                       'laterDispatches': self.later_dispatches(), 'codeSha256': cfg['CodeSha256'],
                       'revisionId': cfg['RevisionId']}
        cfg_after, _ = self.config()
        require(cfg_after['RevisionId'] == cfg['RevisionId'], 'Runtime changed while observing')
        validate_observation(observation)
        return observation

    def get(self, key):
        return self.aws('dynamodb', 'get-item', {'TableName': TABLE, 'ConsistentRead': True,
                                               'Key': {'pk': {'S': key}}}).get('Item', {})

    def archive(self, item):
        self.aws('dynamodb', 'put-item', {'TableName': TABLE, 'Item': item,
                                         'ConditionExpression': 'attribute_not_exists(pk)'})

    def update(self, request):
        return self.aws('dynamodb', 'update-item', request)


def cas_request(before, new_digest, evidence_key, new_owner, now_ms):
    validate_root(before)
    require(re.fullmatch('[a-f0-9]{64}', new_digest or '') and new_digest != DIGEST, 'New intent digest invalid')
    names, values, clauses = {}, {}, []
    # Protect every observed attribute, including legacy attributes we do not interpret.
    for i, (key, value) in enumerate(sorted(before.items())):
        names['#old' + str(i)] = key
        values[':old' + str(i)] = value
        clauses.append('#old' + str(i) + ' = :old' + str(i))
    names.update({'#state': 'state', '#owner': 'owner'})
    values.update({':reserved': {'S': 'RESERVED'}, ':owner': {'S': new_owner}, ':digest': {'S': new_digest},
                   ':lease': {'N': str(now_ms - 1)}, ':protocol': {'N': '2'}, ':evidence': {'S': evidence_key},
                   ':now': {'N': str(now_ms)}})
    clauses += ['attribute_not_exists(pg)', 'attribute_not_exists(protocolVersion)',
                'attribute_not_exists(reconciliationEvidenceKey)', 'attribute_not_exists(recuperadaCriacaoIncerta)',
                'lockUntil < :now']
    return {'TableName': TABLE, 'Key': {'pk': {'S': PK}},
            'UpdateExpression': 'SET #state = :reserved, #owner = :owner, digest = :digest, lockUntil = :lease, '
                                'protocolVersion = :protocol, reconciliationEvidenceKey = :evidence',
            'ConditionExpression': ' AND '.join(clauses), 'ExpressionAttributeNames': names,
            'ExpressionAttributeValues': values, 'ReturnValues': 'ALL_NEW'}


def reconcile(backend, *, apply, authorized, new_digest, closure):
    require(not apply or authorized, 'Controlled production test authorization is required before apply')
    require(re.fullmatch('[a-f0-9]{64}', new_digest or '') and new_digest != DIGEST, 'New intent digest invalid')
    validate_closure(closure)
    revision = backend.bootstrap()
    before = backend.get(PK)
    validate_root(before)
    observation = backend.observe()
    validate_observation(observation)
    require(observation['revisionId'] == revision, 'Runtime revision drift')
    require(observation['codeSha256'] == closure.get('activeCodeSha256'), 'Closure refers to another runtime')
    manifest = {'version': 1, 'ticket': 226374, 'root': PK, 'originalSnapshot': before,
                'originalSnapshotSha256': sha(before), 'newDigest': new_digest,
                'newIntentOperatorAttested': True, 'controlledTestInvoice': '1141',
                'conclusion': 'nenhum efeito persistido identificado; original encerrada',
                'historicalRollbackProven': False, 'originalClosureEvidenceSha256': sha(closure),
                'observationSha256': sha(observation), 'observations': observation,
                'newAttemptProtocolVersion': 2, 'originalProtocolVersion': None}
    evidence_key = PK + '#ADJUDICATION#' + sha(manifest)
    output = {'mode': 'apply' if apply else 'dry-run', 'observedUtc': utc(), 'manifest': manifest,
              'evidenceKey': evidence_key, 'financialWrites': False, 'lambdaInvoked': False,
              'zeevWrites': False, 'reservationDeleted': False, 'applied': False}
    if not apply:
        return output
    archive = {'pk': {'S': evidence_key}, 'manifestJson': {'S': canon(manifest)}, 'manifestSha256': {'S': sha(manifest)}}
    try:
        backend.archive(archive)
    except Exception:
        # Existing history or lost acknowledgement: only byte-equivalent readback permits progression.
        require(backend.get(evidence_key) == archive, 'Immutable archive absent/different; no CAS')
    require(backend.get(evidence_key) == archive, 'Immutable archive readback differs; no CAS')
    final_started = time.monotonic()
    final = backend.observe()
    validate_observation(final)
    require(final == observation, 'Native/Zeev/runtime evidence changed; no CAS')
    require(backend.get(PK) == before, 'Reservation changed after archive; no CAS')
    validate_closure(closure)
    require(time.monotonic() - final_started <= 60, 'Final verification exceeded freshness window; no CAS')
    now_ms = int(time.time() * 1000)
    owner = str(uuid.uuid4())
    request = cas_request(before, new_digest, evidence_key, owner, now_ms)
    expected = {**before, 'state': {'S': 'RESERVED'}, 'owner': {'S': owner}, 'digest': {'S': new_digest},
                'lockUntil': {'N': str(now_ms - 1)}, 'protocolVersion': {'N': '2'},
                'reconciliationEvidenceKey': {'S': evidence_key}}
    acknowledgement_lost = False
    try:
        backend.update(request)
    except Exception:
        acknowledgement_lost = True
    # ALWAYS read independently; NEVER automatically replay the CAS.
    after = backend.get(PK)
    output.update(after=after, acknowledgementLost=acknowledgement_lost)
    if after == expected:
        output.update(applied=True, outcome='NEW_ATTEMPT_RESERVED')
    elif after == before:
        output['outcome'] = 'NOT_APPLIED_NO_RETRY'
    elif after.get('reconciliationEvidenceKey') == {'S': evidence_key}:
        output['outcome'] = 'CONCURRENT_PROGRESS_DO_NOT_RETRY'
    else:
        output['outcome'] = 'CONCURRENT_OR_UNKNOWN_STATE_DO_NOT_RETRY'
    return output


def main():
    require(sys.version_info >= (3, 11), 'Python 3.11+ required for native RM fractional ISO timestamps')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--controlled-test-nf1141', action='store_true', help='Only after explicit user confirmation')
    parser.add_argument('--new-digest', required=True)
    parser.add_argument('--expected-code-sha', required=True)
    parser.add_argument('--closure-proof', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=Path('.legacy-226374-reconciliation.json'))
    args = parser.parse_args()
    require(re.fullmatch(r'[A-Za-z0-9+/]{43}=', args.expected_code_sha), 'Expected code SHA must be base64 SHA256')
    require(not args.apply or args.controlled_test_nf1141, 'Explicit controlled test authorization missing')
    proof = json.loads(args.closure_proof.read_text(encoding='utf-8-sig'))
    result = reconcile(Live(args.apply, args.expected_code_sha), apply=args.apply,
                       authorized=args.controlled_test_nf1141, new_digest=args.new_digest, closure=proof)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'mode': result['mode'], 'applied': result['applied'],
                      'outcome': result.get('outcome', 'READ_ONLY_PLAN'), 'financialWrites': False}))
    return 0 if not args.apply or result['applied'] else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        # Do not print remote bodies, credentials or unsanitized network/CLI errors.
        print(json.dumps({'status': 'STOPPED_NO_AUTOMATIC_RETRY', 'errorType': type(error).__name__,
                          'gate': str(error) if isinstance(error, GateError) else 'Read/validation failed'}))
        raise SystemExit(2)
