import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('cleanup228007', Path(__file__).resolve().parents[1] / 'scripts/cleanup-payment-bank-228007.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def proof():
    before = {'pk': {'S': m.PK}, 'state': {'S': 'CREATED'}, 'pg': {'S': '165611'},
              'digest': {'S': '5daa51f53816de837a466c39f74bbf77b2a8837bd02c4cab26a3130352656995'},
              'owner': {'S': '50a3027e-278f-4df8-bcea-1a973151edab'}, 'lockUntil': {'N': '1793541106676'}}
    return {'version': 1, 'ticket': 228007, 'company': 5, 'idmov': 165611, 'idlan': 634500,
            'owner': m.OWNER, 'archiveKey': m.ARCHIVE, 'workflowRunUrl': m.RUN_URL,
            'conditionMatched': True, 'rootBusinessUnchanged': True, 'before': before,
            'leasedRoot': {**before, 'owner': {'S': m.OWNER}, 'lockUntil': {'N': '1793823865169'}}}


class Fake:
    def __init__(self, p):
        self.p = p
        self.rows = {m.PK: copy.deepcopy(p['leasedRoot']), m.ARCHIVE: m.expected_archive(p)}
        self.calls = 0
        self.race = None
        self.lost = False
        self.fail = False

    def get(self, key):
        return copy.deepcopy(self.rows.get(key, {}))

    def mutate(self, request):
        self.calls += 1
        if self.race:
            self.race(self)
        if self.fail or self.rows.get(m.CLAIM, {}) != {} or self.rows[m.PK] != self.p['leasedRoot'] or self.rows[m.ARCHIVE] != m.expected_archive(self.p):
            raise RuntimeError('CAS_FAILED')
        assert request == m.transaction(self.p)
        self.rows[m.PK] = copy.deepcopy(self.p['before'])
        if self.lost:
            raise TimeoutError()


class CleanupTests(unittest.TestCase):
    def test_default_dry_run(self):
        p = proof(); b = Fake(p)
        result = m.restore(b, p)
        self.assertFalse(result['applied'])
        self.assertEqual(b.calls, 0)
        self.assertEqual(b.get(m.PK), p['leasedRoot'])

    def test_exact_restore_only_owner_lock(self):
        p = proof(); b = Fake(p)
        result = m.restore(b, p, True)
        self.assertTrue(result['originalRootExactlyRestored'])
        self.assertEqual(b.calls, 1)
        self.assertEqual(b.get(m.PK), p['before'])
        request = m.transaction(p)
        self.assertEqual([list(x)[0] for x in request['TransactItems']], ['ConditionCheck', 'ConditionCheck', 'Update'])
        update = request['TransactItems'][2]['Update']
        self.assertEqual(update['UpdateExpression'], 'SET #restoreOwner = :restoreOwner, #restoreUntil = :restoreUntil')
        self.assertTrue(set(m.ROOT_ATTRIBUTES) <= set(update['ExpressionAttributeNames'].values()))

    def test_preexisting_claim_rejected(self):
        p = proof(); b = Fake(p); b.rows[m.CLAIM] = {'state': {'S': 'CLAIMED'}}
        with self.assertRaisesRegex(RuntimeError, 'DURABLE_CLAIM'):
            m.restore(b, p, True)
        self.assertEqual(b.calls, 0)

    def test_unknown_claim_rejected(self):
        p = proof(); b = Fake(p); b.rows[m.CLAIM] = None
        with self.assertRaisesRegex(RuntimeError, 'DURABLE_CLAIM'):
            m.restore(b, p, True)
        self.assertEqual(b.calls, 0)

    def test_unknown_root_attribute_rejected(self):
        p = proof(); b = Fake(p); b.rows[m.PK]['unknown'] = {'S': 'changed'}
        with self.assertRaisesRegex(RuntimeError, 'ROOT_CHANGED'):
            m.restore(b, p, True)
        self.assertEqual(b.calls, 0)

    def test_archive_difference_rejected(self):
        p = proof(); b = Fake(p); b.rows[m.ARCHIVE]['extra'] = {'S': 'changed'}
        with self.assertRaisesRegex(RuntimeError, 'ARCHIVE_CHANGED'):
            m.restore(b, p, True)
        self.assertEqual(b.calls, 0)

    def test_claim_race_atomic_reject_no_retry(self):
        p = proof(); b = Fake(p)
        b.race = lambda x: x.rows.update({m.CLAIM: {'state': {'S': 'CLAIMED'}}})
        with self.assertRaisesRegex(RuntimeError, 'RESTORATION_NOT_CONFIRMED'):
            m.restore(b, p, True)
        self.assertEqual(b.calls, 1)
        self.assertEqual(b.rows[m.PK], p['leasedRoot'])

    def test_root_race_no_retry(self):
        p = proof(); b = Fake(p)
        b.race = lambda x: x.rows[m.PK].update({'state': {'S': 'UPDATING'}})
        with self.assertRaisesRegex(RuntimeError, 'RESTORATION_NOT_CONFIRMED'):
            m.restore(b, p, True)
        self.assertEqual(b.calls, 1)

    def test_lost_ack_can_confirm_once(self):
        p = proof(); b = Fake(p); b.lost = True
        self.assertTrue(m.restore(b, p, True)['acknowledgementLost'])
        self.assertEqual(b.calls, 1)

    def test_lost_ack_without_effect_never_retry(self):
        p = proof(); b = Fake(p); b.fail = True
        with self.assertRaisesRegex(RuntimeError, 'RESTORATION_NOT_CONFIRMED'):
            m.restore(b, p, True)
        self.assertEqual(b.calls, 1)

    def test_other_target_rejected(self):
        p = proof(); p['ticket'] = 227386
        with self.assertRaisesRegex(RuntimeError, 'LEASE_TARGET'):
            m.restore(Fake(p), p, True)

    def test_run_must_be_finished_failure(self):
        for state in ('in_progress', 'queued', 'completed'):
            with self.assertRaisesRegex(RuntimeError, 'FAILED_RUN_PROVENANCE'):
                m.verify_provenance(lambda _: {'id': m.RUN, 'status': state, 'conclusion': 'success'})

    def test_corrupt_artifact_file_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'marker.json'
            path.write_text('{}')
            with self.assertRaisesRegex(RuntimeError, 'ARTIFACT_FILE_SHA'):
                m.read_pinned(path, m.FILES['ticket-228007/attempt-228007.json'])

    def test_before_or_result_artifact_prohibits_restore(self):
        with tempfile.TemporaryDirectory() as temp:
            bank = Path(temp) / 'bank'; bank.mkdir()
            lease = Path(temp) / 'lease'; lease.mkdir()
            (bank / 'before-228007.json').write_text('{}')
            with self.assertRaisesRegex(RuntimeError, 'INVENTORY_CHANGED'):
                m.proof_from_artifacts(bank, lease)

    def test_source_pin_change_rejected(self):
        def fetch(path):
            if path.startswith('contents/'):
                return {'encoding': 'base64', 'content': 'e30='}
            if '/artifacts?' in path:
                return {'total_count': 2, 'artifacts': [{'name': k, 'id': v[0], 'digest': v[1], 'expired': False}
                        for k, v in m.ARTIFACTS.items()]}
            return {'id': m.RUN, 'status': 'completed', 'conclusion': 'failure', 'run_attempt': 1,
                    'head_sha': m.COMMIT, 'head_branch': m.BRANCH, 'event': 'push',
                    'path': '.github/workflows/payment-bank-repair.yml', 'repository': {'full_name': m.REPO}}
        with self.assertRaisesRegex(RuntimeError, 'CLAIM_BEFORE_POST_SOURCE'):
            m.verify_provenance(fetch)


if __name__ == '__main__':
    unittest.main()
