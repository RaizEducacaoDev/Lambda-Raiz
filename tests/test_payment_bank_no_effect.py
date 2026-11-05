"""Offline tests. No service call, financial mutation or credential access."""
import copy
import datetime as dt
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bank_no_effect',ROOT/'scripts/adjudicate-payment-bank-no-effect.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
CTX={'repository':m.REPOSITORY,'workflow':m.WORKFLOW,'runId':'41999999999','commit':'a'*40}


def claim():
    return {'pk':{'S':m.OLD_ATTEMPT_KEY},'nonce':{'S':'12345678-1234-1234-1234-123456789012'},
      'ticket':{'N':str(m.TICKET)},'company':{'N':str(m.COMPANY)},'idlan':{'N':str(m.IDLAN)},
      'leaseOwner':{'S':m.LEASE_OWNER},'planSha256':{'S':m.PLAN_SHA},
      'targetFieldsSha256':{'S':m.sha({'CODCOLPGTO':'5','IDPGTO':'1'})},
      'state':{'S':'CLAIMED_NO_AUTOMATIC_RETRY'},'observedUtc':{'S':'2026-11-04T20:22:19+00:00'}}


def evidence():
    before={'pk':{'S':m.ROOT_KEY},'state':{'S':'CREATED'},'pg':{'S':str(m.IDMOV)},
      'digest':{'S':'a'*64},'owner':{'S':'87654321-4321-4321-4321-210987654321'},'lockUntil':{'N':'1793700000000'}}
    leased={**before,'owner':{'S':m.LEASE_OWNER},'lockUntil':{'N':'1793824907752'}}
    return {'lease':{'before':before,'leasedRoot':leased},
      'archive':{'pk':{'S':m.ARCHIVE_KEY},'original':{'M':before},'leaseOwner':leased['owner'],'leaseUntil':leased['lockUntil']},
      'review':{'fixed':'review','baseline':{'remoteSources':{'runtime':copy.deepcopy(m.SOURCE_RUNTIME)}}},
      'columnEvidence':{'fixed':'hashes'},'sourceHashes':{}}


class Fake:
    def __init__(self,e):
        self.e=e;self.items={m.ROOT_KEY:copy.deepcopy(e['lease']['leasedRoot']),m.ARCHIVE_KEY:copy.deepcopy(e['archive']),m.OLD_ATTEMPT_KEY:claim()}
        self.writes=0;self.reads=0;self.lost=False;self.abort=False;self.change=None;self.reviews=[]
    def runtime(self):return copy.deepcopy(m.CURRENT_RUNTIME)
    def get(self,key):return copy.deepcopy(self.items.get(key,{}))
    def observe(self,independent):
        self.reads+=1
        out={'observedUtc':m.utc(),'runtime':copy.deepcopy(m.CURRENT_RUNTIME),
          'review':m.expected_current_review(self.e['review']),'columnEvidence':copy.deepcopy(self.e['columnEvidence'])}
        if self.change:self.change(self,out)
        return out
    def verify_prepare_run(self,workflow):self.reviews.append(workflow)
    def transact(self,payload):
        self.writes+=1
        if self.abort:raise RuntimeError('synthetic abort')
        self.items[m.ROOT_KEY]=copy.deepcopy(self.e['lease']['before'])
        receipt=payload['TransactItems'][3]['Put']['Item'];self.items[receipt['pk']['S']]=copy.deepcopy(receipt)
        if self.lost:raise RuntimeError('synthetic lost acknowledgement')


class NoEffectTests(unittest.TestCase):
    def setUp(self):
        # All business equality tests still compare the actual fixture exactly;
        # only the 693 production-column hash digest is mocked in unit fixtures.
        self.validate=patch.object(m,'validate_column_evidence',lambda value:None);self.validate.start();self.addCleanup(self.validate.stop)

    def plan(self,f,e):return m.prepare(f,e,CTX)

    def test_prepare_is_read_only_and_claim_preserved(self):
        e=evidence();f=Fake(e);before=copy.deepcopy(f.items);p=self.plan(f,e)
        self.assertEqual(f.writes,0);self.assertEqual(f.reads,2);self.assertEqual(f.items,before)
        self.assertFalse(p['dynamoWrites']);self.assertEqual(p['oldClaimSha256'],m.sha(claim()))
        self.assertEqual(p['nextAttemptKey'],m.NEXT_ATTEMPT_KEY)

    def test_receipt_validator_is_pure_and_bound_to_original_claim(self):
        c=claim();r=m.make_receipt(c,m.utc(),f'https://github.com/{m.REPOSITORY}/actions/runs/41999999999')
        with patch.object(m.subprocess,'run',side_effect=AssertionError('I/O forbidden')):
            v=m.validate_manual_retry_receipt(r,c)
        self.assertEqual(v['nextAttemptKey'],m.NEXT_ATTEMPT_KEY);self.assertFalse(v['automaticRetryAllowed'])
        changed=copy.deepcopy(c);changed['nonce']['S']='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        with self.assertRaises(m.GuardError):m.validate_manual_retry_receipt(r,changed)

    def test_receipt_exact_schema_flags_and_source_pins(self):
        c=claim();original=m.make_receipt(c,m.utc(),f'https://github.com/{m.REPOSITORY}/actions/runs/41999999999')
        for field,value in [('nextAttemptKey',{'S':m.OLD_ATTEMPT_KEY}),('state',{'S':'COMPLETE'}),
          ('automaticRetryAllowed',{'BOOL':True}),('proofSha256',{'S':'a'*64}),('ticket',{'N':'225136'})]:
            r=copy.deepcopy(original);r[field]=value
            with self.subTest(field=field),self.assertRaises(m.GuardError):m.validate_manual_retry_receipt(r,c)
        r=copy.deepcopy(original);r['extra']={'S':'unexpected'}
        with self.assertRaises(m.GuardError):m.validate_manual_retry_receipt(r,c)

    def test_claim_schema_correlates_lease_time_plan_and_fields(self):
        for key,value in [('leaseOwner',{'S':'different'}),('planSha256',{'S':'a'*64}),
          ('targetFieldsSha256',{'S':'a'*64}),('observedUtc',{'S':'2026-11-04T20:23:00Z'})]:
            c=claim();c[key]=value
            with self.subTest(key=key),self.assertRaises(m.GuardError):m.validate_old_claim(c)

    def test_transaction_keeps_old_claim_archive_and_only_restores_owner_lock(self):
        e=evidence();c=claim();r=m.make_receipt(c,m.utc(),f'https://github.com/{m.REPOSITORY}/actions/runs/41999999999')
        ops=m.transaction(e,c,r)['TransactItems']
        self.assertEqual([next(iter(x)) for x in ops],['ConditionCheck','ConditionCheck','Update','Put','ConditionCheck'])
        self.assertEqual(ops[0]['ConditionCheck']['Key']['pk']['S'],m.OLD_ATTEMPT_KEY)
        self.assertEqual(ops[1]['ConditionCheck']['Key']['pk']['S'],m.ARCHIVE_KEY)
        update=ops[2]['Update'];self.assertEqual(update['UpdateExpression'],'SET #restoreOwner = :restoreOwner, lockUntil = :restoreLock')
        for key in e['lease']['leasedRoot']:self.assertIn(key,update['ExpressionAttributeNames'].values())
        self.assertEqual(ops[3]['Put']['ConditionExpression'],'attribute_not_exists(pk)')
        self.assertEqual(ops[4]['ConditionCheck']['Key']['pk']['S'],m.NEXT_ATTEMPT_KEY)

    def test_apply_one_atomic_attempt_and_exact_readback(self):
        e=evidence();f=Fake(e);p=self.plan(f,e);old=copy.deepcopy(f.items[m.OLD_ATTEMPT_KEY]);archive=copy.deepcopy(f.items[m.ARCHIVE_KEY])
        result=m.apply(f,e,p,m.sha(p),CTX,True)
        self.assertTrue(result['verified']);self.assertEqual(f.writes,1);self.assertEqual(f.items[m.OLD_ATTEMPT_KEY],old)
        self.assertEqual(f.items[m.ARCHIVE_KEY],archive);self.assertEqual(f.items[m.ROOT_KEY],e['lease']['before'])
        with self.assertRaises(m.GuardError):m.apply(f,e,p,m.sha(p),CTX,True)
        self.assertEqual(f.writes,1)

    def test_lost_acknowledgement_is_only_read_back_never_retried(self):
        e=evidence();f=Fake(e);p=self.plan(f,e);f.lost=True
        result=m.apply(f,e,p,m.sha(p),CTX,True)
        self.assertTrue(result['verified']);self.assertTrue(result['acknowledgementLost']);self.assertEqual(f.writes,1)

    def test_transaction_failure_keeps_claim_lease_and_no_receipt(self):
        e=evidence();f=Fake(e);p=self.plan(f,e);before=copy.deepcopy(f.items);f.abort=True
        result=m.apply(f,e,p,m.sha(p),CTX,True)
        self.assertFalse(result['verified']);self.assertEqual(f.writes,1);self.assertEqual(f.items,before)

    def test_concurrent_root_change_and_claim_change_block_before_transaction(self):
        for key,field,value in [(m.ROOT_KEY,'owner',{'S':'new-owner'}),(m.OLD_ATTEMPT_KEY,'nonce',{'S':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'})]:
            e=evidence();f=Fake(e);p=self.plan(f,e);f.items[key][field]=value
            with self.subTest(key=key),self.assertRaises(m.GuardError):m.apply(f,e,p,m.sha(p),CTX,True)
            self.assertEqual(f.writes,0)

    def test_changed_form_bank_columns_or_runtime_block(self):
        mutations=[lambda f,v:v['review'].update(changed=True),lambda f,v:v['columnEvidence'].update(changed=True),
          lambda f,v:v['runtime'].update(revisionId='changed')]
        for mutate in mutations:
            e=evidence();f=Fake(e);p=self.plan(f,e);f.change=mutate
            with self.assertRaises(m.GuardError):m.apply(f,e,p,m.sha(p),CTX,True)
            self.assertEqual(f.writes,0)

    def test_freshness_and_explicit_authorization(self):
        e=evidence();f=Fake(e);p=self.plan(f,e)
        with self.assertRaises(m.GuardError):m.apply(f,e,p,m.sha(p),CTX,False)
        p['preparedUtc']=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=3)).isoformat()
        with self.assertRaisesRegex(m.GuardError,'TOO_OLD'):m.apply(f,e,p,m.sha(p),CTX,True)
        self.assertEqual(f.writes,0)

    def test_archive_or_next_claim_prevents_adjudication(self):
        for mutation in [lambda f:f.items[m.ARCHIVE_KEY].update(extra={'S':'changed'}),
          lambda f:f.items.update({m.NEXT_ATTEMPT_KEY:{'pk':{'S':m.NEXT_ATTEMPT_KEY}}})]:
            e=evidence();f=Fake(e);mutation(f)
            with self.assertRaises(m.GuardError):self.plan(f,e)
            self.assertEqual(f.writes,0)

    def test_apply_requires_reviewed_code_and_plan_pins(self):
        e=evidence();f=Fake(e);p=self.plan(f,e);p['sourceFilesSha256']={'x':'changed'}
        with self.assertRaises(m.GuardError):m.apply(f,e,p,m.sha(p),CTX,True)
        self.assertEqual(f.writes,0)

    def test_no_write_capability_in_prepare_live_backend(self):
        live=m.Live.__new__(m.Live);live.apply_enabled=False;live.sent=False
        with self.assertRaises(m.GuardError):live.transact({})
        with self.assertRaises(m.GuardError):live.aws('transact-write-items',{})
        with self.assertRaises(m.GuardError):live.aws('put-item',{})

    def test_fresh_observation_deadline_and_change_during_read_block(self):
        e=evidence();f=Fake(e)
        with patch.object(m.time,'monotonic',side_effect=[100,161]):
            with self.assertRaisesRegex(m.GuardError,'60_SECONDS'):m.observe_unchanged(f,e)
        f=Fake(e);p=self.plan(f,e)
        def change_root(fake,_):fake.items[m.ROOT_KEY]['lockUntil']={'N':'9999999999999'}
        f.change=change_root
        with self.assertRaisesRegex(m.GuardError,'LEASE2'):m.apply(f,e,p,m.sha(p),CTX,True)
        self.assertEqual(f.writes,0)

    def test_receipt_cannot_relabel_observed_no_effect_as_historical_rollback(self):
        import json
        c=claim();receipt=m.make_receipt(c,m.utc(),f'https://github.com/{m.REPOSITORY}/actions/runs/41999999999')
        proof=json.loads(receipt['proofJson']['S']);proof['historicalRollbackProven']=True
        receipt['proofJson']['S']=m.canonical(proof);receipt['proofSha256']['S']=m.sha(proof)
        with self.assertRaisesRegex(m.GuardError,'CONTENT_CHANGED'):m.validate_manual_retry_receipt(receipt,c)

    def test_only_review_runtime_can_change_and_original_source_is_preserved(self):
        e=evidence();original=copy.deepcopy(e['review']);current=m.expected_current_review(e['review'])
        self.assertEqual(e['review'],original)
        self.assertEqual(current['baseline']['remoteSources']['runtime'],m.CURRENT_RUNTIME)
        restored=copy.deepcopy(current);restored['baseline']['remoteSources']['runtime']=copy.deepcopy(m.SOURCE_RUNTIME)
        self.assertEqual(restored,original)
        f=Fake(e);f.change=lambda _,value:value['review'].update(fixed='changed')
        with self.assertRaises(m.GuardError):m.observe_unchanged(f,e)
        with self.assertRaises(m.GuardError):m.expected_current_review(current)
        proof=m.receipt_proof(claim())
        self.assertEqual(proof['sourceRuntime'],m.SOURCE_RUNTIME);self.assertEqual(proof['currentRuntime'],m.CURRENT_RUNTIME)
        self.assertEqual(proof['runtimePublication'],m.RUNTIME_PROVENANCE)


if __name__=='__main__':unittest.main()
