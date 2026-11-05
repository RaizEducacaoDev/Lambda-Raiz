"""Independent executor: package/configuration/route readback and negative HTTP only."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import urllib.error
import urllib.request


def load_release():
    path = Path(__file__).with_name('deploy-payment-systemic.py')
    spec = importlib.util.spec_from_file_location('systemic_release_readonly', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence-directory', required=True)
    args = parser.parse_args()
    m = load_release()
    directories = list(Path(args.evidence_directory).rglob('deployment.json'))
    assert len(directories) == 1
    deployment = json.loads(directories[0].read_text())
    baseline = json.loads(directories[0].with_name('baseline.json').read_text())
    assert deployment['function'] == m.FUNCTION and deployment['previousCodeSha256'] == m.BASELINE
    assert deployment['configurationPreserved'] and deployment['sentinelsPreserved']
    assert m.aws('sts', 'get-caller-identity')['Account'] == m.ACCOUNT
    active = m.aws('lambda', 'get-function', '--function-name', m.FUNCTION)
    cfg = active['Configuration']
    assert cfg['CodeSha256'] == deployment['activeCodeSha256'] and cfg['RevisionId'] == deployment['revisionId']
    assert cfg['State'] == 'Active' and cfg['LastUpdateStatus'] == 'Successful'
    assert m.config_hash(cfg) == deployment['configurationSha256'] == baseline['configurationSha256']
    with urllib.request.urlopen(active['Code']['Location'], timeout=30) as response:
        blob = response.read()
    assert m.sha(blob) == cfg['CodeSha256']
    entries = m.package_entries(blob)
    assert all(marker in entries[m.ENTRY] for marker in m.MARKERS), 'Active package missing a systemic control'
    assert {k: hashlib.sha256(v).hexdigest() for k, v in entries.items() if k != m.ENTRY} == deployment['otherEntrySha256']
    assert m.sentinels() == baseline['sentinels'], 'Completed/inactive sentinel changed'
    assert not any(m.canary_roots().values()), 'Synthetic ticket unexpectedly reserved'
    contracts = m.native_contracts(cfg['Environment']['Variables'])
    assert contracts == deployment['nativeContracts'], 'Native contract changed after deployment'
    timings = m.native_timings(cfg['Environment']['Variables'], cfg['Timeout'])
    policy = json.loads(m.aws('lambda', 'get-policy', '--function-name', m.FUNCTION)['Policy'])
    apis = set(re.findall(r':execute-api:sa-east-1:757843862365:([a-z0-9]+)/', json.dumps(policy)))
    routes = []
    for api in sorted(apis):
        for resource in m.aws('apigateway', 'get-resources', '--rest-api-id', api).get('items', []):
            if resource.get('path') != '/solicitacaoDePagamento':
                continue
            target = m.aws('apigateway', 'get-integration', '--rest-api-id', api, '--resource-id', resource['id'], '--http-method', 'POST')['uri']
            assert f':function:{m.FUNCTION}/invocations' in target, 'Route is not the unqualified payment function'
            url = f'https://{api}.execute-api.{m.REGION}.amazonaws.com/prod/solicitacaoDePagamento'
            negatives = []
            for fields, expected in m.canary_cases():
                request = urllib.request.Request(url, data=json.dumps(fields).encode(), headers={'Content-Type': 'application/json'})
                try:
                    with urllib.request.urlopen(request, timeout=30) as response:
                        status, answer = response.status, json.load(response)
                except urllib.error.HTTPError as error:
                    status, answer = error.code, json.load(error)
                assert status == 422 and answer.get('code') == expected, 'HTTP negative canary failed closed contract'
                negatives.append({'ticket': fields['ticketRaiz'], 'statusCode': status, 'code': expected})
            routes.append({'api': api, 'unqualifiedTarget': True, 'negativeCanaries': negatives})
    assert routes and not any(m.canary_roots().values()), 'Missing route or synthetic reservation'
    assert m.sentinels() == baseline['sentinels'], 'Sentinel drift after negative requests'
    final = m.aws('lambda', 'get-function-configuration', '--function-name', m.FUNCTION)
    assert final['CodeSha256'] == cfg['CodeSha256'] and final['RevisionId'] == cfg['RevisionId'] and m.config_hash(final) == m.config_hash(cfg)
    result = {'observedUtc': m.now(), 'verified': True, 'function': m.FUNCTION, 'activeCodeSha256': cfg['CodeSha256'],
              'revisionId': cfg['RevisionId'], 'configurationPreserved': True, 'otherPackageEntriesPreserved': True,
              'originalCorePreserved': True, 'sentinelsPreserved': True, 'negativeCanariesHaveNoReservations': True,
              'financialWrites': False, 'dynamoWrites': False, 'routes': routes, 'nativeContracts': contracts,
              'nativeReadTimingProxy': timings}
    directory = Path('.payment-systemic-readback')
    directory.mkdir(exist_ok=True)
    (directory / 'readback.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        directory = Path('.payment-systemic-readback')
        directory.mkdir(exist_ok=True)
        (directory / 'failure.json').write_text(json.dumps({'verified': False, 'errorType': type(error).__name__}), encoding='utf-8')
        raise SystemExit('Independent systemic readback failed; inspect sanitized evidence') from None
