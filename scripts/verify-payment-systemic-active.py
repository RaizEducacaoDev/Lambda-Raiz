"""Certify the already-published candidate. No code/configuration update allowed."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import urllib.request

spec = importlib.util.spec_from_file_location('active_systemic_verifier', Path(__file__).with_name('deploy-payment-systemic.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
CODE = 'U8MIHNjNZ2iEeyt02SWx4q5TztrmrcpehRqBlf86OY8='
REVISION = 'd6c03245-d62e-4ef2-834b-22dbada25c1b'
OUT = Path('.verified-systemic-release')


def aws(*args):
    assert args[:2] in {('sts', 'get-caller-identity'), ('lambda', 'get-function'), ('lambda', 'get-function-configuration')}
    if args[0] == 'lambda':
        assert args[args.index('--function-name') + 1] == m.FUNCTION
    return m.aws(*args)


def main():
    assert aws('sts', 'get-caller-identity')['Account'] == m.ACCOUNT
    old = Path('.failed-systemic-attempt')
    bases, packages, manifests = list(old.rglob('baseline.json')), list(old.rglob('active-before.zip')), list(old.rglob('payment-systemic.manifest.json'))
    assert len(bases) == len(packages) == len(manifests) == 1
    baseline = json.loads(bases[0].read_text())
    manifest = json.loads(manifests[0].read_text())
    assert baseline['codeSha256'] == manifest['baselineCodeSha256'] == m.BASELINE
    assert manifest['candidateCodeSha256'] == CODE
    active = aws('lambda', 'get-function', '--function-name', m.FUNCTION)
    cfg = active['Configuration']
    assert cfg['CodeSha256'] == CODE and cfg['RevisionId'] == REVISION
    assert cfg['State'] == 'Active' and cfg['LastUpdateStatus'] == 'Successful'
    assert m.config_hash(cfg) == baseline['configurationSha256']
    with urllib.request.urlopen(active['Code']['Location'], timeout=30) as response:
        blob = response.read()
    assert m.sha(blob) == CODE
    entries, old_entries = m.package_entries(blob), m.package_entries(packages[0].read_bytes())
    assert m.sha(packages[0].read_bytes()) == m.BASELINE
    assert set(entries) == set(old_entries) and all(entries[k] == value for k, value in old_entries.items() if k != m.ENTRY)
    assert all(marker in entries[m.ENTRY] for marker in m.MARKERS)
    contracts = m.native_contracts(cfg['Environment']['Variables'])
    assert contracts == baseline['nativeContracts']
    assert m.sentinels() == baseline['sentinels']
    # These are the same offline-proven invalid requests. Neither can form a
    # valid financial creation, even if a preflight regression is encountered.
    canaries = m.negative_invocations()
    assert m.sentinels() == baseline['sentinels']
    final = aws('lambda', 'get-function-configuration', '--function-name', m.FUNCTION)
    assert final['CodeSha256'] == CODE and final['RevisionId'] == REVISION and m.config_hash(final) == baseline['configurationSha256']
    result = {'function': m.FUNCTION, 'previousCodeSha256': m.BASELINE, 'activeCodeSha256': CODE, 'revisionId': REVISION,
              'configurationSha256': m.config_hash(final), 'configurationPreserved': True, 'sentinelsPreserved': True,
              'financialWrites': False, 'dynamoWrites': False, 'deployedUtc': cfg['LastModified'], 'observedUtc': m.now(),
              'commit': None, 'verificationCommit': os.environ.get('GITHUB_SHA'), 'originalPublicationRunId': 41901379371,
              'verificationOnly': True, 'codePublicationPerformed': False, 'canaries': canaries, 'nativeContracts': contracts,
              'activeBundleSha256': hashlib.sha256(entries[m.ENTRY]).hexdigest(),
              'otherEntrySha256': {k: hashlib.sha256(v).hexdigest() for k, v in old_entries.items() if k != m.ENTRY}}
    OUT.mkdir(exist_ok=False)
    (OUT / 'baseline.json').write_text(json.dumps(baseline, indent=2), encoding='utf-8')
    (OUT / 'deployment.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        OUT.mkdir(exist_ok=True)
        (OUT / 'verification-failure.json').write_text(json.dumps({'verified': False, 'errorType': type(error).__name__,
            'noCodeOrConfigurationUpdatePerformed': True}), encoding='utf-8')
        raise SystemExit('Active candidate certification stopped; inspect sanitized evidence') from None
