"""Publish the authorized delegation of duplicate-document decisions to RM.

No ticket invocation, RM, Zeev or DynamoDB business write is performed here.
The active package is patched only where compiled modules match the baseline.
"""
import argparse
import datetime as dt
import importlib.util
import os
import re
from pathlib import Path
import subprocess
import time

spec = importlib.util.spec_from_file_location('scoped_release', Path(__file__).with_name('release-fiscal-uf-removal.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.OUT = Path('.native-duplication-release')
BASE_REF = '17a641e2bc48d51e79e903dc0dbccd0155076832'
BASE_SHA = 'ECffjgl6BpvRQrtHh3+O++D7/SAvTGAe8r9XTJqJIKE='
BASE_BUNDLE_SHA = '0u132fDr2uHv1IIb1Z7Majoqn7cBJCrvC8fj/OOC2n8='
BASE_REVISION = '29524d8b-327d-4389-a7ed-cab0b04aae2e'
SOURCES = ['src/functions/rm/post/pagamentoDiagnosticoSeguro.ts',
           'src/functions/rm/post/pagamentoEvidencia.ts',
           'src/functions/rm/post/pagamentoV2Idempotencia.ts',
           'src/functions/rm/post/solicitacaoDePagamentoSeguro.ts']


def module(bundle, source):
    marker = ('// ' + source + '\n').encode()
    starts = [match.start() for match in re.finditer(re.escape(marker), bundle)]
    assert starts, 'Missing module boundary'
    parts = []
    for start in starts:
        end = bundle.find(b'\n// src/', start + len(marker))
        parts.append(bundle[start:end if end >= 0 else len(bundle)])
    return b'\x00'.join(parts)


def outside(bundle):
    # Here the complete reviewed wrapper is pinned, including compiled imports.
    return m.sha(bundle)


def validate_candidate(bundle):
    service = module(bundle, SOURCES[-1])
    assert all(name not in service for name in [b'.consultarDocumento(', b'.consultarRetomada(', b'.buscarMovimentosPorTicket('])
    assert b'.saveRecord(' in service and b'primary_key_received' in service and b'.corrigirReserva(' in service
    assert b'resumirMensagemNegocioRm(retorno)' in service
    assert b'autoriza uma nova cria' not in module(bundle, SOURCES[1])


def patch(active, before, after):
    assert active == before, 'Active wrapper differs from the reviewed source baseline'
    assert before != after, 'Candidate is unchanged'
    validate_candidate(after)
    return after



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
    assert m.sha(before) == BASE_BUNDLE_SHA, 'Compiled baseline differs from active wrapper'
    assert patch(before, before, after) == after
    Path('.build/native-before.cjs').write_bytes(before)
    Path('.build/native-after.cjs').write_bytes(after)
    print('Prepared: active wrapper matches baseline and only four runtime sources changed')


def release():
    cfg, package = m.active()
    m.write('baseline.json', {'observedUtc': m.now(), 'function': m.FUNCTION,
        'codeSha256': cfg['CodeSha256'], 'revisionId': cfg['RevisionId']})
    assert cfg['CodeSha256'] == BASE_SHA and cfg['RevisionId'] == BASE_REVISION, 'Active version drift; no publication'
    original = m.entries(package)
    bundle = patch(original[m.ENTRY], Path('.build/native-before.cjs').read_bytes(),
                   Path('.build/native-after.cjs').read_bytes())
    backup, target, built = [Path('.build/' + name) for name in
                            ['native-baseline.zip', 'native-candidate.zip', 'native-patched.cjs']]
    backup.write_bytes(package)
    built.write_bytes(bundle)
    subprocess.run(['python3', 'scripts/build-pagamento-package.py', '--baseline', str(backup),
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
    try:
        m.aws('lambda', 'update-function-code', '--function-name', m.FUNCTION,
              '--revision-id', BASE_REVISION, '--zip-file', 'fileb://' + str(target))
        subprocess.run(['aws', 'lambda', 'wait', 'function-updated-v2', '--region', m.REGION,
                        '--function-name', m.FUNCTION], check=True, capture_output=True)
        after, downloaded = m.active()
        assert after['CodeSha256'] == candidate_sha and downloaded == candidate
        assert all(after.get(key) == cfg.get(key) for key in m.CONFIG_KEYS), 'Configuration changed'
        canary = m.canary()
        assert canary == baseline_canary
    except Exception:
        failure = {'observedUtc': m.now(), 'rollbackConfirmed': False}
        current = m.aws('lambda', 'get-function-configuration', '--function-name', m.FUNCTION)
        if current['LastUpdateStatus'] == 'InProgress':
            subprocess.run(['aws', 'lambda', 'wait', 'function-updated-v2', '--region', m.REGION,
                            '--function-name', m.FUNCTION], check=True, capture_output=True)
            current = m.aws('lambda', 'get-function-configuration', '--function-name', m.FUNCTION)
        if current['CodeSha256'] == candidate_sha:
            m.aws('lambda', 'update-function-code', '--function-name', m.FUNCTION,
                  '--revision-id', current['RevisionId'], '--zip-file', 'fileb://' + str(backup))
            subprocess.run(['aws', 'lambda', 'wait', 'function-updated-v2', '--region', m.REGION,
                            '--function-name', m.FUNCTION], check=True, capture_output=True)
            failure['rollbackConfirmed'] = m.aws('lambda', 'get-function-configuration',
                '--function-name', m.FUNCTION)['CodeSha256'] == BASE_SHA
        m.write('failed-release.json', failure)
        raise RuntimeError('Scoped release failed; inspect rollback metadata') from None
    report = {'deployedUtc': m.now(), 'function': m.FUNCTION, 'commit': os.environ.get('GITHUB_SHA'),
        'previousCodeSha256': BASE_SHA, 'activeCodeSha256': candidate_sha, 'revisionId': after['RevisionId'],
        'configurationPreserved': True, 'onlyChangedEntry': m.ENTRY, 'activeBundleSha256': outside(bundle),
        'modules': {source: m.sha(module(bundle, source)) for source in SOURCES},
        'entries': {name: m.sha(data) for name, data in files.items()}, 'canary': canary,
        'nativeDuplicateDecision': True, 'ticketRetriesPerformed': False,
        'financialWrites': False, 'dynamoWrites': False, 'zeevWrites': False}
    m.write('deployment.json', report)
    print(m.json.dumps({key: value for key, value in report.items() if key != 'entries'}, indent=2))


def readback(evidence, monitor):
    reports = list(Path(evidence).rglob('deployment.json'))
    assert len(reports) == 1
    report = m.json.loads(reports[0].read_text())
    if monitor:
        until = dt.datetime.fromisoformat(report['deployedUtc']).timestamp() + 300
        while time.time() < until:
            time.sleep(max(0, min(30, until - time.time())))
    cfg, package = m.active()
    assert cfg['CodeSha256'] == report['activeCodeSha256'] and cfg['RevisionId'] == report['revisionId']
    files = m.entries(package)
    validate_candidate(files[m.ENTRY])
    assert {name: m.sha(data) for name, data in files.items()} == report['entries']
    assert outside(files[m.ENTRY]) == report['activeBundleSha256']
    assert {source: m.sha(module(files[m.ENTRY], source)) for source in SOURCES} == report['modules']
    result = {'observedUtc': m.now(), 'function': m.FUNCTION, 'activeCodeSha256': cfg['CodeSha256'],
        'revisionId': cfg['RevisionId'], 'packageIndependentlyVerified': True,
        'allEntryHashesConfirmed': True, 'nativeDuplicateDecision': True, 'ticketRetriesPerformed': False}
    if monitor:
        metrics = m.aws('cloudwatch', 'get-metric-statistics', '--namespace', 'AWS/Lambda', '--metric-name', 'Errors',
            '--dimensions', 'Name=FunctionName,Value=' + m.FUNCTION, '--start-time', report['deployedUtc'],
            '--end-time', m.now(), '--period', '60', '--statistics', 'Sum')
        result['monitorSeconds'] = round(time.time() - dt.datetime.fromisoformat(report['deployedUtc']).timestamp())
        result['lambdaExecutionErrors'] = sum(point['Sum'] for point in metrics['Datapoints'])
    m.write('monitor.json' if monitor else 'independent-readback.json', result)
    print(m.json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'release', 'readback', 'monitor'])
    parser.add_argument('--evidence', default='.native-duplication-release')
    args = parser.parse_args()
    if args.mode == 'prepare':
        prepare()
    elif args.mode == 'release':
        release()
    else:
        readback(args.evidence, args.mode == 'monitor')
