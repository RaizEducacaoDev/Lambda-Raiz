"""Administrative CAS only; offline state store, no credentials or real AWS."""
import copy, importlib.util, json, tempfile, unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('restore_control_226610_test',ROOT/'scripts/restore-bank-226610-control.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

def proof():
 before={'digest':{'S':'9275ae92d1ab0b880287309c8eb9cccb658c8fcd3a35045fd404204476805fd2'},
  'lockUntil':{'N':'1793828452858'},'owner':{'S':'7a371fce-223e-4ed1-9acc-228389814890'},'pg':{'S':'42677'},
  'pk':{'S':m.PK},'protocolVersion':{'N':'2'},'recuperadaCriacaoIncerta':{'BOOL':True},'state':{'S':'CREATED'},
  'reconciliationEvidenceKey':{'S':m.PK+'#ADJUDICATION#e1a50fdc79094cf33e2a991cd553daa6979f9195c46c9a56a02be072178e7366'}}
 owner='b769cbe2-4a28-4f20-acb2-fb5f9a086dfc'
 return {'version':1,'ticket':226610,'company':25,'idmov':42677,'idlan':79094,'owner':owner,
  'expiresAtEpoch':1793838130,'conditionMatched':True,'rootBusinessUnchanged':True,
  'before':before,'leasedRoot':{**before,'owner':{'S':owner},'lockUntil':{'N':'1793838130676'}},
  'archiveKey':m.PK+'#BANK_REPAIR_LEASE#'+owner}

def claim(p):
 return {'pk':{'S':m.CLAIM},'nonce':{'S':'11111111-1111-4111-8111-111111111111'},'ticket':{'N':'226610'},
  'company':{'N':'25'},'idlan':{'N':'79094'},'leaseOwner':{'S':p['owner']},'planSha256':{'S':m.PLAN_SHA},
  'targetFieldsSha256':{'S':m.lease.sha({'IDPGTO':'5','CODCOLPGTO':'25'})},
  'state':{'S':'CLAIMED_NO_AUTOMATIC_RETRY'},'observedUtc':{'S':'2026-11-05T00:03:00+00:00'}}

class Controls(unittest.TestCase):
 def setUp(self):
  self.p=proof();self.items={m.PK:copy.deepcopy(self.p['leasedRoot']),m.CLAIM:claim(self.p),
                           self.p['archiveKey']:m.expected_archive(self.p)}
 def get(self,key):return copy.deepcopy(self.items.get(key,{}))
 def test_observe_exact_root_archive_and_claim_is_read_only(self):
  before=copy.deepcopy(self.items)
  with patch.object(m,'runtime',return_value=m.RUNTIME),patch.object(m.lease,'get',side_effect=self.get),patch.object(m.lease,'aws')as aws:
   plan=m.observe(self.p);self.assertEqual(plan['root'],self.p['leasedRoot']);self.assertEqual(plan['claim'],claim(self.p));aws.assert_not_called()
  self.assertEqual(before,self.items);self.assertEqual(m.lease.sha(self.p['before']),m.ROOT_SHA)
 def test_missing_or_changed_claim_root_archive_blocks(self):
  for key in self.items:
   for value in [{},{'changed':{'S':'different'}}]:
    with self.subTest(key=key),patch.dict(self.items,{key:value}),patch.object(m,'runtime',return_value=m.RUNTIME),patch.object(m.lease,'get',side_effect=self.get),patch.object(m.lease,'release')as release:
     with self.assertRaises(m.GuardError):m.observe(self.p)
     release.assert_not_called()
 def test_each_claim_critical_field_and_extra_attribute_blocks(self):
  for key in ['pk','ticket','company','idlan','leaseOwner','planSha256','targetFieldsSha256','state','nonce','extra']:
   c=claim(self.p);c[key]={'S':'changed'}
   with self.subTest(key=key),self.assertRaises((m.GuardError,ValueError)):m.validate_claim(c,self.p)
 def test_runtime_drift_during_read_blocks(self):
  with patch.object(m,'runtime',side_effect=[m.RUNTIME,{}]),patch.object(m.lease,'get',side_effect=self.get):
   with self.assertRaises(m.GuardError):m.observe(self.p)
 def test_prepare_configuration_never_authorizes_and_valid_approval_schema(self):
  c={'version':1,'mode':'prepare','authorizedControlRestore':False,'approvedPrepareRunId':'0','approvedManifestSha256':''}
  self.assertEqual(m.validate_config(c),c)
  a={**c,'mode':'apply','authorizedControlRestore':True,'approvedPrepareRunId':'888','approvedManifestSha256':'a'*64};self.assertEqual(m.validate_config(a),a)
  for changed in [{'authorizedControlRestore':True},{'version':True},{'mode':'apply'},{'ticket':228007}]:
   with self.assertRaises(m.GuardError):m.validate_config({**c,**changed})
 def test_single_cas_preserves_business_claim_archive_and_ack_loss_not_retried(self):
  for lost in [False,True]:
   with self.subTest(lost=lost),tempfile.TemporaryDirectory()as d:
    self.setUp();events=[];before=copy.deepcopy(self.items)
    plan={'root':self.get(m.PK),'archive':self.get(self.p['archiveKey']),'claim':self.get(m.CLAIM),'runtime':m.RUNTIME}
    def aws(service,operation,payload):
     self.assertEqual((service,operation),('dynamodb','update-item'));events.append(operation)
     self.assertEqual(payload['Key'],{'pk':{'S':m.PK}})
     names=payload['ExpressionAttributeNames'];values=payload['ExpressionAttributeValues']
     for name,field in names.items():
      if name.startswith('#b'):
       idx=name[2:];self.assertEqual(self.items[m.PK][field],values[':b'+idx]);self.assertIn(name+' = :b'+idx,payload['ConditionExpression'])
     self.assertEqual(payload['UpdateExpression'],'SET #owner = :newOwner, lockUntil = :newUntil')
     self.items[m.PK]['owner']=values[':newOwner'];self.items[m.PK]['lockUntil']=values[':newUntil']
     if lost:raise RuntimeError('acknowledgement lost')
     return{}
    with patch.object(m,'runtime',return_value=m.RUNTIME),patch.object(m.lease,'OUT',Path(d)),patch.object(m.lease,'get',side_effect=self.get),patch.object(m.lease,'aws',side_effect=aws):
     result=m.restore_once(self.p,plan)
    self.assertEqual(result['state'],'RESTORED_CONTROL_ONLY');self.assertEqual(result['acknowledgementLost'],lost)
    self.assertEqual(events,['update-item']);self.assertEqual(self.items[m.PK],self.p['before'])
    self.assertEqual(self.items[m.CLAIM],before[m.CLAIM]);self.assertEqual(self.items[self.p['archiveKey']],before[self.p['archiveKey']])
    self.assertEqual(self.items[m.PK]['state'],{'S':'CREATED'});self.assertEqual(self.items[m.PK]['pg'],{'S':'42677'})
 def test_changed_plan_blocks_before_shared_release(self):
  plan={'root':{},'archive':{},'claim':{},'runtime':m.RUNTIME}
  with patch.object(m,'runtime',return_value=m.RUNTIME),patch.object(m.lease,'get',side_effect=self.get),patch.object(m.lease,'release')as release:
   with self.assertRaises(m.GuardError):m.restore_once(self.p,plan)
   release.assert_not_called()
 def test_intervening_owner_cas_failure_no_second_update_or_overwrite(self):
  plan={'root':self.get(m.PK),'archive':self.get(self.p['archiveKey']),'claim':self.get(m.CLAIM),'runtime':m.RUNTIME};calls=[]
  def aws(*args):
   calls.append(args);self.items[m.PK]['owner']={'S':'intervening-owner'};raise RuntimeError('conditional failure')
  with tempfile.TemporaryDirectory()as d,patch.object(m,'runtime',return_value=m.RUNTIME),patch.object(m.lease,'OUT',Path(d)),patch.object(m.lease,'get',side_effect=self.get),patch.object(m.lease,'aws',side_effect=aws):
   with self.assertRaises(RuntimeError):m.restore_once(self.p,plan)
  self.assertEqual(len(calls),1);self.assertEqual(self.items[m.PK]['owner'],{'S':'intervening-owner'})
 def test_wrong_runtime_status_or_revision_block_without_exporting_environment(self):
  cfg={'CodeSha256':m.RUNTIME['codeSha256'],'RevisionId':m.RUNTIME['revisionId'],'State':'Active','LastUpdateStatus':'Successful','Environment':{'Variables':{'PASSWORD':'not-exported'}}}
  with patch.object(m.lease,'aws',return_value={'Account':m.lease.ACCOUNT}),patch.object(m.subprocess,'run',return_value=Mock(returncode=0,stdout=json.dumps(cfg))):
   self.assertEqual(m.runtime(),m.RUNTIME);self.assertNotIn('PASSWORD',json.dumps(m.runtime()))
  for key,value in [('RevisionId','changed'),('State','Pending'),('LastUpdateStatus','InProgress')]:
   with patch.object(m.lease,'aws',return_value={'Account':m.lease.ACCOUNT}),patch.object(m.subprocess,'run',return_value=Mock(returncode=0,stdout=json.dumps({**cfg,key:value}))),self.assertRaises(m.GuardError):m.runtime()
 def test_workflow_has_no_financial_secrets_native_service_or_invoke(self):
  text=(ROOT/m.WORKFLOW).read_text();self.assertIn('group: payment-backlog-bank-lease',text);self.assertIn('retention-days: 1',text)
  for forbidden in ['RECONCILE_ZEEV_TOKEN','SaveRecord','lambda invoke','update-function','workflow_dispatch']:self.assertNotIn(forbidden,text)
  self.assertNotIn('.github/restore-bank-226610-control.json',m.source_hashes())

class Provenance(unittest.TestCase):
 def meta(self):return {'id':int(m.RUN),'head_sha':m.COMMIT,'path':m.SOURCE_WORKFLOW,'repository':{'full_name':m.REPO},'head_branch':m.BRANCH,'event':'push','run_attempt':1,'status':'completed','conclusion':'failure'}
 def test_reference_exact_failure_is_finished_not_assumed_rollback(self):m.run_meta(self.meta(),m.RUN,m.COMMIT,m.SOURCE_WORKFLOW,'failure')
 def test_running_rerun_changed_commit_or_branch_blocks(self):
  for key,value in [('status','in_progress'),('run_attempt',2),('head_sha','b'*40),('head_branch','main'),('conclusion','success')]:
   with self.subTest(key=key),self.assertRaises(m.GuardError):m.run_meta({**self.meta(),key:value},m.RUN,m.COMMIT,m.SOURCE_WORKFLOW,'failure')
 def test_artifact_scope_expiry_and_run_enforced(self):
  good={'artifacts':[{'id':123,'name':'expected','expired':False,'workflow_run':{'id':int(m.RUN)}}]};m.artifact_meta(good,m.RUN,'expected',123)
  for key,value in [('id',999),('expired',True),('workflow_run',{'id':999})]:
   data=copy.deepcopy(good);data['artifacts'][0][key]=value
   with self.assertRaises(m.GuardError):m.artifact_meta(data,m.RUN,'expected',123)
 def test_manifest_corruption_and_source_change_prevent_restore(self):
  ctx={'repository':m.REPO,'branch':m.BRANCH,'workflow':m.WORKFLOW,'runId':'999','commit':'b'*40}
  for problem in ['manifest','source','plan']:
   with tempfile.TemporaryDirectory()as d:
    path=Path(d);(path/'plan.json').write_text('{}')
    manifest={'mode':'prepare','readOnly':True,'sourceHashes':{'source':'correct'},'runtime':m.RUNTIME,
     'workflow':{**ctx,'runId':'888','commit':'a'*40},'leaseFileSha256':m.LEASE_SHA,'planFileSha256':m.file_sha(path/'plan.json'),'planSha256':m.lease.sha({})}
    if problem=='source':manifest['sourceHashes']={}
    if problem=='plan':manifest['planFileSha256']='0'*64
    (path/'manifest.json').write_text(json.dumps(manifest));cfg={'approvedPrepareRunId':'888','approvedManifestSha256':'0'*64 if problem=='manifest'else m.file_sha(path/'manifest.json')}
    meta={**self.meta(),'id':888,'head_sha':'a'*40,'path':m.WORKFLOW,'conclusion':'success'}
    art={'artifacts':[{'id':123,'name':'restore-bank-226610-control-evidence','expired':False,'workflow_run':{'id':888}}]}
    with patch.object(m,'APPROVED',path),patch.object(m,'github',side_effect=lambda u:art if u.endswith('artifacts')else meta),patch.object(m,'source_hashes',return_value={'source':'correct'}),patch.object(m.lease,'release')as release:
     with self.assertRaises(m.GuardError):m.approved_plan(cfg,ctx)
     release.assert_not_called()

if __name__=='__main__':unittest.main()
