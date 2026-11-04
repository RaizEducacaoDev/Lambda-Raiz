"""One-off restore of a proven pre-dispatch lease; no financial service calls.

The failed run, immutable artifacts and claim-before-POST implementation are
pinned. The only mutation restores the two original root lease attributes in a
transaction conditioned on the archived snapshot and absence of a bank claim.
"""
import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request

REPO = 'RaizEducacaoDev/Lambda-Raiz'
BRANCH = 'fix/idpgto-vinculo-obrigatorio'
RUN = 41902970926
COMMIT = 'b8ab25387235ea031638cf82cc9ceb8f8bf0332e'
ACCOUNT = '757843862365'
REGION = 'sa-east-1'
TABLE = 'lambda-raiz-prod-pagamento-idpgto'
PK = 'prod#PG#5#228007'
CLAIM = PK + '#BANK_REPAIR_ATTEMPT'
OWNER = '84dc0b2f-2eb8-4fc9-8470-77581824f937'
ARCHIVE = PK + '#BANK_REPAIR_LEASE#' + OWNER
RUN_URL = f'https://github.com/{REPO}/actions/runs/{RUN}'
ROOT_ATTRIBUTES = {'pk', 'digest', 'owner', 'lockUntil', 'state', 'pg',
                   'protocolVersion', 'recuperadaCriacaoIncerta', 'reconciliationEvidenceKey'}
ARTIFACTS = {
    'payment-bank-repair-evidence': (13359755887, 'sha256:3d42985922f4dc56cea247dc5f6f27202345f0065acd5d2a6b6959ffa612c26d'),
    'payment-bank-repair-lease-evidence': (13359930728, 'sha256:d57b9e43dc496a5d76522b4c26dd4f13328af02a0079975842530c34a7e66c2e'),
}
FILES = {
    'ticket-228007/attempt-228007.json': 'de864f878b507a971696bc045f26671db19a6e65673e872a591c12ceecc809b4',
    'summary.json': '237cd08e96dafca83bfc6c1e3f60cfcd668396d10e11ef8d99911456eede03cc',
    'failure-228007.json': '830b7a7c941ea59e2226df2f1fdc35b308a537f1edd1ebb9f55f123bb6d9f0cf',
}
LEASE_SHA = '43e9ebfcd03f367c7a0e04a25b59cd829f90dac346bc1f555774af90dcf84e1f'
SOURCE_PINS = {
    'scripts/repair-payment-bank-backlog.py': '944e20f45c12ff67a9126acdfd7895696f0bc5fe17104194c0a8e943c54fb2a4',
    'scripts/run-payment-bank-repair.py': '106b8d0d31f79f98b7bf9133f1e12aac3e7d1f8a495dce4c2ee7b82de3c2a024',
    'scripts/lease-payment-bank-backlog.py': 'd1f16160750ced503ed9e9fa42f112bdc4e0a8b06eb3441c2fdeb127b33ef832',
    '.github/workflows/payment-bank-repair.yml': '7cfb45ad7a474bcc52fbc8afa9bbf772838001e6f33cfb612e9eba4efa5cfd5c',
}


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def github(path):
    request = urllib.request.Request(f'https://api.github.com/repos/{REPO}/{path}', headers={
        'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
        'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def verify_provenance(fetch=github):
    run = fetch(f'actions/runs/{RUN}')
    require(run.get('id') == RUN and run.get('status') == 'completed' and
            run.get('conclusion') == 'failure' and run.get('run_attempt') == 1 and
            run.get('head_sha') == COMMIT and run.get('head_branch') == BRANCH and
            run.get('event') == 'push' and run.get('path') == '.github/workflows/payment-bank-repair.yml' and
            run.get('repository', {}).get('full_name') == REPO, 'FAILED_RUN_PROVENANCE_MISMATCH')
    artifacts = fetch(f'actions/runs/{RUN}/artifacts?per_page=100')
    require(artifacts.get('total_count') == 2 and len(artifacts.get('artifacts', [])) == 2, 'ARTIFACT_COVERAGE_MISMATCH')
    for name, (identifier, digest) in ARTIFACTS.items():
        rows = [a for a in artifacts['artifacts'] if a.get('name') == name]
        require(len(rows) == 1 and rows[0].get('id') == identifier and rows[0].get('digest') == digest and
                rows[0].get('expired') is False, 'FAILED_ARTIFACT_PIN_MISMATCH')
    for name, digest in SOURCE_PINS.items():
        source = fetch(f'contents/{name}?ref={COMMIT}')
        require(source.get('encoding') == 'base64' and sha(base64.b64decode(source['content'])) == digest,
                'CLAIM_BEFORE_POST_SOURCE_MISMATCH')
    return {'runId': RUN, 'commit': COMMIT, 'conclusion': 'failure', 'artifacts': ARTIFACTS, 'sourcePins': SOURCE_PINS}


def read_pinned(path, digest):
    raw = path.read_bytes()
    require(sha(raw) == digest, 'ARTIFACT_FILE_SHA_MISMATCH')
    return json.loads(raw)


def proof_from_artifacts(bank, lease):
    require({p.relative_to(bank).as_posix() for p in bank.rglob('*') if p.is_file()} == set(FILES),
            'FAILED_BANK_ARTIFACT_INVENTORY_CHANGED')
    require({p.relative_to(lease).as_posix() for p in lease.rglob('*') if p.is_file()} == {'lease-228007.json'},
            'FAILED_LEASE_ARTIFACT_INVENTORY_CHANGED')
    data = {name: read_pinned(bank / name, digest) for name, digest in FILES.items()}
    marker = data['ticket-228007/attempt-228007.json']
    require(marker.get('ticket') == 228007 and marker.get('state') == 'BLOCKED_BEFORE_DISPATCH' and
            marker.get('retryAllowed') is False, 'MARKER_NOT_PRE_DISPATCH')
    summary = data['summary.json']
    require(summary.get('mode') == 'apply' and summary.get('requestedTickets') == [228007] and
            summary.get('allVerified') is False and summary.get('workflow', {}).get('commit') == COMMIT and
            summary.get('results', [{}])[0].get('gate') == 'HTTP_RM_READRECORD_NETWORK_FAILURE',
            'FAILED_SUMMARY_MISMATCH')
    require(all(summary.get('codeSha256', {}).get(name) == digest for name, digest in SOURCE_PINS.items()),
            'FAILED_SUMMARY_SOURCE_PINS_MISMATCH')
    proof = read_pinned(lease / 'lease-228007.json', LEASE_SHA)
    validate_proof(proof)
    return proof


def validate_proof(proof):
    require((proof.get('version'), proof.get('ticket'), proof.get('company'), proof.get('idmov'), proof.get('idlan')) ==
            (1, 228007, 5, 165611, 634500), 'LEASE_TARGET_MISMATCH')
    require(proof.get('owner') == OWNER and proof.get('archiveKey') == ARCHIVE and
            proof.get('workflowRunUrl') == RUN_URL and proof.get('conditionMatched') is True and
            proof.get('rootBusinessUnchanged') is True, 'LEASE_PROVENANCE_MISMATCH')
    before, leased = proof['before'], proof['leasedRoot']
    require(set(before) == set(leased) == {'pk', 'digest', 'owner', 'lockUntil', 'state', 'pg'} and
            before['pk'] == leased['pk'] == {'S': PK} and leased['owner'] == {'S': OWNER} and
            before['state'] == {'S': 'CREATED'} and before['pg'] == {'S': '165611'}, 'LEASE_ROOT_SHAPE_MISMATCH')
    require(leased == {**before, 'owner': {'S': OWNER}, 'lockUntil': {'N': '1793823865169'}} and
            before['owner'] == {'S': '50a3027e-278f-4df8-bcea-1a973151edab'} and
            before['lockUntil'] == {'N': '1793541106676'}, 'LEASE_NOT_TWO_FIELD_CHANGE')


def expected_archive(proof):
    return {'pk': {'S': ARCHIVE}, 'original': {'M': proof['before']},
            'leaseOwner': proof['leasedRoot']['owner'], 'leaseUntil': proof['leasedRoot']['lockUntil']}


def equality(snapshot, absent=()):
    names, values, conditions = {}, {}, []
    for i, (name, value) in enumerate(sorted(snapshot.items())):
        names[f'#a{i}'], values[f':v{i}'] = name, value
        conditions.append(f'#a{i} = :v{i}')
    for i, name in enumerate(sorted(set(absent) - set(snapshot))):
        names[f'#missing{i}'] = name
        conditions.append(f'attribute_not_exists(#missing{i})')
    return {'ConditionExpression': ' AND '.join(conditions), 'ExpressionAttributeNames': names,
            'ExpressionAttributeValues': values}


def transaction(proof):
    update = {'TableName': TABLE, 'Key': {'pk': {'S': PK}}, **equality(proof['leasedRoot'], ROOT_ATTRIBUTES)}
    update['ExpressionAttributeNames'].update({'#restoreOwner': 'owner', '#restoreUntil': 'lockUntil'})
    update['ExpressionAttributeValues'].update({':restoreOwner': proof['before']['owner'], ':restoreUntil': proof['before']['lockUntil']})
    update['UpdateExpression'] = 'SET #restoreOwner = :restoreOwner, #restoreUntil = :restoreUntil'
    archive = {'TableName': TABLE, 'Key': {'pk': {'S': ARCHIVE}}, **equality(expected_archive(proof))}
    return {'TransactItems': [
        {'ConditionCheck': {'TableName': TABLE, 'Key': {'pk': {'S': CLAIM}}, 'ConditionExpression': 'attribute_not_exists(pk)'}},
        {'ConditionCheck': archive}, {'Update': update}]}


class Live:
    def aws(self, service, operation, payload):
        require((service, operation) in {('sts', 'get-caller-identity'), ('dynamodb', 'get-item'),
                                        ('dynamodb', 'transact-write-items')}, 'AWS_OPERATION_FORBIDDEN')
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'request.json'
            path.write_text(json.dumps(payload), encoding='utf-8')
            result = subprocess.run(['aws', service, operation, '--region', REGION, '--cli-input-json', 'file://' + str(path),
                '--output', 'json', '--no-cli-pager', '--cli-connect-timeout', '5', '--cli-read-timeout', '15'],
                capture_output=True, text=True, timeout=25,
                env={**os.environ, 'AWS_MAX_ATTEMPTS': '1', 'AWS_RETRY_MODE': 'standard', 'AWS_PAGER': ''})
        require(result.returncode == 0, 'AWS_CALL_FAILED_NO_RETRY')
        return json.loads(result.stdout or '{}')

    def get(self, key):
        require(key in (PK, CLAIM, ARCHIVE), 'KEY_OUT_OF_SCOPE')
        value = self.aws('dynamodb', 'get-item', {'TableName': TABLE, 'Key': {'pk': {'S': key}}, 'ConsistentRead': True})
        require(type(value) is dict, 'INVALID_GET_RESPONSE')
        item = value.get('Item', {})
        require(type(item) is dict, 'INVALID_GET_ITEM')
        return item

    def mutate(self, request):
        return self.aws('dynamodb', 'transact-write-items', request)


def restore(backend, proof, apply=False):
    validate_proof(proof)
    archive = expected_archive(proof)
    require(backend.get(CLAIM) == {}, 'DURABLE_CLAIM_EXISTS_OR_UNKNOWN')
    require(backend.get(ARCHIVE) == archive, 'IMMUTABLE_ARCHIVE_CHANGED')
    require(backend.get(PK) == proof['leasedRoot'], 'ROOT_CHANGED_DO_NOT_RESTORE')
    request = transaction(proof)
    lost = False
    if apply:
        try:
            backend.mutate(request)
        except Exception:
            lost = True  # Read back once, never repeat the transaction.
        require(backend.get(PK) == proof['before'], 'RESTORATION_NOT_CONFIRMED_NO_RETRY')
        require(backend.get(CLAIM) == {}, 'CLAIM_CHANGED_AFTER_RESTORE_NO_RETRY')
        require(backend.get(ARCHIVE) == archive, 'ARCHIVE_CHANGED_AFTER_RESTORE_NO_RETRY')
    return {'ticket': 228007, 'applied': apply, 'originalRootExactlyRestored': apply,
            'acknowledgementLost': lost, 'financialWrites': False, 'zeevWrites': False, 'lambdaInvoked': False,
            'mutationCalls': int(apply), 'transactionSha256': sha(canonical(request)),
            'originalRootSha256': sha(canonical(proof['before'])), 'leaseProofSha256': LEASE_SHA,
            'failedRun': RUN, 'retryAllowed': False, 'observedUtc': dt.datetime.now(dt.timezone.utc).isoformat()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    require(os.environ.get('GITHUB_REPOSITORY') == REPO and os.environ.get('GITHUB_EVENT_NAME') == 'push' and
            os.environ.get('GITHUB_REF') == 'refs/heads/' + BRANCH and os.environ.get('GITHUB_RUN_ATTEMPT') == '1',
            'EXECUTOR_CONTEXT_INVALID')
    out = Path('.payment-bank-cleanup-228007')
    out.mkdir(exist_ok=False)
    try:
        provenance = verify_provenance()
        proof = proof_from_artifacts(Path('.failed-bank-228007'), Path('.failed-bank-lease-228007'))
        backend = Live()
        require(backend.aws('sts', 'get-caller-identity', {}).get('Account') == ACCOUNT, 'AWS_ACCOUNT_MISMATCH')
        (out / 'verified-provenance.json').write_text(json.dumps(provenance, indent=2), encoding='utf-8')
        (out / 'verified-lease-proof.json').write_text(json.dumps(proof, indent=2), encoding='utf-8')
        result = restore(backend, proof, args.apply)
        (out / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result))
    except Exception as exc:
        result = {'state': 'STOPPED_NO_RETRY', 'errorType': type(exc).__name__,
                  'code': str(exc) if isinstance(exc, RuntimeError) else 'EXTERNAL_FAILURE', 'retryAllowed': False}
        (out / 'failure.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result))
        raise SystemExit(2)


if __name__ == '__main__':
    main()
