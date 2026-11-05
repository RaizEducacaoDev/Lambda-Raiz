"""Offline tests for the read-only V3 administrative lease proposal."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('lease_v3',ROOT/'scripts/prepare-payment-bank-lease-v3.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
CTX={'repository':m.REPOSITORY,'workflow':m.WORKFLOW,'runId':'41999999999','commit':'a'*40}
OLD={'pk':{'S':m.CLAIM_V1},'state':{'S':'CLAIMED_NO_AUTOMATIC_RETRY'},'fixture':{'S':'old'}}
RECEIPT={'pk':{'S':m.RECEIPT_KEY},'state':{'S':'NO_EFFECT_OBSERVED'},'fixture':{'S':'old receipt'}}

def claim():
    return {'pk':{'S':m.CLAIM_V2},'ticket':{'N':str(m.TICKET)},'company':{'N':str(m.COMPANY)},'idlan':{'N':str(m.IDLAN)},
      'leaseOwner':{'S':m.LEASE_OWNER},'planSha256':{'S':m.PLAN_SHA},
      'targetFieldsSha256':{'S':m.sha({'CODCOLPGTO':'5','IDPGTO':'1'})},'state':{'S':'CLAIMED_NO_AUTOMATIC_RETRY'},
      'nonce':{'S':'12345678-1234-1234-1234-123456789012'},'observedUtc':{'S':'2026-11-04T20:55:17Z'}}

def evidence():
    before={'pk':{'S':m.ROOT_KEY},'state':{'S':'CREATED'},'pg':{'S':str(m.IDMOV)},'digest':{'S':'a'*64},
      'owner':{'S':'12345678-0000-0000-0000-123456789012'},'lockUntil':{'N':'1793541106676'}}
    leased={**before,'owner':{'S':m.LEASE_OWNER},'lockUntil':{'N':'1793826884649'}}
    return {'lease':{'before':before,'leasedRoot':leased},'archive':{'pk':{'S':m.ARCHIVE_KEY},'original':{'M':before},
      'leaseOwner':leased['owner'],'leaseUntil':leased['lockUntil']},'review':{'baseline':'exact form bank source and payments'},
      'columns':{'fixture':'693 exact hashes'},'sourceHashes':{}}

class Fake:
    def __init__(self,e):
        self.e=e;self.items={m.ROOT_KEY:copy.deepcopy(e['lease']['leasedRoot']),m.ARCHIVE_KEY:copy.deepcopy(e['archive']),
          m.CLAIM_V1:copy.deepcopy(OLD),m.CLAIM_V2:claim(),m.RECEIPT_KEY:copy.deepcopy(RECEIPT)}
        self.reads=0;self.writes=0;self.change=None;self.receiptChecks=0
    def runtime(self):return copy.deepcopy(m.RUNTIME)
    def get(self,k):return copy.deepcopy(self.items.get(k,{}))
    def validate_receipt(self,r,c):
        self.receiptChecks+=1
        if r!=RECEIPT or c!=OLD:raise m.GuardError('RECEIPT_CHANGED')
    def observe(self,independent):
        self.reads+=1
        v={'observedUtc':m.utc(),'runtime':copy.deepcopy(m.RUNTIME),'review':copy.deepcopy(self.e['review']),'columns':copy.deepcopy(self.e['columns'])}
        if self.change:self.change(self,v)
        return v

class LeaseV3Tests(unittest.TestCase):
    def setUp(self):
        for name,value in [('CLAIM_V1_SHA',m.sha(OLD)),('RECEIPT_SHA',m.sha(RECEIPT)),('validate_columns',lambda x:None)]:
            p=patch.object(m,name,value);p.start();self.addCleanup(p.stop)

    def test_prepare_reads_twice_preserves_all_five_items(self):
        e=evidence();f=Fake(e);before=copy.deepcopy(f.items);v=m.prepare(f,e,CTX)
        self.assertEqual(f.reads,2);self.assertEqual(f.writes,0);self.assertEqual(f.items,before);self.assertEqual(f.receiptChecks,2)
        self.assertFalse(v['applyAuthorized']);self.assertFalse(v['newFinancialAttemptAuthorized']);self.assertFalse(v['automaticRetryAllowed'])
        self.assertEqual(v['proposal']['newReceipts'],0);self.assertEqual(v['proposal']['claimMutations'],0)
        self.assertEqual(v['controlItemSha256'],{k:m.sha(x) for k,x in before.items()})

    def test_pure_transaction_contains_only_four_checks_and_owner_lock_restore(self):
        e=evidence();f=Fake(e)
        with patch.object(m.subprocess,'run',side_effect=AssertionError('I/O')):tx=m.restoration_transaction(e,f.items)
        ops=tx['TransactItems'];self.assertEqual([next(iter(x)) for x in ops],['ConditionCheck']*4+['Update'])
        self.assertEqual([x['ConditionCheck']['Key']['pk']['S'] for x in ops[:4]],[m.CLAIM_V1,m.CLAIM_V2,m.ARCHIVE_KEY,m.RECEIPT_KEY])
        u=ops[-1]['Update'];self.assertEqual(u['Key']['pk']['S'],m.ROOT_KEY)
        self.assertEqual(u['UpdateExpression'],'SET #restoreOwner = :restoreOwner, lockUntil = :restoreLock')
        self.assertEqual(u['ExpressionAttributeValues'][':restoreOwner'],e['lease']['before']['owner'])
        self.assertEqual(u['ExpressionAttributeValues'][':restoreLock'],e['lease']['before']['lockUntil'])
        self.assertIn('attribute_not_exists',u['ConditionExpression'])
        for k in e['lease']['leasedRoot']:self.assertIn(k,u['ExpressionAttributeNames'].values())

    def test_each_control_item_change_blocks_before_or_during_observation(self):
        for key in m.CONTROL_KEYS:
            for during in (False,True):
                e=evidence();f=Fake(e)
                change=lambda fake,v:fake.items[key].update(extra={'S':'changed'})
                if during:f.change=change
                else:change(f,None)
                with self.subTest(key=key,during=during),self.assertRaises(m.GuardError):m.prepare(f,e,CTX)
                self.assertEqual(f.writes,0)

    def test_v2_claim_correlates_target_plan_fields_and_time(self):
        mutations={'pk':{'S':m.CLAIM_V1},'ticket':{'N':'227386'},'company':{'N':'11'},'idlan':{'N':'468'},
          'leaseOwner':{'S':'wrong'},'planSha256':{'S':'0'*64},'targetFieldsSha256':{'S':'0'*64},
          'state':{'S':'RETRY_ALLOWED'},'observedUtc':{'S':'2026-11-04T20:56:00Z'},'nonce':{'S':'not-uuid'}}
        for k,v in mutations.items():
            e=evidence();f=Fake(e);f.items[m.CLAIM_V2][k]=v
            with self.subTest(field=k),self.assertRaises(m.GuardError):m.prepare(f,e,CTX)

    def test_missing_either_claim_or_receipt_never_becomes_a_new_one(self):
        for key in (m.CLAIM_V1,m.CLAIM_V2,m.RECEIPT_KEY):
            e=evidence();f=Fake(e);del f.items[key]
            with self.subTest(key=key),self.assertRaises(m.GuardError):m.prepare(f,e,CTX)
            self.assertNotIn(key,f.items);self.assertEqual(f.writes,0)

    def test_form_bank_source_column_or_runtime_change_blocks(self):
        for field in ('review','columns','runtime'):
            e=evidence();f=Fake(e);f.change=lambda fake,v:v[field].update(changed=True)
            with self.subTest(field=field),self.assertRaises(m.GuardError):m.prepare(f,e,CTX)

    def test_stale_observation_and_slow_sweeps_block(self):
        e=evidence();f=Fake(e);f.change=lambda fake,v:v.update(observedUtc='2020-01-01T00:00:00Z')
        with self.assertRaisesRegex(m.GuardError,'NOT_FRESH'):m.prepare(f,e,CTX)
        with patch.object(m.time,'monotonic',side_effect=[100,161]):
            with self.assertRaisesRegex(m.GuardError,'60_SECONDS'):m.prepare(Fake(e),e,CTX)

    def test_live_aws_rejects_every_write_and_other_target_without_io(self):
        b=m.Live.__new__(m.Live)
        with patch.object(m.subprocess,'run',side_effect=AssertionError('I/O forbidden')):
            for op in ('put-item','update-item','delete-item','transact-write-items'):
                with self.subTest(op=op),self.assertRaises(m.GuardError):b.aws(op,{})
            with self.assertRaises(m.GuardError):b.get('prod#PG#5#228008')
            with self.assertRaises(m.GuardError):b.aws('get-item',{'TableName':m.TABLE,'ConsistentRead':False,'Key':{'pk':{'S':m.ROOT_KEY}}})
        self.assertFalse(hasattr(b,'transact'))

    def test_frozen_source_artifacts_fail_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);lease=p/'lease.json';lease.write_text('{}')
            with self.assertRaisesRegex(m.GuardError,'LEASE_FILE_CHANGED'):m.load_evidence(p,lease)

    def test_context_rejects_reruns_wrong_branch_or_manual_dispatch(self):
        env={'GITHUB_ACTIONS':'true','GITHUB_EVENT_NAME':'push','GITHUB_RUN_ATTEMPT':'1','GITHUB_REPOSITORY':m.REPOSITORY,
          'GITHUB_REF':'refs/heads/'+m.BRANCH,'GITHUB_RUN_ID':'41999999999','GITHUB_SHA':'a'*40}
        self.assertEqual(m.context(env),CTX)
        for key,value in [('GITHUB_RUN_ATTEMPT','2'),('GITHUB_EVENT_NAME','workflow_dispatch'),('GITHUB_REF','refs/heads/main')]:
            changed={**env,key:value}
            with self.assertRaises(m.GuardError):m.context(changed)

if __name__=='__main__':unittest.main()
