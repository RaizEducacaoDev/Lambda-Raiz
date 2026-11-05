"""Read two exact DynamoDB snapshots of nine roots/claims; never acquire a lease.

The full typed items are retained for future review, not synthesized from old
summaries. Financial ownership is not certified by this AWS-only audit.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

ACCOUNT = '757843862365'
REGION = 'sa-east-1'
TABLE = 'lambda-raiz-prod-pagamento-idpgto'
FUNCTION = 'lambda-raiz-prod-solicitacaoDePagamento'
REPOSITORY = 'RaizEducacaoDev/Lambda-Raiz'
BRANCH = 'fix/idpgto-vinculo-obrigatorio'
WORKFLOW = '.github/workflows/payment-bank-nine-readonly.yml'
RUNTIME = {'codeSha256': 'nP8Tf7PTJVjQcqhA+QwqCkA69wFPlJ+kYe/8QHKR5/A=',
           'revisionId': '6aec6184-80d8-47eb-b386-32cab252c086'}
TARGETS = {227386: (18, 407685, 2191110), 226610: (25, 42677, 79094),
           228103: (8, 565011, 870364), 228158: (8, 565012, 870365),
           228198: (8, 565013, 870366), 228275: (8, 565014, 870367),
           228793: (2, 278473, 751379), 229064: (8, 565842, 871423),
           229070: (8, 565843, 871424)}
ROOT_ATTRIBUTES = {'pk', 'digest', 'owner', 'state', 'pg', 'lockUntil', 'protocolVersion',
                   'recuperadaCriacaoIncerta', 'reconciliationEvidenceKey'}
CLAIM_ATTRIBUTES = {'pk', 'nonce', 'ticket', 'company', 'idlan', 'leaseOwner',
                    'planSha256', 'targetFieldsSha256', 'state', 'observedUtc'}
OUT = Path('.payment-bank-nine-readonly')
REPO_ROOT = Path(__file__).resolve().parents[1]
FUNCTION_QUERY = ('{FunctionName:FunctionName,FunctionArn:FunctionArn,CodeSha256:CodeSha256,'
                  'RevisionId:RevisionId,State:State,LastUpdateStatus:LastUpdateStatus,'
                  'Stage:Environment.Variables.STAGE,PaymentTable:Environment.Variables.PAGAMENTO_IDPGTO_TABLE}')
DDB_QUERY = "{Item: Item, ItemPresent: contains(keys(@), 'Item')}"


class AuditError(Exception):
    pass


def require(ok, code):
    if not ok:
        raise AuditError(code)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    ensure_ascii=False, allow_nan=False).encode('utf-8')).hexdigest()


def root_key(ticket):
    require(type(ticket) is int and ticket in TARGETS, 'TICKET_OUTSIDE_NINE_CASE_SCOPE')
    return f'prod#PG#{TARGETS[ticket][0]}#{ticket}'


def claim_key(ticket):
    return root_key(ticket) + '#BANK_REPAIR_ATTEMPT'


ALLOWED_KEYS = frozenset(key for ticket in TARGETS for key in (root_key(ticket), claim_key(ticket)))


def validate_request(service, operation, payload):
    require(type(payload) is dict, 'AWS_REQUEST_NOT_OBJECT')
    if (service, operation) == ('sts', 'get-caller-identity'):
        require(payload == {}, 'STS_REQUEST_CHANGED')
    elif (service, operation) == ('lambda', 'get-function-configuration'):
        require(payload == {'FunctionName': FUNCTION}, 'FUNCTION_SCOPE_CHANGED')
    elif (service, operation) == ('dynamodb', 'get-item'):
        require(set(payload) == {'TableName', 'Key', 'ConsistentRead'}, 'DYNAMODB_REQUEST_FIELDS_CHANGED')
        require(payload['TableName'] == TABLE and payload['ConsistentRead'] is True, 'TABLE_OR_CONSISTENT_READ_CHANGED')
        key = payload['Key']
        require(type(key) is dict and set(key) == {'pk'} and type(key['pk']) is dict
                and set(key['pk']) == {'S'} and key['pk']['S'] in ALLOWED_KEYS, 'DYNAMODB_KEY_OUTSIDE_SCOPE')
    else:
        raise AuditError('AWS_OPERATION_NOT_READONLY_ALLOWLISTED')


class ReadOnlyAws:
    def __init__(self):
        self.deadline = time.monotonic() + 360

    def call(self, service, operation, payload):
        validate_request(service, operation, payload)
        require(time.monotonic() < self.deadline, 'AUDIT_READ_DEADLINE_EXPIRED')
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'input.json'
            source.write_text(json.dumps(payload), encoding='utf-8')
            command = ['aws', service, operation, '--region', REGION, '--cli-input-json',
                       'file://' + str(source), '--output', 'json', '--no-cli-pager',
                       '--cli-connect-timeout', '5', '--cli-read-timeout', '15']
            if service == 'lambda':
                command += ['--query', FUNCTION_QUERY]
            elif service == 'dynamodb':
                # AWS CLI may print nothing for an empty GetItem response.
                # Force a nonempty envelope, never interpret blank stdout as
                # proof that a claim is absent.
                command += ['--query', DDB_QUERY]
            try:
                response = subprocess.run(command, capture_output=True, text=True, encoding='utf-8',
                                          timeout=25, env={**os.environ, 'AWS_MAX_ATTEMPTS': '1',
                                          'AWS_RETRY_MODE': 'standard', 'AWS_PAGER': ''})
            except (subprocess.SubprocessError, OSError):
                raise AuditError('AWS_READ_FAILED_NO_RETRY') from None
        require(response.returncode == 0, 'AWS_READ_FAILED_NO_RETRY')
        try:
            value = json.loads(response.stdout)
        except (ValueError, TypeError):
            raise AuditError('AWS_READ_JSON_INVALID') from None
        require(type(value) is dict, 'AWS_READ_RESPONSE_NOT_OBJECT')
        if service == 'dynamodb':
            require(set(value) == {'Item', 'ItemPresent'} and type(value['ItemPresent']) is bool,
                    'DYNAMODB_PRESENCE_ENVELOPE_INVALID')
            if value['ItemPresent'] is False:
                require(value['Item'] is None, 'DYNAMODB_ABSENCE_ENVELOPE_INCONSISTENT')
                return {}
            require(type(value['Item']) is dict and bool(value['Item']), 'DYNAMODB_PRESENT_ITEM_INVALID')
            return {'Item': value['Item']}
        return value


def runtime(backend):
    value = backend.call('lambda', 'get-function-configuration', {'FunctionName': FUNCTION})
    require(value.get('FunctionName') == FUNCTION and value.get('FunctionArn') ==
            f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:{FUNCTION}', 'FUNCTION_IDENTITY_MISMATCH')
    require(value.get('Stage') == 'prod' and value.get('PaymentTable') == TABLE, 'RUNTIME_TABLE_OR_STAGE_MISMATCH')
    require(value.get('State') == 'Active' and value.get('LastUpdateStatus') == 'Successful', 'RUNTIME_NOT_STABLE')
    observed = {'codeSha256': value.get('CodeSha256'), 'revisionId': value.get('RevisionId')}
    require(observed == RUNTIME, 'ACTIVE_RUNTIME_PIN_MISMATCH')
    return observed


def read_item(backend, key):
    payload = {'TableName': TABLE, 'Key': {'pk': {'S': key}}, 'ConsistentRead': True}
    validate_request('dynamodb', 'get-item', payload)
    response = backend.call('dynamodb', 'get-item', payload)
    require(type(response) is dict, 'DYNAMODB_RESPONSE_NOT_OBJECT')
    item = response.get('Item', {})
    # AWS omits Item for absence; a null/non-object must never prove absence.
    require(type(item) is dict and ('Item' not in response or bool(item)), 'DYNAMODB_ITEM_INVALID')
    if item:
        require(item.get('pk') == {'S': key}, 'DYNAMODB_ITEM_KEY_MISMATCH')
        require(all(isinstance(v, dict) and len(v) == 1 for v in item.values()), 'DYNAMODB_TYPED_ITEM_INVALID')
    return {'observedUtc': now(), 'item': item, 'sha256': digest(item), 'exists': bool(item)}


def assess(ticket, before, after):
    company, mov, lan = TARGETS[ticket]
    rb, ra = before['root'], after['root']
    cb, ca = before['claim'], after['claim']
    root = ra['item']
    unknown = sorted((set(rb['item']) | set(root)) - ROOT_ATTRIBUTES)
    claim_unknown = sorted((set(cb['item']) | set(ca['item'])) - CLAIM_ATTRIBUTES)
    root_stable = rb['item'] == root
    claim_stable = cb['item'] == ca['item']
    lock = root.get('lockUntil', {}).get('N')
    lock_known = isinstance(lock, str) and re.fullmatch(r'0|[1-9][0-9]*', lock) is not None
    issues = []
    if not rb['exists'] or not ra['exists']:
        issues.append('ROOT_MISSING')
    if not root_stable:
        issues.append('ROOT_CHANGED_BETWEEN_CONSISTENT_READS')
    if not claim_stable:
        issues.append('CLAIM_CHANGED_BETWEEN_CONSISTENT_READS')
    if cb['exists'] or ca['exists']:
        issues.append('DURABLE_BANK_CLAIM_PRESENT_NO_RETRY')
    if unknown:
        issues.append('UNKNOWN_ROOT_ATTRIBUTES_RETAINED_FOR_REVIEW')
    if claim_unknown:
        issues.append('UNKNOWN_CLAIM_ATTRIBUTES_RETAINED_FOR_REVIEW')
    if root.get('pg') != {'S': str(mov)}:
        issues.append('ROOT_MOVEMENT_LINK_NOT_EXACT')
    if root.get('state', {}).get('S') not in ('CREATED', 'CREATING'):
        issues.append('ROOT_STATE_REQUIRES_REVIEW')
    if not lock_known:
        issues.append('LEASE_VALUE_NOT_PROVEN')
    elif int(lock) >= int(time.time() * 1000):
        issues.append('LEASE_ACTIVE')
    return {'ticket': ticket, 'company': company, 'idMov': mov, 'idLan': lan,
            'rootKey': root_key(ticket), 'claimKey': claim_key(ticket),
            'root': root, 'unknownAttributes': unknown, 'claimUnknownAttributes': claim_unknown,
            'before': before, 'after': after, 'rootStable': root_stable, 'claimStable': claim_stable,
            'claimAbsentBothReads': not cb['exists'] and not ca['exists'],
            'rootMovementLinkMatchesExpected': root.get('pg') == {'S': str(mov)},
            'declaredRmLink': {'company': company, 'idMov': mov, 'idLan': lan},
            'nativeRmLinkRevalidatedByThisAudit': False,
            'reviewFlags': issues, 'readComplete': True}


def audit(backend, context=None):
    output = {'version': 1, 'purpose': 'NINE_BANK_ROOTS_AND_CANONICAL_CLAIMS_READ_ONLY',
              'startedUtc': now(), 'workflow': context, 'account': ACCOUNT, 'region': REGION, 'table': TABLE,
              'expectedRuntime': RUNTIME, 'targets': list(TARGETS), 'excludedTickets': [228007],
              'dynamoWrites': False, 'configurationWrites': False, 'financialWrites': False,
              'zeevWrites': False, 'lambdaInvoked': False, 'leaseAcquired': False,
              'claimsDeleted': False, 'automaticRetry': False, 'atomicSnapshot': False,
              'nativeRmLinkRevalidatedByThisAudit': False, 'authorizedForApply': False,
              'claimScope': 'Exact canonical BANK_REPAIR_ATTEMPT keys only; V2/V3 belong to excluded228007.',
              'firstPass': {}, 'secondPass': {}, 'tickets': [], 'coverageComplete': False}
    try:
        identity = backend.call('sts', 'get-caller-identity', {})
        require(identity.get('Account') == ACCOUNT, 'AWS_ACCOUNT_MISMATCH')
        output['runtimeStart'] = runtime(backend)
        for target in ('firstPass', 'secondPass'):
            for ticket in TARGETS:
                output[target][str(ticket)] = {'root': read_item(backend, root_key(ticket))}
                output[target][str(ticket)]['claim'] = read_item(backend, claim_key(ticket))
        output['runtimeEnd'] = runtime(backend)
        require(output['runtimeStart'] == output['runtimeEnd'], 'RUNTIME_CHANGED_DURING_AUDIT')
        output['runtimeStable'] = True
        output['tickets'] = [assess(ticket, output['firstPass'][str(ticket)], output['secondPass'][str(ticket)])
                             for ticket in TARGETS]
        output['coverageComplete'] = True
        output['allRootsStable'] = all(x['rootStable'] for x in output['tickets'])
        output['allClaimsStable'] = all(x['claimStable'] for x in output['tickets'])
        output['allCanonicalClaimsAbsent'] = all(x['claimAbsentBothReads'] for x in output['tickets'])
        output['allExpectedRootMovementLinks'] = all(x['rootMovementLinkMatchesExpected'] for x in output['tickets'])
        output['allRootAttributesKnown'] = all(not x['unknownAttributes'] for x in output['tickets'])
        output['status'] = 'COMPLETE_REVIEW_REQUIRED' if any(x['reviewFlags'] for x in output['tickets']) else 'COMPLETE_READ_ONLY'
    except Exception as exc:
        output['status'] = 'INCOMPLETE_READ_ONLY_STOPPED'
        output['errorClass'] = type(exc).__name__
        output['errorCode'] = str(exc) if isinstance(exc, AuditError) else 'EXTERNAL_READ_FAILURE'
    output['completedUtc'] = now()
    return output


def workflow_context(env):
    require(env.get('GITHUB_ACTIONS') == 'true' and env.get('GITHUB_EVENT_NAME') == 'push'
            and env.get('GITHUB_REPOSITORY') == REPOSITORY and env.get('GITHUB_REF') == 'refs/heads/' + BRANCH
            and env.get('GITHUB_RUN_ATTEMPT') == '1', 'WORKFLOW_CONTEXT_REJECTED')
    require(re.fullmatch(r'[1-9][0-9]*', env.get('GITHUB_RUN_ID', '')) and
            re.fullmatch(r'[a-f0-9]{40}', env.get('GITHUB_SHA', '')), 'WORKFLOW_IDS_INVALID')
    return {'repository': REPOSITORY, 'branch': BRANCH, 'path': WORKFLOW,
            'runId': env['GITHUB_RUN_ID'], 'commit': env['GITHUB_SHA']}


def main():
    context = workflow_context(os.environ)
    OUT.mkdir(exist_ok=False)
    result = audit(ReadOnlyAws(), context)
    paths = [Path(__file__), REPO_ROOT / WORKFLOW, REPO_ROOT / 'tests/test_payment_bank_nine_readonly.py']
    result['sourceFiles'] = {p.relative_to(REPO_ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    with (OUT / 'readback.json').open('x', encoding='utf-8') as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2, allow_nan=False)
    manifest = {'version': 1, 'workflow': context, 'status': result['status'],
                'coverageComplete': result['coverageComplete'], 'targets': list(TARGETS),
                'readbackSha256': hashlib.sha256((OUT / 'readback.json').read_bytes()).hexdigest(),
                'sourceFiles': result['sourceFiles'], 'authorizedForApply': False, 'dynamoWrites': False}
    with (OUT / 'manifest.json').open('x', encoding='utf-8') as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
    print(json.dumps({'status': result['status'], 'coverageComplete': result['coverageComplete'],
                      'rootCount': len(result['tickets']), 'errorCode': result.get('errorCode'),
                      'readbackSha256': manifest['readbackSha256'], 'dynamoWrites': False}))
    return 0 if result['coverageComplete'] else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except AuditError as exc:
        print(json.dumps({'status': 'READ_ONLY_SETUP_REJECTED', 'errorCode': str(exc)}))
        raise SystemExit(2)
