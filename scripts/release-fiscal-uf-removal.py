"""Remove only the fiscal geography guard from the active payment bundle.

No RM, Zeev or DynamoDB writes. Production code publication is revision guarded.
Artifacts contain hashes and fixed metadata, never configuration credentials.
"""
import argparse
import base64
import datetime as dt
import hashlib
import io
import json
import os
import pathlib
import re
import subprocess
import time
import urllib.request
import zipfile

ACCOUNT = '757843862365'
REGION = 'sa-east-1'
FUNCTION = 'lambda-raiz-prod-solicitacaoDePagamento'
BASE_REF = 'b8cc3942a3c3f6c8867eb0218261daeeaf91bdff'
EXPECTED_SHA = 'Pt8n1Td1BarRUJWuGaQnMcNY5bYXcS8b3TvUaY28U0U='
EXPECTED_REVISION = '8e19007a-a781-4bad-b4c9-3c749e5b9318'
SOURCE = 'src/functions/rm/post/pagamentoFiscal.ts'
ENTRY = 'src/functions/rm/post/solicitacaoDePagamento.js'
MARKER = b'// src/functions/rm/post/pagamentoFiscal.ts\n'
CONFIG_KEYS = ['Handler', 'Runtime', 'Architectures', 'Role', 'Timeout', 'MemorySize',
               'Environment', 'VpcConfig', 'Layers', 'TracingConfig', 'DeadLetterConfig',
               'FileSystemConfigs', 'EphemeralStorage', 'KMSKeyArn']
OUT = pathlib.Path('.fiscal-uf-release')


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha(data):
    return base64.b64encode(hashlib.sha256(data).digest()).decode()


def write(name, value):
    OUT.mkdir(exist_ok=True)
    (OUT / name).write_text(json.dumps(value, indent=2), encoding='utf-8')


def aws(*args):
    result = subprocess.run(['aws', *args, '--region', REGION, '--output', 'json'], capture_output=True, text=True)
    if result.returncode:
        match = re.search(r'An error occurred \(([^)]+)\)', result.stderr)
        raise RuntimeError('AWS operation failed: ' + (match.group(1) if match else 'CLI_ERROR'))
    return json.loads(result.stdout or '{}')


def parts(bundle):
    assert bundle.count(MARKER) == 1, 'Fiscal module boundary missing or ambiguous'
    start = bundle.index(MARKER)
    end = bundle.index(b'\n// src/', start + len(MARKER))
    return bundle[:start], bundle[start:end], bundle[end:]


def outside_sha(bundle):
    prefix, _, suffix = parts(bundle)
    return sha(prefix + b'\x00' + suffix)


def prepare():
    changed = subprocess.check_output(['git', 'diff', BASE_REF, '--name-only', '--', 'src'], text=True).splitlines()
    assert changed == [SOURCE], 'Unexpected runtime source changes'
    source = pathlib.Path(SOURCE)
    candidate = source.read_bytes()
    original = subprocess.check_output(['git', 'show', BASE_REF + ':' + SOURCE])
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    try:
        source.write_bytes(original)
        subprocess.run([npm, 'run', 'build:pagamento'], check=True)
        before = pathlib.Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    finally:
        source.write_bytes(candidate)
    subprocess.run([npm, 'run', 'build:pagamento'], check=True)
    after = pathlib.Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    old_prefix, old, old_suffix = parts(before)
    new_prefix, new, new_suffix = parts(after)
    assert old_prefix == new_prefix and old_suffix == new_suffix, 'Change extends outside fiscal module'
    assert b'ufBrasileira' in old and b'NATURE_ROUTE' in old
    assert b'ufBrasileira' not in new and b'NATURE_ROUTE' not in new and b'SUPPLIER_UF' not in new
    assert b'NATURE_ACTIVE' in new and b'NATURE_CODE' in new, 'Identity/active checks must remain'
    pathlib.Path('.build/fiscal-before.cjs').write_bytes(before)
    pathlib.Path('.build/fiscal-after.cjs').write_bytes(after)
    print(json.dumps({'prepared': True, 'onlyFiscalModuleChanged': True}))


def active():
    assert aws('sts', 'get-caller-identity')['Account'] == ACCOUNT
    result = aws('lambda', 'get-function', '--function-name', FUNCTION)
    cfg = result['Configuration']
    assert cfg['State'] == 'Active' and cfg['LastUpdateStatus'] == 'Successful'
    assert cfg['Handler'] == 'src/functions/rm/post/solicitacaoDePagamento.handler'
    assert cfg['Runtime'] == 'nodejs22.x' and cfg['Architectures'] == ['arm64']
    with urllib.request.urlopen(result['Code']['Location'], timeout=30) as response:
        package = response.read()
    assert sha(package) == cfg['CodeSha256']
    return cfg, package


def entries(package):
    with zipfile.ZipFile(io.BytesIO(package)) as archive:
        result = {info.filename.replace('\\', '/'): archive.read(info) for info in archive.infolist()}
        assert len(result) == len(archive.infolist()), 'Ambiguous ZIP paths'
        assert all(not pathlib.PurePosixPath(name).is_absolute() and '..' not in pathlib.PurePosixPath(name).parts for name in result)
        return result


def canary():
    # Identity validation rejects this payload before repository creation or RM transport.
    target = pathlib.Path('.build/fiscal-uf-canary.json')
    target.parent.mkdir(exist_ok=True)
    result = aws('lambda', 'invoke', '--function-name', FUNCTION, '--cli-binary-format', 'raw-in-base64-out',
                 '--payload', json.dumps({'body': json.dumps({'tipoDaSolicitacao': 'PG'})}), str(target))
    response = json.loads(target.read_text())
    assert 'FunctionError' not in result and response['statusCode'] == 422
    code = json.loads(response['body'])['code']
    assert isinstance(code, str) and re.fullmatch(r'[A-Z0-9_]{1,80}', code)
    return {'statusCode': 422, 'code': code, 'financialInputAbsent': True}


def release():
    cfg, package = active()
    write('baseline.json', {'observedUtc': now(), 'function': FUNCTION, 'codeSha256': cfg['CodeSha256'], 'revisionId': cfg['RevisionId']})
    assert cfg['CodeSha256'] == EXPECTED_SHA and cfg['RevisionId'] == EXPECTED_REVISION, 'Active version drift; no publication'
    original_entries = entries(package)
    old = parts(pathlib.Path('.build/fiscal-before.cjs').read_bytes())[1]
    new = parts(pathlib.Path('.build/fiscal-after.cjs').read_bytes())[1]
    prefix, active_fiscal, suffix = parts(original_entries[ENTRY])
    assert active_fiscal == old, 'Active fiscal module differs from reviewed source; no publication'
    patched = prefix + new + suffix
    assert outside_sha(patched) == outside_sha(original_entries[ENTRY])
    bundle = pathlib.Path('.build/fiscal-uf-active-patched.cjs')
    bundle.write_bytes(patched)
    backup = pathlib.Path('.build/fiscal-uf-baseline.zip')
    backup.write_bytes(package)
    target = pathlib.Path('.build/fiscal-uf-candidate.zip')
    subprocess.run(['python3', 'scripts/build-pagamento-package.py', '--baseline', str(backup),
                    '--expected-baseline-sha', EXPECTED_SHA, '--bundle', str(bundle), '--output', str(target)], check=True)
    subprocess.run(['node', 'scripts/smoke-pagamento-package.cjs'], check=True)
    candidate = target.read_bytes()
    candidate_entries = entries(candidate)
    assert set(candidate_entries) == set(original_entries)
    assert [name for name in candidate_entries if candidate_entries[name] != original_entries[name]] == [ENTRY]
    # Never upload function packages or any environment values as artifacts.
    candidate_sha = sha(candidate)
    baseline_canary = canary()
    before_update = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
    assert before_update['CodeSha256'] == EXPECTED_SHA and before_update['RevisionId'] == EXPECTED_REVISION
    assert all(before_update.get(k) == cfg.get(k) for k in CONFIG_KEYS)
    attempted = False
    try:
        attempted = True
        aws('lambda', 'update-function-code', '--function-name', FUNCTION, '--revision-id', EXPECTED_REVISION,
            '--zip-file', 'fileb://' + str(target))
        subprocess.run(['aws', 'lambda', 'wait', 'function-updated-v2', '--region', REGION, '--function-name', FUNCTION], check=True, capture_output=True)
        after, downloaded = active()
        assert after['CodeSha256'] == candidate_sha and downloaded == candidate
        assert all(after.get(k) == cfg.get(k) for k in CONFIG_KEYS), 'Function configuration drift'
        proof = canary()
        assert proof == baseline_canary, 'Unrelated input validation changed'
    except Exception:
        failure = {'observedUtc': now(), 'publicationAttempted': attempted, 'rollbackConfirmed': False}
        current = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
        if current['LastUpdateStatus'] == 'InProgress':
            subprocess.run(['aws', 'lambda', 'wait', 'function-updated-v2', '--region', REGION, '--function-name', FUNCTION], check=True, capture_output=True)
            current = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
        if current['CodeSha256'] == candidate_sha:
            aws('lambda', 'update-function-code', '--function-name', FUNCTION, '--revision-id', current['RevisionId'], '--zip-file', 'fileb://' + str(backup))
            subprocess.run(['aws', 'lambda', 'wait', 'function-updated-v2', '--region', REGION, '--function-name', FUNCTION], check=True, capture_output=True)
            failure['rollbackConfirmed'] = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)['CodeSha256'] == EXPECTED_SHA
        write('failed-release.json', failure)
        raise RuntimeError('Scoped release failed; inspect metadata and rollback status') from None
    report = {'deployedUtc': now(), 'function': FUNCTION, 'commit': os.environ.get('GITHUB_SHA'),
              'previousCodeSha256': EXPECTED_SHA, 'activeCodeSha256': candidate_sha, 'revisionId': after['RevisionId'],
              'configurationPreserved': True, 'onlyChangedEntry': ENTRY, 'outsideFiscalModuleSha256': outside_sha(patched),
              'fiscalModuleSha256': sha(new), 'entries': {name: sha(data) for name, data in candidate_entries.items()},
              'coreAndOtherEntriesPreserved': True, 'geographicGuardRemoved': True, 'canary': proof,
              'financialWrites': False, 'dynamoWrites': False, 'zeevWrites': False}
    write('deployment.json', report)
    print(json.dumps({k: v for k, v in report.items() if k != 'entries'}, indent=2))


def readback(evidence, monitor):
    reports = list(pathlib.Path(evidence).rglob('deployment.json'))
    assert len(reports) == 1
    report = json.loads(reports[0].read_text())
    if monitor:
        until = dt.datetime.fromisoformat(report['deployedUtc']).timestamp() + 300
        while time.time() < until:
            time.sleep(max(0, min(30, until - time.time())))
    cfg, package = active()
    assert cfg['CodeSha256'] == report['activeCodeSha256'] and cfg['RevisionId'] == report['revisionId']
    files = entries(package)
    assert {name: sha(data) for name, data in files.items()} == report['entries']
    assert outside_sha(files[ENTRY]) == report['outsideFiscalModuleSha256']
    module = parts(files[ENTRY])[1]
    assert sha(module) == report['fiscalModuleSha256']
    assert b'NATURE_ROUTE' not in module and b'ufBrasileira' not in module
    assert b'NATURE_ACTIVE' in module and b'NATURE_CODE' in module
    result = {'observedUtc': now(), 'function': FUNCTION, 'activeCodeSha256': cfg['CodeSha256'],
              'revisionId': cfg['RevisionId'], 'packageIndependentlyVerified': True, 'geographicGuardRemoved': True,
              'allEntryHashesConfirmed': True, 'financialWrites': False}
    if monitor:
        metrics = aws('cloudwatch', 'get-metric-statistics', '--namespace', 'AWS/Lambda', '--metric-name', 'Errors',
                      '--dimensions', 'Name=FunctionName,Value=' + FUNCTION, '--start-time', report['deployedUtc'],
                      '--end-time', now(), '--period', '60', '--statistics', 'Sum')
        result['monitorSeconds'] = round(time.time() - dt.datetime.fromisoformat(report['deployedUtc']).timestamp())
        result['lambdaExecutionErrors'] = sum(point['Sum'] for point in metrics['Datapoints'])
    write('monitor.json' if monitor else 'independent-readback.json', result)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'release', 'readback', 'monitor'])
    parser.add_argument('--evidence', default='.fiscal-uf-release')
    args = parser.parse_args()
    if args.mode == 'prepare':
        prepare()
    elif args.mode == 'release':
        release()
    else:
        readback(args.evidence, args.mode == 'monitor')
