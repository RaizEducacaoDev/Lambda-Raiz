"""Runner-only tests: every remote operation is mocked."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bank_runner_tests', ROOT / 'scripts/run-payment-bank-repair.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
spec = importlib.util.spec_from_file_location('bank_runner_fixtures', ROOT / 'tests/test_payment_bank_repair.py')
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
RUNTIME = {'codeSha256': 'A' * 43 + '=', 'revisionId': '11111111-1111-1111-1111-111111111111'}
CTX = {'repository': r.REPOSITORY, 'branch': r.BRANCH, 'workflow': r.WORKFLOW, 'runId': '2345', 'commit': 'a' * 40}


def config(mode='prepare', tickets=None):
    return {'version': 1, 'mode': mode, 'tickets': tickets or [228007], 'authorizedBankRepair': mode == 'apply',
            'approvedPrepareRunId': '0' if mode == 'prepare' else '1234',
            'approvedManifestSha256': '' if mode == 'prepare' else 'b' * 64,
            'verifiedCanaryRunId': '0', 'verifiedCanarySummarySha256': ''}


def snapshot(ticket=228007):
    value = f.fixture(ticket)
    value['remoteSources']['runtime'] = RUNTIME.copy()
    return value


class RunnerTests(unittest.TestCase):
    def test_default_prepare_scope_is_all_eight_and_has_no_apply_authorization(self):
        current = r.validate_config(config('prepare', list(r.TARGETS)))
        self.assertEqual(set(current['tickets']), set(r.TARGETS))
        self.assertEqual(current['mode'], 'prepare')
        self.assertFalse(current['authorizedBankRepair'])
        self.assertEqual(len(r.TARGETS), 8)

    def test_current_operational_config_is_valid_in_prepare_or_authorized_apply(self):
        current = r.validate_config(r.read(ROOT / '.github/payment-bank-repair.json'))
        self.assertIn(current['mode'], ('prepare', 'apply'))

    def test_apply_requires_pinned_prepare_and_first_canary_only(self):
        self.assertEqual(r.validate_config(config('apply'))['tickets'], [228007])
        for update in [{'authorizedBankRepair': False}, {'approvedPrepareRunId': '0'}, {'approvedManifestSha256': ''},
                       {'tickets': [227386]}, {'tickets': [228007, 227386]}, {'tickets': [228007, 228007]}, {'tickets': [999]}]:
            with self.subTest(update=update), self.assertRaises(r.operator.GuardError):
                r.validate_config({**config('apply'), **update})
        with self.assertRaises(r.operator.GuardError):
            r.validate_config({**config(), 'authorizedBankRepair': True})

    def test_later_targets_require_reviewed_canary_and_cannot_repeat_canary(self):
        later = {**config('apply', [227386]), 'verifiedCanaryRunId': '3456', 'verifiedCanarySummarySha256': 'c' * 64}
        self.assertEqual(r.validate_config(later)['tickets'], [227386])
        with self.assertRaises(r.operator.GuardError):
            r.validate_config({**later, 'tickets': [228007]})

    def test_context_rejects_other_repo_branch_manual_event_and_rerun(self):
        env = {'GITHUB_ACTIONS': 'true', 'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': 'refs/heads/' + r.BRANCH,
               'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_REPOSITORY': r.REPOSITORY, 'GITHUB_RUN_ID': CTX['runId'], 'GITHUB_SHA': CTX['commit']}
        self.assertEqual(r.context(env), CTX)
        for update in [{'GITHUB_REPOSITORY': 'other/repo'}, {'GITHUB_REF': 'refs/heads/main'},
                       {'GITHUB_EVENT_NAME': 'workflow_dispatch'}, {'GITHUB_RUN_ATTEMPT': '2'}]:
            with self.subTest(update=update), self.assertRaises(r.operator.GuardError):
                r.context({**env, **update})

    def test_prepare_saves_only_review_and_hashes_without_acquiring_lease_or_writing(self):
        value = snapshot()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            audit = path / 'audit.json'
            audit.write_text('{"coverageComplete":true}')
            with patch.object(r, 'OUT', path / 'out'), patch.object(r, 'AUDIT', audit), \
                 patch.object(r.operator, 'RemoteLiveAdapter', return_value=Mock(read=Mock(return_value=value))), \
                 patch.object(r, 'code_hashes', return_value={'fixture': 'hash'}), \
                 patch.object(r.lease, 'acquire') as acquire, patch.object(r.operator, 'execute') as apply:
                self.assertEqual(r.execute(config(), CTX), 0)
                acquire.assert_not_called()
                apply.assert_not_called()
                manifest = r.read(r.OUT / 'manifest.json')
                self.assertTrue(manifest['allPrepared'])
                self.assertEqual(manifest['runtime'], RUNTIME)
                self.assertEqual(len(manifest['files']), 2)
                for name, digest in manifest['files'].items():
                    self.assertEqual(r.file_sha(r.OUT / name), digest)
                self.assertFalse(manifest['bankWrites'])

    def approved_fixture(self, base):
        directory = base / 'approved'
        directory.mkdir()
        audit = base / 'audit.json'
        audit.write_text('{"coverageComplete":true}')
        plan = r.operator.review(snapshot(), 228007)
        prepared = {'ticket': 228007, 'mode': 'READ_ONLY', 'bankWrites': False, 'planSha256': r.operator.digest(plan), 'runtime': RUNTIME}
        inventory = {}
        for name, value in [('plan', plan), ('prepare', prepared)]:
            path = directory / f'{name}-228007.json'
            r.write(path, value)
            inventory[path.name] = r.file_sha(path)
        manifest = {'version': 1, 'mode': 'prepare', 'allPrepared': True, 'requestedTickets': [228007],
                    'workflow': {**CTX, 'runId': '1234', 'commit': 'b' * 40}, 'codeSha256': {'fixture': 'hash'},
                    'runtime': RUNTIME, 'audit': {'runId': r.AUDIT_RUN, 'sha256': r.file_sha(audit)}, 'files': inventory,
                    'bankWrites': False, 'zeevWrites': False, 'lambdaInvoked': False}
        r.write(directory / 'manifest.json', manifest)
        cfg = config('apply')
        cfg['approvedManifestSha256'] = r.file_sha(directory / 'manifest.json')
        return directory, audit, cfg, plan

    def test_approved_manifest_pins_source_audit_files_plan_hash_and_exact_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            approved, audit, cfg, plan = self.approved_fixture(Path(directory))
            with patch.object(r, 'APPROVED', approved), patch.object(r, 'AUDIT', audit), \
                 patch.object(r, 'code_hashes', return_value={'fixture': 'hash'}), \
                 patch.object(r, 'verify_run', return_value={'head_sha': 'b' * 40}) as verify:
                self.assertEqual(r.approved_plans(cfg, CTX), {228007: plan})
                verify.assert_called_with('1234', CTX)
                (approved / 'plan-228007.json').write_text('{}')
                with self.assertRaisesRegex(r.operator.GuardError, 'APPROVED_FILE_CHANGED'):
                    r.approved_plans(cfg, CTX)

    def test_changed_source_or_manifest_stops_before_lease(self):
        with tempfile.TemporaryDirectory() as directory:
            approved, audit, cfg, _ = self.approved_fixture(Path(directory))
            with patch.object(r, 'APPROVED', approved), patch.object(r, 'AUDIT', audit), \
                 patch.object(r, 'code_hashes', return_value={'changed': 'hash'}), \
                 patch.object(r, 'verify_run', return_value={'head_sha': 'b' * 40}), patch.object(r.lease, 'acquire') as acquire:
                with self.assertRaisesRegex(r.operator.GuardError, 'REVIEWED_SOURCE_CHANGED'):
                    r.approved_plans(cfg, CTX)
                with self.assertRaisesRegex(r.operator.GuardError, 'MANIFEST_SHA'):
                    r.approved_plans({**cfg, 'approvedManifestSha256': 'c' * 64}, CTX)
                acquire.assert_not_called()

    def test_missing_runtime_identity_cannot_be_prepared_or_approved(self):
        plan = r.operator.review(snapshot(), 228007)
        plan['baseline']['remoteSources']['runtime']['revisionId'] = ''
        with self.assertRaisesRegex(r.operator.GuardError, 'EXACT_RUNTIME_IDENTITY_MISSING'):
            r.validate_plan(plan, 228007)

    def test_github_approval_requires_completed_success_same_repo_branch_workflow_and_attempt(self):
        record = {'id': 1234, 'repository': {'full_name': r.REPOSITORY}, 'path': r.WORKFLOW,
                  'head_branch': r.BRANCH, 'event': 'push', 'run_attempt': 1, 'status': 'completed', 'conclusion': 'success'}
        opener = Mock()
        with patch.dict(r.os.environ, {'GH_TOKEN': 'SYNTHETIC_TOKEN'}), patch.object(r.urllib.request, 'build_opener', return_value=opener):
            opener.open.side_effect = lambda *a, **k: io.BytesIO(json.dumps(record).encode())
            self.assertEqual(r.verify_run('1234', CTX)['id'], 1234)
            for update in [{'repository': {'full_name': 'other/repo'}}, {'head_branch': 'main'}, {'path': 'other.yml'},
                           {'event': 'workflow_dispatch'}, {'run_attempt': 2}, {'status': 'in_progress'}, {'conclusion': 'failure'}]:
                opener.open.side_effect = lambda *a, current={**record, **update}, **k: io.BytesIO(json.dumps(current).encode())
                with self.subTest(update=update), self.assertRaises(r.operator.GuardError):
                    r.verify_run('1234', CTX)

    def test_remaining_batch_needs_verified_canary_lease_release_same_source_and_runtime(self):
        summary = {'version': 1, 'mode': 'apply', 'workflow': {**CTX, 'runId': '3456', 'commit': 'b' * 40},
                   'requestedTickets': [228007], 'allVerified': True, 'codeSha256': {'fixture': 'hash'}, 'runtime': RUNTIME,
                   'zeevWrites': False, 'lambdaInvoked': False,
                   'results': [{'ticket': 228007, 'state': 'VERIFIED', 'bankVerified': True, 'leaseReleased': True}]}
        with tempfile.TemporaryDirectory() as directory, patch.object(r, 'CANARY', Path(directory)), \
             patch.object(r, 'code_hashes', return_value={'fixture': 'hash'}), \
             patch.object(r, 'verify_run', return_value={'head_sha': 'b' * 40}):
            path = r.CANARY / 'summary.json'
            cfg = {**config('apply', [227386]), 'verifiedCanaryRunId': '3456'}
            path.write_text(json.dumps(summary))
            cfg['verifiedCanarySummarySha256'] = r.file_sha(path)
            r.verified_canary(cfg, CTX, RUNTIME)
            for change in [{'allVerified': False}, {'codeSha256': {'changed': 'hash'}}, {'runtime': {**RUNTIME, 'revisionId': 'other'}},
                           {'results': [{'ticket': 228007, 'state': 'VERIFIED', 'bankVerified': True, 'leaseReleased': False}]}]:
                path.write_text(json.dumps({**summary, **change}))
                cfg['verifiedCanarySummarySha256'] = r.file_sha(path)
                with self.subTest(change=change), self.assertRaises(r.operator.GuardError):
                    r.verified_canary(cfg, CTX, RUNTIME)

    def apply_case(self, failure=False, claim=False):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        base = Path(directory.name)
        proof = f.proof()
        order = []
        def acquire(*args):
            order.append('acquire')
            r.write(r.lease.OUT / 'lease-228007.json', proof)
        def apply(*args):
            order.append('apply')
            if failure:
                raise TimeoutError('PRIVATE_REMOTE_DATA')
            return {'ticket': 228007, 'state': 'VERIFIED', 'sameSessionAndIndependentReadback': True, 'retryAllowed': False}
        def release(*args):
            order.append('release')
            return {'released': True, 'originalRootExactlyRestored': True}
        with patch.object(r, 'OUT', base / 'output'), patch.object(r.lease, 'OUT', base / 'leases'), \
             patch.object(r.lease, 'aws', return_value={'Account': r.lease.ACCOUNT}), \
             patch.object(r.lease, 'get', return_value={'exists': True} if claim else {}), \
             patch.object(r.claim_gate, 'assert_ready'), \
             patch.object(r.lease, 'acquire', side_effect=acquire) as acq, \
             patch.object(r.operator, 'RemoteLiveAdapter', return_value=Mock()), \
             patch.object(r.operator, 'execute', side_effect=apply) as execute, \
             patch.object(r.lease, 'release', side_effect=release) as rel:
            if claim:
                with self.assertRaisesRegex(r.operator.GuardError, 'DURABLE_BANK_ATTEMPT'):
                    r.apply_one(228007, {}, {}, CTX)
                acq.assert_not_called()
                execute.assert_not_called()
                rel.assert_not_called()
            elif failure:
                with self.assertRaises(TimeoutError):
                    r.apply_one(228007, {}, {}, CTX)
                self.assertEqual(execute.call_count, 1)
                rel.assert_not_called()
            else:
                result = r.apply_one(228007, {}, {}, CTX)
                self.assertTrue(result['leaseReleased'])
                self.assertEqual(order, ['acquire', 'apply', 'release'])
                self.assertEqual(execute.call_args.args[1], 228007)
        return order

    def test_each_lease_is_acquired_just_before_apply_and_released_only_after_verified_success(self):
        self.apply_case()

    def test_unknown_native_outcome_never_releases_lease_or_retries(self):
        self.assertEqual(self.apply_case(failure=True), ['acquire', 'apply'])

    def test_existing_durable_claim_blocks_before_any_new_lease(self):
        self.assertEqual(self.apply_case(claim=True), [])

    def test_real_lease_helper_represents_absent_item_as_empty_dict(self):
        with patch.object(r.lease, 'aws', return_value={}) as aws:
            self.assertEqual(r.lease.get('prod#PG#5#228007#BANK_REPAIR_ATTEMPT'), {})
            self.assertEqual(aws.call_args.args[:2], ('dynamodb', 'get-item'))

    def test_apply_stops_batch_on_first_unknown_and_keeps_lease_expiry(self):
        cfg = {**config('apply', [227386, 226610]), 'verifiedCanaryRunId': '3456', 'verifiedCanarySummarySha256': 'c' * 64}
        plans = {ticket: r.operator.review(snapshot(ticket), ticket) for ticket in cfg['tickets']}
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            audit = base / 'audit.json'
            audit.write_text('{"coverageComplete":true}')
            with patch.object(r, 'OUT', base / 'out'), patch.object(r, 'AUDIT', audit), \
                 patch.object(r, 'approved_plans', return_value=plans), patch.object(r, 'verified_canary'), \
                 patch.object(r, 'apply_one', side_effect=TimeoutError('PRIVATE_RESPONSE')) as apply, \
                 patch.object(r, 'code_hashes', return_value={'fixture': 'hash'}):
                self.assertEqual(r.execute(cfg, CTX), 2)
                self.assertEqual(apply.call_count, 1)
                summary = r.read(r.OUT / 'summary.json')
                self.assertFalse(summary['allVerified'])
                self.assertTrue(summary['results'][0]['leaseMayRemainUntilExpiry'])
                self.assertNotIn('PRIVATE', json.dumps(summary))

    def test_workflow_shares_lease_group_and_uploads_native_and_lease_proofs(self):
        text = (ROOT / r.WORKFLOW).read_text()
        for value in ['group: payment-backlog-bank-lease', 'github.run_attempt == 1', 'payment-bulk-readonly-evidence',
                      '41892943724', '.payment-bank-lease/', '.payment-bank-repair/', 'retention-days: 7']:
            self.assertIn(value, text)
        self.assertNotIn('workflow_dispatch', text)
        self.assertNotIn('lambda invoke', text)


if __name__ == '__main__':
    unittest.main()
