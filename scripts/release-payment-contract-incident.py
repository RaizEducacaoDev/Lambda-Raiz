"""Revision-guarded payment contract hotfix. Never invoke a financial ticket.

Only the payment entrypoint changes. Original ZIP entries, legacy core and AWS
configuration remain intact. Evidence contains hashes, never secrets/packages.
"""
import argparse
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('release_primitives', Path(__file__).with_name('release-fiscal-uf-removal.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.OUT = Path('.payment-contract-release')
BASE_REF = 'c21a97afcffa0ee0298677d7fa435e55a427c6be'
BASE_SHA = 'YL4vIKotm0GuMQC1sMC8ellzldxJgi7tu9rT9m8EO2Q='
BASE_BUNDLE_SHA = 'QStwiGE3/AyPPJu6P+jyXRtI+lj2A/AjxPyieuHZNYs='
BASE_REVISION = '1e5b7eb2-1e94-4706-981c-466734da49d7'
SOURCES = ['src/functions/rm/post/pagamentoIdentidade.ts',
           'src/functions/rm/post/pagamentoV2Idempotencia.ts',
           'src/functions/rm/post/solicitacaoDePagamentoSeguro.ts']
MODULE_COUNTS = dict(zip(SOURCES, [1, 2, 1]))


def chunks(bundle):
    markers = list(re.finditer(rb'(?m)^// src/[^\r\n]+\n', bundle))
    result = {}
    for i, marker in enumerate(markers):
        name = marker.group()[3:-1].decode()
        end = markers[i + 1].start() if i + 1 < len(markers) else len(bundle)
        result.setdefault(name, []).append((marker.start(), end, bundle[marker.start():end]))
    assert all(len(result.get(name, [])) == count for name, count in MODULE_COUNTS.items()), 'Missing or ambiguous reviewed module'
    return result


def outside(bundle):
    result = bundle
    selected = [part for source in SOURCES for part in chunks(bundle)[source]]
    for start, end, _ in sorted(selected, reverse=True):
        result = result[:start] + b'// REVIEWED_MODULE\n' + result[end:]
    return result


def validate_candidate(bundle):
    parts = chunks(bundle)
    identity, repository, service = [b'\x00'.join(part[2] for part in parts[source]) for source in SOURCES]
    assert b'coligadas[0]?.valor || destino' in identity
    assert b'dado.ATIVO !== "1"' in identity and b'dado.IDPGTO !== String(chave.idPgto)' in identity
    assert b'DADOS_SOLICITACAO_ALTERADOS' in repository and b'MOVIMENTO_RESERVA_DIVERGENTE' in repository
    assert service.index(b'if (pgEntrada) await conferirMovimento(pgEntrada)') < service.index(b'await repo.concluida(')
    assert b'validarCadastro(dado, chave, entrada, planos)' in service and b'validarFilialBancaria(dado, filial)' in service
    assert b'await consultarPagamentoExistente(' in service and b'existing_payment_confirmed_readonly' in service
    for name in [b'.confirmarCriacaoPropria(', b'.selarBaseline(', b'.avancarParcelaPropria(', b'.conferirEnvioProprio(']:
        assert name in service, 'Durable continuation guard missing'
    assert service.index(b'.conferirEnvioProprio(') < service.rindex(b'.saveRecord(')
    assert b'resumirMensagemNegocioRm(retorno)' in service
    assert all(name not in service for name in [b'.consultarDocumento(', b'.buscarMovimentosPorTicket('])


def patch(active, before, after):
    assert m.sha(before) == BASE_BUNDLE_SHA, 'Compiled baseline drift'
    assert active == before, 'Active entrypoint differs from reviewed baseline'
    assert before != after, 'Candidate is unchanged'
    assert outside(before) == outside(after), 'Changes outside reviewed modules'
    validate_candidate(after)
    return after


def configuration_hash(cfg):
    selected = {key: cfg.get(key) for key in m.CONFIG_KEYS}
    return m.sha(json.dumps(selected, sort_keys=True, separators=(',', ':')).encode())


def prepare():
    changed = subprocess.check_output(['git', 'diff', BASE_REF, '--name-only', '--', 'src'], text=True).splitlines()
    assert changed == SOURCES, 'Unexpected runtime source changes'
    candidates = {source: Path(source).read_bytes() for source in SOURCES}
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    try:
        for source in SOURCES:
            Path(source).write_bytes(subprocess.check_output(['git', 'show', BASE_REF + ':' + source]))
        subprocess.run([npm, 'run', 'build:pagamento'], check=True)
        before = Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    finally:
        for source, data in candidates.items():
            Path(source).write_bytes(data)
    subprocess.run([npm, 'run', 'build:pagamento'], check=True)
    after = Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    patch(before, before, after)
    Path('.build/contract-before.cjs').write_bytes(before)
    Path('.build/contract-after.cjs').write_bytes(after)
    print(json.dumps({'prepared': True, 'baselineBundleVerified': True,
                      'onlyReviewedModulesChanged': True, 'runtimeSources': SOURCES}))


def wait_updated():
    subprocess.run(['aws', 'lambda', 'wait', 'function-updated-v2', '--region', m.REGION,
                    '--function-name', m.FUNCTION], check=True, capture_output=True)


def release():
    assert os.environ.get('GITHUB_EVENT_NAME') == 'push', 'Only the scoped push workflow can publish'
    assert os.environ.get('GITHUB_REF') == 'refs/heads/fix/payment-contract-incident-20261105'
    assert os.environ.get('GITHUB_RUN_ATTEMPT') == '1', 'Never rerun publication automatically'
    cfg, package = m.active()
    assert cfg['CodeSha256'] == BASE_SHA and cfg['RevisionId'] == BASE_REVISION, 'Active version drift; no publication'
    config_sha = configuration_hash(cfg)
    original = m.entries(package)
    bundle = patch(original[m.ENTRY], Path('.build/contract-before.cjs').read_bytes(),
                   Path('.build/contract-after.cjs').read_bytes())
    backup, target, built = [Path('.build/' + name) for name in
                            ['contract-baseline.zip', 'contract-candidate.zip', 'contract-patched.cjs']]
    backup.write_bytes(package)
    built.write_bytes(bundle)
    subprocess.run([sys.executable, 'scripts/build-pagamento-package.py', '--baseline', str(backup),
        '--expected-baseline-sha', BASE_SHA, '--bundle', str(built), '--output', str(target)], check=True)
    subprocess.run(['node', 'scripts/smoke-pagamento-package.cjs'], check=True)
    candidate = target.read_bytes()
    files = m.entries(candidate)
    assert set(files) == set(original)
    assert [name for name in files if files[name] != original[name]] == [m.ENTRY]
    candidate_sha = m.sha(candidate)
    baseline_canary = m.canary()
    current = m.aws('lambda', 'get-function-configuration', '--function-name', m.FUNCTION)
    assert current['CodeSha256'] == BASE_SHA and current['RevisionId'] == BASE_REVISION
    assert configuration_hash(current) == config_sha
    try:
        m.aws('lambda', 'update-function-code', '--function-name', m.FUNCTION,
              '--revision-id', BASE_REVISION, '--zip-file', 'fileb://' + str(target))
        wait_updated()
        after, downloaded = m.active()
        assert after['CodeSha256'] == candidate_sha and downloaded == candidate
        assert configuration_hash(after) == config_sha, 'Configuration changed'
        canary = m.canary()
        assert canary == baseline_canary
    except Exception:
        failure = {'observedUtc': m.now(), 'rollbackConfirmed': False}
        current = m.aws('lambda', 'get-function-configuration', '--function-name', m.FUNCTION)
        if current['LastUpdateStatus'] == 'InProgress':
            wait_updated()
            current = m.aws('lambda', 'get-function-configuration', '--function-name', m.FUNCTION)
        # Never overwrite another deployment or configuration change, including
        # a successful concurrent deployment during an ambiguous AWS response.
        if current['CodeSha256'] == candidate_sha and configuration_hash(current) == config_sha:
            m.aws('lambda', 'update-function-code', '--function-name', m.FUNCTION,
                  '--revision-id', current['RevisionId'], '--zip-file', 'fileb://' + str(backup))
            wait_updated()
            restored, downloaded = m.active()
            failure['rollbackConfirmed'] = (restored['CodeSha256'] == BASE_SHA and
                downloaded == package and configuration_hash(restored) == config_sha)
        m.write('failed-release.json', failure)
        raise RuntimeError('Scoped publication failed; inspect rollback metadata') from None
    report = {'deployedUtc': m.now(), 'function': m.FUNCTION, 'commit': os.environ.get('GITHUB_SHA'),
        'previousCodeSha256': BASE_SHA, 'activeCodeSha256': candidate_sha, 'revisionId': after['RevisionId'],
        'configurationPreserved': True, 'configurationSha256': config_sha, 'onlyChangedEntry': m.ENTRY,
        'activeBundleSha256': m.sha(bundle), 'outsideReviewedModulesSha256': m.sha(outside(bundle)),
        'entries': {name: m.sha(data) for name, data in files.items()}, 'canary': canary,
        'ticketRetriesPerformed': False, 'financialTicketInvocations': False,
        'financialWritesByRelease': False, 'dynamoWritesByRelease': False, 'zeevWrites': False}
    m.write('deployment.json', report)
    print(json.dumps({key: value for key, value in report.items() if key != 'entries'}, indent=2))


def readback(evidence, monitor):
    reports = list(Path(evidence).rglob('deployment.json'))
    assert len(reports) == 1
    report = json.loads(reports[0].read_text())
    if monitor:
        until = dt.datetime.fromisoformat(report['deployedUtc']).timestamp() + 300
        while time.time() < until:
            time.sleep(max(0, min(30, until - time.time())))
    cfg, package = m.active()
    assert cfg['CodeSha256'] == report['activeCodeSha256'] and cfg['RevisionId'] == report['revisionId']
    assert configuration_hash(cfg) == report['configurationSha256']
    files = m.entries(package)
    assert {name: m.sha(data) for name, data in files.items()} == report['entries']
    assert m.sha(files[m.ENTRY]) == report['activeBundleSha256']
    assert m.sha(outside(files[m.ENTRY])) == report['outsideReviewedModulesSha256']
    validate_candidate(files[m.ENTRY])
    result = {'observedUtc': m.now(), 'function': m.FUNCTION, 'activeCodeSha256': cfg['CodeSha256'],
        'revisionId': cfg['RevisionId'], 'packageIndependentlyVerified': True,
        'allEntryHashesConfirmed': True, 'configurationPreserved': True, 'financialTicketInvocations': False}
    if monitor:
        metrics = m.aws('cloudwatch', 'get-metric-statistics', '--namespace', 'AWS/Lambda', '--metric-name', 'Errors',
            '--dimensions', 'Name=FunctionName,Value=' + m.FUNCTION, '--start-time', report['deployedUtc'],
            '--end-time', m.now(), '--period', '60', '--statistics', 'Sum')
        result['monitorSeconds'] = round(time.time() - dt.datetime.fromisoformat(report['deployedUtc']).timestamp())
        result['lambdaExecutionErrors'] = sum(point['Sum'] for point in metrics['Datapoints'])
    m.write('monitor.json' if monitor else 'independent-readback.json', result)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'release', 'readback', 'monitor'])
    parser.add_argument('--evidence', default=str(m.OUT))
    args = parser.parse_args()
    if args.mode == 'prepare':
        prepare()
    elif args.mode == 'release':
        release()
    else:
        readback(args.evidence, args.mode == 'monitor')
