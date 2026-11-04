"""Publish the authorized removal of the permanent CREATING block only.

No ticket invocation, RM, Zeev or DynamoDB business write is performed here.
The active package is patched only where compiled modules match the baseline.
"""
import argparse
import datetime as dt
import importlib.util
import os
from pathlib import Path
import subprocess
import time

spec = importlib.util.spec_from_file_location('scoped_release', Path(__file__).with_name('release-fiscal-uf-removal.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.OUT = Path('.uncertain-creation-release')
BASE_REF = '6f833a3f2dd6916496e2d0253e74db208ef2bc51'
BASE_SHA = 'U8MIHNjNZ2iEeyt02SWx4q5TztrmrcpehRqBlf86OY8='
BASE_REVISION = 'd6c03245-d62e-4ef2-834b-22dbada25c1b'
SOURCES = ['src/functions/rm/post/pagamentoV2Idempotencia.ts',
           'src/functions/rm/post/solicitacaoDePagamentoSeguro.ts']
MARKERS = {
    SOURCES[0]: ('// ' + SOURCES[0] + '\nvar ConflitoPagamento = class extends Error {').encode(),
    SOURCES[1]: ('// ' + SOURCES[1] + '\nasync function executarPagamentoSeguro(').encode(),
}


def module(bundle, source):
    marker = MARKERS[source]
    assert bundle.count(marker) == 1, 'Missing or ambiguous module boundary'
    start = bundle.index(marker)
    end = bundle.index(b'\n// src/', start + len(marker))
    return bundle[start:end]


def outside(bundle):
    for source in SOURCES:
        bundle = bundle.replace(module(bundle, source), ('// ' + source + '\n').encode() + b'REVIEWED_MODULE', 1)
    return m.sha(bundle)


def patch(active, before, after):
    assert outside(before) == outside(after), 'Build changed outside the reviewed modules'
    patched = active
    for source in SOURCES:
        old, new = module(before, source), module(after, source)
        assert module(active, source) == old, 'Active module differs from reviewed baseline'
        patched = patched.replace(old, new, 1)
    assert outside(patched) == outside(active), 'Unrelated active code changed'
    assert b'nunca nova cria' not in module(patched, SOURCES[0])
    assert b'solicite a confer' not in module(patched, SOURCES[1])
    return patched


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
    assert patch(before, before, after) == after
    Path('.build/uncertain-before.cjs').write_bytes(before)
    Path('.build/uncertain-after.cjs').write_bytes(after)
    print('Prepared: only the two authorized modules changed')


def release():
    cfg, package = m.active()
    m.write('baseline.json', {'observedUtc': m.now(), 'function': m.FUNCTION,
        'codeSha256': cfg['CodeSha256'], 'revisionId': cfg['RevisionId']})
    assert cfg['CodeSha256'] == BASE_SHA and cfg['RevisionId'] == BASE_REVISION, 'Active version drift; no publication'
    original = m.entries(package)
    bundle = patch(original[m.ENTRY], Path('.build/uncertain-before.cjs').read_bytes(),
                   Path('.build/uncertain-after.cjs').read_bytes())
    backup, target, built = [Path('.build/' + name) for name in
                            ['uncertain-baseline.zip', 'uncertain-candidate.zip', 'uncertain-patched.cjs']]
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
        'configurationPreserved': True, 'onlyChangedEntry': m.ENTRY, 'outsideModulesSha256': outside(bundle),
        'modules': {source: m.sha(module(bundle, source)) for source in SOURCES},
        'entries': {name: m.sha(data) for name, data in files.items()}, 'canary': canary,
        'permanentCreatingBlockRemoved': True, 'ticketRetriesPerformed': False,
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
    assert {name: m.sha(data) for name, data in files.items()} == report['entries']
    assert outside(files[m.ENTRY]) == report['outsideModulesSha256']
    assert {source: m.sha(module(files[m.ENTRY], source)) for source in SOURCES} == report['modules']
    result = {'observedUtc': m.now(), 'function': m.FUNCTION, 'activeCodeSha256': cfg['CodeSha256'],
        'revisionId': cfg['RevisionId'], 'packageIndependentlyVerified': True,
        'allEntryHashesConfirmed': True, 'permanentCreatingBlockRemoved': True, 'ticketRetriesPerformed': False}
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
    parser.add_argument('--evidence', default='.uncertain-creation-release')
    args = parser.parse_args()
    if args.mode == 'prepare':
        prepare()
    elif args.mode == 'release':
        release()
    else:
        readback(args.evidence, args.mode == 'monitor')
