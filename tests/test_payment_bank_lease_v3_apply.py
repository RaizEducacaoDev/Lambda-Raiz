"""Offline one-shot administrative restoration tests; no service calls."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
    s=importlib.util.spec_from_file_location(name,path);v=importlib.util.module_from_spec(s);s.loader.exec_module(v);return v
m=load('lease_v3_apply',ROOT/'scripts/apply-payment-bank-lease-v3.py');p=m.p
fixture=load('lease_v3_test_fixtures',ROOT/'tests/test_payment_bank_lease_v3.py')
CTX={'repository':p.REPOSITORY,'workflow':m.WORKFLOW,'runId':'41999999998','commit':'b'*40}
REVIEW_CTX={'repository':p.REPOSITORY,'workflow':p.WORKFLOW,'runId':m.REVIEW_RUN,'commit':m.REVIEW_COMMIT}

class Fake(fixture.Fake):
    def __init__(self,e):
        super().__init__(e);self.sent=False;self.dispatch=None;self.lost=False;self.abort=False;self.independent_fail=False
        self.post_mutation=None;self.review_checked=False;self.independent_count=0
    def verify_review_run(self):self.review_checked=True
    def authorize_dispatch(self,h,deadline,token):
        p.require(not self.sent,'ONE_TRANSACTION_ONLY');self.dispatch=(h,deadline,token)
    def transact(self,tx):
        p.require(not self.sent,'ONE_TRANSACTION_ONLY');self.sent=True;self.writes+=1
        if self.abort:raise RuntimeError('synthetic abort')
        self.items[p.ROOT_KEY]=copy.deepcopy(self.e['lease']['before'])
        if self.post_mutation:self.post_mutation(self)
        if self.lost:raise TimeoutError('synthetic lost acknowledgement')
        return {}
    def independent(self):
        self.independent_count+=1
        if self.independent_fail:raise RuntimeError('synthetic independent failure')
        other=fixture.Fake(self.e);other.items=copy.deepcopy(self.items);return other

class ApplyLeaseV3Tests(unittest.TestCase):
    def setUp(self):
        for obj,name,value in [(p,'CLAIM_V1_SHA',p.sha(fixture.OLD)),(p,'RECEIPT_SHA',p.sha(fixture.RECEIPT)),
          (p,'validate_columns',lambda x:None),(p,'source_hashes',lambda:copy.deepcopy(m.PREPARE_SOURCE_PINS))]:
            t=patch.object(obj,name,value);t.start();self.addCleanup(t.stop)
        self.e=fixture.evidence();self.f=Fake(self.e);self.review=p.prepare(self.f,self.e,REVIEW_CTX)
        for name,value in [('TRANSACTION_SHA',self.review['transactionSha256']),('REVIEW_PLAN_SHA',p.sha(self.review))]:
            t=patch.object(m,name,value);t.start();self.addCleanup(t.stop)

    def test_one_update_and_two_complete_readbacks(self):
        before=copy.deepcopy(self.f.items);v=m.execute(self.f,self.e,self.review,CTX,True)
        self.assertTrue(v['verified']);self.assertEqual(self.f.writes,1);self.assertEqual(self.f.independent_count,1)
        self.assertEqual(self.f.items[p.ROOT_KEY],self.e['lease']['before'])
        for k in p.CONTROL_KEYS[1:]:self.assertEqual(self.f.items[k],before[k])
        self.assertTrue(v['firstReadback']['allFiveExactlyMatched']);self.assertTrue(v['independentReadback']['allFiveExactlyMatched'])
        self.assertTrue(v['independentFinancialReadback']['unchanged']);self.assertFalse(v['acknowledgementLost'])
        self.assertEqual(v['newReceipts'],0);self.assertEqual(v['claimMutations'],0);self.assertFalse(v['newFinancialAttemptAuthorized'])

    def test_lost_acknowledgement_only_reads_and_never_resends(self):
        self.f.lost=True;v=m.execute(self.f,self.e,self.review,CTX,True)
        self.assertTrue(v['verified']);self.assertTrue(v['acknowledgementLost']);self.assertEqual(self.f.writes,1)
        with self.assertRaises(Exception):m.execute(self.f,self.e,self.review,CTX,True)
        self.assertEqual(self.f.writes,1)

    def test_transaction_abort_no_effect_is_unconfirmed_not_retried(self):
        self.f.abort=True;before=copy.deepcopy(self.f.items);v=m.execute(self.f,self.e,self.review,CTX,True)
        self.assertFalse(v['verified']);self.assertEqual(v['state'],'UNCONFIRMED_DO_NOT_RETRY')
        self.assertEqual(self.f.items,before);self.assertEqual(self.f.writes,1)

    def test_preserved_item_mutation_after_write_is_failure(self):
        for key in p.CONTROL_KEYS[1:]:
            f=Fake(self.e);f.post_mutation=lambda b:b.items[key].update(unexpected={'S':'changed'})
            v=m.execute(f,self.e,self.review,CTX,True)
            with self.subTest(key=key):self.assertFalse(v['verified']);self.assertEqual(f.writes,1)

    def test_independent_read_failure_does_not_retry_mutation(self):
        self.f.independent_fail=True;v=m.execute(self.f,self.e,self.review,CTX,True)
        self.assertFalse(v['verified']);self.assertIsNone(v['independentReadback']);self.assertEqual(self.f.writes,1)

    def test_concurrent_control_changes_block_without_dispatch(self):
        for key in p.CONTROL_KEYS:
            f=Fake(self.e);f.change=lambda b,v:b.items[key].update(extra={'S':'changed'})
            with self.subTest(key=key),self.assertRaises(Exception):m.execute(f,self.e,self.review,CTX,True)
            self.assertEqual(f.writes,0)

    def test_changed_form_or_runtime_blocks_without_dispatch(self):
        for field in ('review','runtime','columns'):
            f=Fake(self.e);f.change=lambda b,v:v[field].update(changed=True)
            with self.assertRaises(p.GuardError):m.execute(f,self.e,self.review,CTX,True)
            self.assertEqual(f.writes,0)

    def test_tampered_review_file_plan_or_transaction_fails(self):
        changed=copy.deepcopy(self.review);changed['proposal']['newReceipts']=1
        with self.assertRaisesRegex(p.GuardError,'PLAN_CHANGED'):m.execute(self.f,self.e,changed,CTX,True)
        with patch.object(m,'TRANSACTION_SHA','0'*64):
            with self.assertRaises(p.GuardError):m.execute(self.f,self.e,self.review,CTX,True)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'review.json';path.write_text('{}')
            with self.assertRaisesRegex(p.GuardError,'FILE_CHANGED'):m.load_review(path)
        self.assertEqual(self.f.writes,0)

    def test_stale_review_or_freshness_window_blocks(self):
        with patch.object(p,'utc',return_value='2030-01-01T00:00:00Z'):
            with self.assertRaisesRegex(p.GuardError,'TOO_OLD'):m.execute(self.f,self.e,self.review,CTX,True)
        with patch.object(m.time,'monotonic',side_effect=[100,100,120,161]):
            with self.assertRaisesRegex(p.GuardError,'60_SECONDS'):m.execute(self.f,self.e,self.review,CTX,True)
        self.assertEqual(self.f.writes,0)

    def test_authorization_required_and_restored_root_replay_rejected(self):
        with self.assertRaisesRegex(p.GuardError,'EXPLICIT'):m.execute(self.f,self.e,self.review,CTX,False)
        self.f.items[p.ROOT_KEY]=copy.deepcopy(self.e['lease']['before'])
        with self.assertRaisesRegex(p.GuardError,'LEASE_V3'):m.execute(self.f,self.e,self.review,CTX,True)
        self.assertEqual(self.f.writes,0)

    def test_live_dispatch_checks_payload_deadline_token_and_one_shot(self):
        tx=p.restoration_transaction(self.e,self.f.items);b=m.Live.__new__(m.Live);b.sent=False;b.dispatch=None
        token='12345678-1234-1234-1234-123456789012';b.authorize_dispatch(m.TRANSACTION_SHA,m.time.monotonic()+60,token)
        wrong={**tx,'ClientRequestToken':'87654321-4321-4321-4321-210987654321'}
        with self.assertRaises(p.GuardError):b.transact(wrong)
        self.assertFalse(b.sent)
        with patch.object(m.subprocess,'run',side_effect=subprocess.TimeoutExpired('aws',25)) as call:
            with self.assertRaises(subprocess.TimeoutExpired):b.transact({**tx,'ClientRequestToken':token})
            with self.assertRaisesRegex(p.GuardError,'ONE_TRANSACTION_ONLY'):b.transact({**tx,'ClientRequestToken':token})
            self.assertEqual(call.call_count,1)
            self.assertEqual(call.call_args.kwargs['env']['AWS_MAX_ATTEMPTS'],'1')
        self.assertTrue(b.sent)

    def test_no_financial_write_surface_and_no_generic_dynamo_write(self):
        b=m.Live.__new__(m.Live)
        with patch.object(m.subprocess,'run',side_effect=AssertionError('No I/O')):
            for op in ('put-item','update-item','delete-item','transact-write-items'):
                with self.assertRaises(p.GuardError):b.aws(op,{})
        self.assertFalse(hasattr(b,'save'))

    def test_rerun_context_is_rejected(self):
        env={'GITHUB_ACTIONS':'true','GITHUB_EVENT_NAME':'push','GITHUB_RUN_ATTEMPT':'2','GITHUB_REPOSITORY':p.REPOSITORY,
          'GITHUB_REF':'refs/heads/'+p.BRANCH,'GITHUB_RUN_ID':'41999999998','GITHUB_SHA':'b'*40}
        with self.assertRaises(p.GuardError):m.context(env)
        env['GITHUB_RUN_ATTEMPT']='1';self.assertEqual(m.context(env),CTX)

if __name__=='__main__':unittest.main()
