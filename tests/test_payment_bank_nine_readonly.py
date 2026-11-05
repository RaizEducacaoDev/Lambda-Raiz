"""Offline audit boundaries. No AWS, RM, Zeev or production fixture calls."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bank_nine_readonly', ROOT / 'scripts/audit-payment-bank-nine-readonly.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


def config():
    return {'FunctionName': a.FUNCTION,
            'FunctionArn': f'arn:aws:lambda:{a.REGION}:{a.ACCOUNT}:function:{a.FUNCTION}',
            'CodeSha256': a.RUNTIME['codeSha256'], 'RevisionId': a.RUNTIME['revisionId'],
            'State': 'Active', 'LastUpdateStatus': 'Successful', 'Stage': 'prod', 'PaymentTable': a.TABLE}


def root(ticket):
    return {'pk': {'S': a.root_key(ticket)}, 'state': {'S': 'CREATED'}, 'protocolVersion': {'N': '2'},
            'pg': {'S': str(a.TARGETS[ticket][1])}, 'digest': {'S': 'a' * 64},
            'owner': {'S': '11111111-1111-1111-1111-111111111111'}, 'lockUntil': {'N': '1'}}


class FakeAws:
    def __init__(self):
        self.items = {a.root_key(t): root(t) for t in a.TARGETS}
        self.calls = []
        self.runtime_calls = 0
        self.counts = {}
        self.on_call = None

    def call(self, service, operation, payload):
        a.validate_request(service, operation, payload)
        self.calls.append((service, operation, copy.deepcopy(payload)))
        if self.on_call:
            value = self.on_call(self, service, operation, payload)
            if value is not None:
                return value
        if service == 'sts':
            return {'Account': a.ACCOUNT}
        if service == 'lambda':
            self.runtime_calls += 1
            return config()
        key = payload['Key']['pk']['S']
        self.counts[key] = self.counts.get(key, 0) + 1
        return {'Item': copy.deepcopy(self.items[key])} if key in self.items else {}


class AuditTests(unittest.TestCase):
    def test_exact_nine_targets_exclude_canary_and_every_item_read_twice(self):
        backend = FakeAws()
        result = a.audit(backend)
        self.assertTrue(result['coverageComplete'])
        self.assertEqual(result['status'], 'COMPLETE_READ_ONLY')
        self.assertEqual(len(result['tickets']), 9)
        self.assertNotIn(228007, a.TARGETS)
        self.assertEqual(len(backend.counts), 18)
        self.assertEqual(set(backend.counts.values()), {2})
        self.assertTrue(all(p['ConsistentRead'] is True for s, _, p in backend.calls if s == 'dynamodb'))
        self.assertTrue(result['allCanonicalClaimsAbsent'])
        self.assertFalse(result['authorizedForApply'])
        self.assertFalse(result['nativeRmLinkRevalidatedByThisAudit'])
        for ticket in result['tickets']:
            self.assertEqual(ticket['root'], root(ticket['ticket']))
            self.assertEqual(ticket['after']['root']['sha256'], a.digest(root(ticket['ticket'])))

    def test_only_three_readonly_aws_operations_are_callable(self):
        for service, operation in [('dynamodb', 'put-item'), ('dynamodb', 'update-item'),
                                   ('dynamodb', 'delete-item'), ('dynamodb', 'scan'), ('dynamodb', 'query'),
                                   ('lambda', 'invoke'), ('lambda', 'update-function-configuration')]:
            with self.subTest(operation=operation), self.assertRaises(a.AuditError):
                a.validate_request(service, operation, {})

    def test_wrong_key_table_inconsistent_projection_or_canary_are_rejected(self):
        request = {'TableName': a.TABLE, 'Key': {'pk': {'S': a.root_key(229064)}}, 'ConsistentRead': True}
        for changed in [{**request, 'TableName': 'other'}, {**request, 'ConsistentRead': False},
                        {**request, 'ProjectionExpression': 'pk'},
                        {**request, 'Key': {'pk': {'S': 'prod#PG#5#228007'}}},
                        {**request, 'Key': {'pk': {'S': 'prod#PG#8#229064#BANK_REPAIR_ATTEMPT#V2'}}}]:
            with self.subTest(request=changed), self.assertRaises(a.AuditError):
                a.validate_request('dynamodb', 'get-item', changed)

    def test_runtime_start_mismatch_blocks_all_item_reads(self):
        backend = FakeAws()
        backend.on_call = lambda b, s, op, p: {**config(), 'RevisionId': 'changed'} if s == 'lambda' else None
        result = a.audit(backend)
        self.assertFalse(result['coverageComplete'])
        self.assertEqual(result['errorCode'], 'ACTIVE_RUNTIME_PIN_MISMATCH')
        self.assertFalse(backend.counts)

    def test_runtime_end_drift_keeps_partial_full_evidence_without_complete_claim(self):
        backend = FakeAws()
        backend.on_call = lambda b, s, op, p: {**config(), 'CodeSha256': 'changed'} if s == 'lambda' and b.runtime_calls else None
        result = a.audit(backend)
        self.assertFalse(result['coverageComplete'])
        self.assertEqual(len(result['firstPass']), 9)
        self.assertEqual(len(result['secondPass']), 9)
        self.assertEqual(result['errorCode'], 'ACTIVE_RUNTIME_PIN_MISMATCH')

    def test_wrong_account_table_stage_or_function_blocks_reads(self):
        for update in [{'PaymentTable': 'other'}, {'Stage': 'dev'}, {'FunctionArn': 'other'},
                       {'State': 'Pending'}, {'LastUpdateStatus': 'InProgress'}]:
            backend = FakeAws()
            backend.on_call = lambda b, s, op, p, u=update: {**config(), **u} if s == 'lambda' else None
            self.assertFalse(a.audit(backend)['coverageComplete'])
            self.assertFalse(backend.counts)
        backend = FakeAws()
        backend.on_call = lambda b, s, op, p: {'Account': 'other'} if s == 'sts' else None
        self.assertEqual(a.audit(backend)['errorCode'], 'AWS_ACCOUNT_MISMATCH')

    def test_concurrent_root_change_is_recorded_not_silently_refreshed(self):
        backend = FakeAws()
        key = a.root_key(229064)
        def change(b, service, op, payload):
            if service == 'dynamodb' and payload['Key']['pk']['S'] == key and b.counts.get(key) == 1:
                b.items[key]['owner'] = {'S': 'different-owner'}
        backend.on_call = change
        result = a.audit(backend)
        ticket = next(x for x in result['tickets'] if x['ticket'] == 229064)
        self.assertTrue(result['coverageComplete'])
        self.assertEqual(result['status'], 'COMPLETE_REVIEW_REQUIRED')
        self.assertFalse(ticket['rootStable'])
        self.assertNotEqual(ticket['before']['root']['sha256'], ticket['after']['root']['sha256'])

    def test_unknown_attributes_retained_in_full_item_and_marked(self):
        backend = FakeAws()
        backend.items[a.root_key(229064)]['newProtocolFlag'] = {'M': {'proof': {'S': 'test-only'}}}
        result = a.audit(backend)
        ticket = next(x for x in result['tickets'] if x['ticket'] == 229064)
        self.assertEqual(ticket['unknownAttributes'], ['newProtocolFlag'])
        self.assertIn('newProtocolFlag', ticket['root'])
        self.assertFalse(result['allRootAttributesKnown'])
        self.assertEqual(ticket['after']['root']['sha256'], a.digest(ticket['root']))

    def test_present_claim_is_preserved_and_never_absence(self):
        backend = FakeAws()
        key = a.claim_key(229070)
        backend.items[key] = {'pk': {'S': key}, 'state': {'S': 'CLAIMED_NO_AUTOMATIC_RETRY'}}
        result = a.audit(backend)
        ticket = next(x for x in result['tickets'] if x['ticket'] == 229070)
        self.assertFalse(result['allCanonicalClaimsAbsent'])
        self.assertIn('DURABLE_BANK_CLAIM_PRESENT_NO_RETRY', ticket['reviewFlags'])
        self.assertEqual(ticket['before']['claim']['item'], backend.items[key])

    def test_claim_appearing_on_second_read_is_not_absence_or_stable(self):
        backend = FakeAws()
        key = a.claim_key(229070)
        def change(b, service, op, payload):
            if service == 'dynamodb' and payload['Key']['pk']['S'] == key and b.counts.get(key) == 1:
                b.items[key] = {'pk': {'S': key}, 'state': {'S': 'CLAIMED_NO_AUTOMATIC_RETRY'}}
        backend.on_call = change
        result = a.audit(backend)
        ticket = next(x for x in result['tickets'] if x['ticket'] == 229070)
        self.assertFalse(ticket['claimStable'])
        self.assertFalse(ticket['claimAbsentBothReads'])
        self.assertFalse(result['allCanonicalClaimsAbsent'])
        self.assertEqual(backend.counts[key], 2)

    def test_failed_claim_read_keeps_root_but_does_not_invent_empty_claim(self):
        backend = FakeAws()
        key = a.claim_key(227386)
        def fail(b, service, op, payload):
            if service == 'dynamodb' and payload['Key']['pk']['S'] == key:
                raise TimeoutError()
        backend.on_call = fail
        result = a.audit(backend)
        self.assertFalse(result['coverageComplete'])
        self.assertEqual(set(result['firstPass']['227386']), {'root'})
        self.assertEqual(result['firstPass']['227386']['root']['item'], root(227386))

    def test_null_empty_item_or_wrong_key_cannot_prove_absence(self):
        for response in [{'Item': None}, {'Item': {}}, {'Item': []}, {'Item': {'pk': {'S': 'other'}}}]:
            backend = FakeAws()
            backend.on_call = lambda b, s, op, p, r=response: r if s == 'dynamodb' else None
            self.assertFalse(a.audit(backend)['coverageComplete'])
        self.assertEqual(a.read_item(FakeAws(), a.claim_key(229064))['item'], {})

    def test_missing_root_or_movement_mismatch_are_flagged_not_reconstructed(self):
        backend = FakeAws()
        del backend.items[a.root_key(229064)]
        backend.items[a.root_key(229070)]['pg'] = {'S': '999'}
        result = a.audit(backend)
        self.assertFalse(result['allExpectedRootMovementLinks'])
        cases = {x['ticket']: x for x in result['tickets']}
        self.assertEqual(cases[229064]['root'], {})
        self.assertIn('ROOT_MISSING', cases[229064]['reviewFlags'])
        self.assertIn('ROOT_MOVEMENT_LINK_NOT_EXACT', cases[229070]['reviewFlags'])

    def test_read_failure_stops_without_retry_and_keeps_partial_evidence(self):
        backend = FakeAws()
        def fail(b, s, op, p):
            if s == 'dynamodb' and p['Key']['pk']['S'] == a.root_key(226610):
                raise TimeoutError('SENSITIVE_RAW_ERROR_NOT_EXPORTED')
        backend.on_call = fail
        result = a.audit(backend)
        self.assertFalse(result['coverageComplete'])
        self.assertEqual(len(result['firstPass']), 1)
        self.assertNotIn('SENSITIVE', json.dumps(result))
        self.assertEqual(sum(p.get('Key') == {'pk': {'S': a.root_key(226610)}} for _, _, p in backend.calls), 1)

    def test_cli_uses_filtered_runtime_and_no_retry_without_exporting_secrets(self):
        response = subprocess.CompletedProcess([], 0, stdout=json.dumps(config()), stderr='SENSITIVE')
        with patch.object(a.subprocess, 'run', return_value=response) as execute:
            a.ReadOnlyAws().call('lambda', 'get-function-configuration', {'FunctionName': a.FUNCTION})
            args, kwargs = execute.call_args
            self.assertIn(a.FUNCTION_QUERY, args[0])
            self.assertEqual(kwargs['env']['AWS_MAX_ATTEMPTS'], '1')
            self.assertNotIn('PASSWORD', a.FUNCTION_QUERY)

    def test_cli_explicit_absence_envelope_is_required_not_empty_stdout(self):
        request = {'TableName': a.TABLE, 'Key': {'pk': {'S': a.claim_key(229064)}}, 'ConsistentRead': True}
        response = subprocess.CompletedProcess([], 0, stdout='{"Item":null,"ItemPresent":false}', stderr='')
        with patch.object(a.subprocess, 'run', return_value=response) as execute:
            self.assertEqual(a.ReadOnlyAws().call('dynamodb', 'get-item', request), {})
            self.assertIn(a.DDB_QUERY, execute.call_args.args[0])
        for invalid in ['', '{}', '{"Item":null}', '{"Item":{},"ItemPresent":false}',
                        '{"Item":null,"ItemPresent":true}', '{"Item":null,"ItemPresent":0}']:
            with self.subTest(value=invalid), patch.object(a.subprocess, 'run', return_value=
                    subprocess.CompletedProcess([], 0, stdout=invalid, stderr='')), self.assertRaises(a.AuditError):
                a.ReadOnlyAws().call('dynamodb', 'get-item', request)

    def test_cli_presence_envelope_preserves_complete_typed_item(self):
        item = root(229064)
        item['unknownFutureAttribute'] = {'M': {'value': {'S': 'synthetic'}}}
        request = {'TableName': a.TABLE, 'Key': {'pk': {'S': a.root_key(229064)}}, 'ConsistentRead': True}
        response = subprocess.CompletedProcess([], 0, stdout=json.dumps({'Item': item, 'ItemPresent': True}), stderr='')
        with patch.object(a.subprocess, 'run', return_value=response):
            self.assertEqual(a.ReadOnlyAws().call('dynamodb', 'get-item', request), {'Item': item})

    def test_workflow_rejects_manual_event_rerun_other_repo_branch(self):
        env = {'GITHUB_ACTIONS': 'true', 'GITHUB_EVENT_NAME': 'push', 'GITHUB_REPOSITORY': a.REPOSITORY,
               'GITHUB_REF': 'refs/heads/' + a.BRANCH, 'GITHUB_RUN_ATTEMPT': '1',
               'GITHUB_RUN_ID': '123', 'GITHUB_SHA': 'a' * 40}
        self.assertEqual(a.workflow_context(env)['runId'], '123')
        for update in [{'GITHUB_EVENT_NAME': 'workflow_dispatch'}, {'GITHUB_RUN_ATTEMPT': '2'},
                       {'GITHUB_REPOSITORY': 'other'}, {'GITHUB_REF': 'refs/heads/main'}]:
            with self.assertRaises(a.AuditError):
                a.workflow_context({**env, **update})


if __name__ == '__main__':
    unittest.main()
