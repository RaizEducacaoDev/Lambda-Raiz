"""Offline tests: no credentials, network, AWS writes or real financial fixtures."""
import copy,importlib.util,io,json,tempfile,time,unittest,urllib.error
from pathlib import Path
from unittest.mock import Mock,patch
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('diag_v3_test',ROOT/'scripts/run-payment-bank-diagnostic-v3.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);c=m.c

def meta(pin):return {'id':int(pin['id']),'head_sha':pin['commit'],'path':pin['workflow'],'repository':{'full_name':'RaizEducacaoDev/Lambda-Raiz'},'head_branch':'fix/idpgto-vinculo-obrigatorio','run_attempt':1,'event':'push','status':'completed','conclusion':'success'}
class Controls(unittest.TestCase):
 def setUp(self):
  self.items={key:{'pk':{'S':key},'synthetic':{'S':'unchanged'}}for key in c.ITEM_HASHES}
  self.items[c.ROOT_KEY]={'pk':{'S':c.ROOT_KEY},'owner':{'S':'original'}}
  self.pins={key:c.sha(self.items[key])for key in c.ITEM_HASHES}
  self.a=patch.object(c,'ITEM_HASHES',self.pins);self.a.start();self.b=patch.object(c,'ROOT_SHA',c.sha(self.items[c.ROOT_KEY]));self.b.start();self.addCleanup(self.a.stop);self.addCleanup(self.b.stop)
  self.proof=c.proof_template()
 def get(self,key):return copy.deepcopy(self.items.get(key,{}))
 def test_exact_prior_claims_receipt_archive_and_restored_root_read_only(self):
  before=copy.deepcopy(self.items);self.assertEqual(c.assert_controls(self.get,self.proof,True),c.CLAIM_V3);self.assertEqual(self.items,before)
 def test_each_old_control_changed_or_missing_blocks(self):
  for key in c.ITEM_HASHES:
   for value in ({},{'changed':True}):
    with self.subTest(key=key),patch.dict(self.items,{key:value}):
     with self.assertRaises(c.GuardError):c.assert_controls(self.get,self.proof,True)
 def test_root_not_restored_blocks_before_lease(self):
  self.items[c.ROOT_KEY]['owner']={'S':'other'}
  with self.assertRaises(c.GuardError):c.assert_controls(self.get,self.proof,True)
 def test_versioned_claim_once_even_if_lease_expired(self):
  self.items[c.CLAIM_V3]={'pk':{'S':c.CLAIM_V3},'state':{'S':'UNKNOWN'}}
  with self.assertRaises(c.GuardError):c.assert_controls(self.get,self.proof)
 def test_only_own_exact_new_claim_can_be_read_before_http(self):
  own={'pk':{'S':c.CLAIM_V3},'nonce':{'S':'own'}};self.items[c.CLAIM_V3]=own
  self.assertEqual(c.assert_controls(self.get,self.proof,own_claim=own),c.CLAIM_V3)
  with self.assertRaises(c.GuardError):c.assert_controls(self.get,self.proof,own_claim={**own,'nonce':{'S':'other'}})
 def test_proof_cannot_change_target_runtime_or_automatic_retry(self):
  for key,value in [('ticket',999),('runtime',{'codeSha256':'different'}),('automaticRetryAllowed',True)]:
   proof=copy.deepcopy(self.proof);proof[key]=value
   with self.assertRaises(c.GuardError):c.validate_proof(proof)
 def test_v3_scope_does_not_admit_seven_other_tickets(self):
  for pair in [(18,227386),(5,999),(True,228007)]:
   with self.assertRaises(RuntimeError):m.op.claim_gate.assert_diagnostic_ready(self.get,*pair,self.proof)
 def test_old_v2_gate_stays_separate(self):
  self.assertEqual(m.op.claim_gate.attempt_key(5,228007),c.CLAIM_V2);self.assertNotEqual(c.CLAIM_V2,c.CLAIM_V3)

class Provenance(unittest.TestCase):
 def test_exact_reference_run(self):
  for pin in c.RUNS.values():c.validate_run(meta(pin),pin)
 def test_failed_rerun_other_branch_commit_or_repository_blocks(self):
  pin=c.RUNS['hml']
  for field,value in [('conclusion','failure'),('run_attempt',2),('head_branch','main'),('head_sha','0'*40),('repository',{'full_name':'other/repo'}),('path','other.yml')]:
   item=meta(pin);item[field]=value
   with self.assertRaises(c.GuardError):c.validate_run(item,pin)
 def test_corrupt_or_missing_reference_artifact_never_validates(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);(root/'applied.json').write_text('{}')
   with self.assertRaises(c.GuardError):c.load_proof(root,root,{k:meta(v)for k,v in c.RUNS.items()})
 def test_config_default_read_only_and_apply_needs_new_pinned_prepare(self):
  value={'version':1,'mode':'prepare','authorizedDiagnosticWrite':False,'approvedPrepareRunId':'0','approvedManifestSha256':''};self.assertEqual(m.config(value),value)
  for changed in ({'authorizedDiagnosticWrite':True},{'mode':'apply'},{'version':True}):
   with self.assertRaises(m.op.GuardError):m.config({**value,**changed})
 def test_runtime_constant_pins_only_v3(self):
  self.assertEqual(c.RUNTIME,{'codeSha256':'f4driLg+9qhXQN4A7hvgLvKrmpotW1EtSsk35lIVVVM=','revisionId':'08becd62-7243-43b3-b7c2-e2adb52215d7'})
 def test_new_workflow_private_one_day_shared_lease_group(self):
  text=(ROOT/m.WORKFLOW).read_text(encoding='utf-8');self.assertIn('retention-days: 1',text);self.assertIn('group: payment-backlog-bank-lease',text);self.assertNotIn('lambda invoke',text)
 def test_common_manifest_pins_new_dependency_without_changing_v2(self):
  self.assertIn('scripts/payment_bank_diagnostic_contract.py',m.common.code_hashes())
 def test_adulterated_manifest_or_source_blocks_before_any_lease(self):
  proof=c.proof_template();ctx={'repository':m.common.REPOSITORY,'branch':m.common.BRANCH,'workflow':m.WORKFLOW,'runId':'999','commit':'b'*40}
  prepare_ctx={**ctx,'runId':'888','commit':'a'*40};metadata=meta({'id':'888','commit':'a'*40,'workflow':m.WORKFLOW})
  for problem in('manifest','source','plan'):
   with tempfile.TemporaryDirectory()as d:
    path=Path(d);(path/'plan.json').write_text('{}')
    manifest={'version':1,'mode':'prepare','readOnly':True,'workflow':prepare_ctx,'sourceHashes':{'current':'good'},'runtime':c.RUNTIME,'proof':proof,'planSha256':m.op.digest({}),'planFileSha256':m.file_sha(path/'plan.json')}
    if problem=='source':manifest['sourceHashes']={'current':'bad'}
    if problem=='plan':manifest['planFileSha256']='0'*64
    (path/'manifest.json').write_text(json.dumps(manifest))
    cfg={'approvedPrepareRunId':'888','approvedManifestSha256':'0'*64 if problem=='manifest'else m.file_sha(path/'manifest.json')}
    with patch.object(m,'APPROVED',path),patch.object(m,'github_run',return_value=metadata),patch.object(m,'source_hashes',return_value={'current':'good'}),patch.object(m.lease,'acquire')as acquire:
     with self.assertRaises(m.op.GuardError):m.approved_plan(cfg,ctx,proof)
     acquire.assert_not_called()

class Capture(unittest.TestCase):
 def adapter(self,d):
  a=m.DiagnosticAdapter(c.proof_template(),message_dir=Path(d));a.save_attempted=True;a.claimed={'pk':{'S':c.CLAIM_V3},'nonce':{'S':'one'}};a.claimed_fields={'IDPGTO':'1','CODCOLPGTO':'5'};a.preflight_deadline=time.monotonic()+60
  a.config=Mock(return_value=c.RUNTIME);a.assert_live_lease=Mock();a.secret_values=['secret-password','secret-token','person@example.com','123.456.789-00','Maria Private']
  return a
 def response(self,body):
  class Response:
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def read(self,*args):return body
  return Response()
 def body(self,message):return ('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><SaveRecordResponse xmlns="http://www.totvs.com/"><SaveRecordResult>'+message+'</SaveRecordResult></SaveRecordResponse></s:Body></s:Envelope>').encode()
 def assert_private(self,d):
  raw=(Path(d)/'native-response-redacted.txt').read_text(encoding='utf-8');self.assertIn('Motivo nativo completo',raw)
  for private in ('secret-password','secret-token','person@example.com','123.456.789-00','Maria Private'):self.assertNotIn(private,raw)
  self.assertTrue((Path(d)/'native-response-private-metadata.json').exists())
 def test_nonkey_message_is_full_redacted_at_single_http_call(self):
  message='Motivo nativo completo.\nCampo IDPGTO rejeitado.\nMaria Private person@example.com 123.456.789-00\nPassword=secret-password\nBearer secret-token'
  with tempfile.TemporaryDirectory()as d:
   a=self.adapter(d);a.opener=Mock();a.opener.open.return_value=self.response(self.body(message))
   with patch.object(c,'assert_controls'):
    result=a.native_save_http(b'not-persisted',{'Authorization':'not-persisted'})
    self.assertEqual(result,message)
    with self.assertRaises(m.op.GuardError):a.native_save_http(b'not-persisted',{})
   self.assert_private(d);self.assertEqual(a.opener.open.call_count,1);self.assertEqual(a.opener.open.call_args.kwargs['timeout'],15)
 def test_soapfault_also_retained_before_error(self):
  body=b'<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultstring>Motivo nativo completo. Password=secret-password</faultstring></s:Fault></s:Body></s:Envelope>'
  with tempfile.TemporaryDirectory()as d:
   a=self.adapter(d);a.opener=Mock();a.opener.open.return_value=self.response(body)
   with patch.object(c,'assert_controls'),self.assertRaises(m.op.NativeSaveError):a.native_save_http(b'fake',{})
   self.assert_private(d);self.assertEqual(a.opener.open.call_count,1)
 def test_http_error_body_retained_without_second_call(self):
  with tempfile.TemporaryDirectory()as d:
   a=self.adapter(d);a.opener=Mock();a.opener.open.side_effect=urllib.error.HTTPError('https://synthetic.invalid',500,'not logged',{},io.BytesIO(b'Motivo nativo completo. Password=secret-password'))
   with patch.object(c,'assert_controls'),self.assertRaises(m.op.NativeSaveError):a.native_save_http(b'fake',{})
   self.assert_private(d);self.assertEqual(a.opener.open.call_count,1)
 def test_timeout_never_allows_another_http_save(self):
  with tempfile.TemporaryDirectory()as d:
   a=self.adapter(d);a.opener=Mock();a.opener.open.side_effect=TimeoutError()
   with patch.object(c,'assert_controls'):
    with self.assertRaises(m.op.GuardError):a.native_save_http(b'fake',{})
    with self.assertRaises(m.op.GuardError):a.native_save_http(b'fake',{})
   self.assertEqual(a.opener.open.call_count,1)
 def test_partial_response_is_retained_but_not_retried(self):
  with tempfile.TemporaryDirectory()as d:
   a=self.adapter(d);a.opener=Mock();a.opener.open.return_value=self.response(b'ignored')
   response=self.response(b'ignored');response.read=lambda *args:(_ for _ in()).throw(m.http.client.IncompleteRead(b'Motivo nativo completo. Password=secret-password',20));a.opener.open.return_value=response
   with patch.object(c,'assert_controls'),self.assertRaises(m.op.NativeSaveError):a.native_save_http(b'fake',{})
   self.assert_private(d);metadata=json.loads((Path(d)/'native-response-private-metadata.json').read_text());self.assertFalse(metadata['completeResponse']);self.assertEqual(a.opener.open.call_count,1)
 def test_soap_header_is_never_retained(self):
  body='<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Header>not-a-message</s:Header><s:Body><diagnostic>Motivo nativo completo.</diagnostic></s:Body></s:Envelope>'
  with tempfile.TemporaryDirectory()as d:
   a=self.adapter(d);a.capture_message(body,'TEST',True);text=(Path(d)/'native-response-redacted.txt').read_text();self.assertNotIn('not-a-message',text);self.assertNotIn('Header',text)
 def test_stale_or_changed_runtime_blocks_before_post(self):
  for case in ('stale','runtime'):
   with tempfile.TemporaryDirectory()as d:
    a=self.adapter(d);a.opener=Mock()
    if case=='stale':a.preflight_deadline=time.monotonic()-1
    else:a.config.return_value={'codeSha256':'different'}
    with patch.object(c,'assert_controls'),self.assertRaises(m.op.GuardError):a.native_save_http(b'fake',{})
    a.opener.open.assert_not_called()
 def test_seven_other_target_field_selection_never_dispatched(self):
  with tempfile.TemporaryDirectory()as d:
   a=self.adapter(d);a.claimed_fields={'IDPGTO':'7','CODCOLPGTO':'18'};a.opener=Mock()
   with self.assertRaises(m.op.GuardError):a.native_save_http(b'fake',{})
   a.opener.open.assert_not_called()
 def test_known_pii_collection_does_not_modify_payload(self):
  value={'form':{'nomeDoFornecedor':'Maria Private','codigoDaColigada2':'5'},'bank':{'CHAVE':'person@example.com','CONTA':'123456','IDPGTO':'1'}};before=copy.deepcopy(value)
  self.assertIn('person@example.com',m.redaction.known_pii(value));self.assertIn('123456',m.redaction.known_pii(value));self.assertEqual(value,before)

class FullSyntheticFlow(unittest.TestCase):
 def test_apply_claim_and_single_http_success_rejection_or_lost_ack(self):
  helper=m.load('diag_bank_test_helpers',ROOT/'tests/test_payment_bank_repair.py')
  for outcome in('success','nonkey','after_commit_timeout'):
   with self.subTest(outcome=outcome),tempfile.TemporaryDirectory()as d:
    root=Path(d);state=helper.fixture();state['remoteSources']['runtime']=copy.deepcopy(c.RUNTIME)
    lp=helper.proof();store={c.ROOT_KEY:copy.deepcopy(lp['before'])}
    for key in c.ITEM_HASHES:store[key]={'pk':{'S':key},'synthetic':{'S':'must-stay'}}
    pins={key:c.sha(store[key])for key in c.ITEM_HASHES};prior=copy.deepcopy(store);events=[]
    get=lambda key:copy.deepcopy(store.get(key,{}))
    def aws(service,operation,payload):
     if(service,operation)==('sts','get-caller-identity'):return {'Account':m.lease.ACCOUNT}
     self.assertEqual((service,operation),('dynamodb','put-item'));self.assertEqual(payload['ConditionExpression'],'attribute_not_exists(pk)')
     key=payload['Item']['pk']['S'];self.assertEqual(key,c.CLAIM_V3)
     if key in store:raise RuntimeError('conditional')
     store[key]=copy.deepcopy(payload['Item']);events.append('claim');return{}
    def acquire(*args):
     events.append('lease');store[c.ROOT_KEY]=copy.deepcopy(lp['leasedRoot']);store[lp['archiveKey']]={'pk':{'S':lp['archiveKey']},'original':{'M':lp['before']},'leaseOwner':lp['leasedRoot']['owner'],'leaseUntil':lp['leasedRoot']['lockUntil']}
     m.op.write_json(root/'lease-228007.json',lp)
    class Response:
     def __enter__(self):return self
     def __exit__(self,*args):pass
     def read(self,*args):
      events.append('http')
      if outcome!='nonkey':
       for row in state['sqlLan']+state['nativeLan']:row.update(IDPGTO='1',CODCOLPGTO='5')
      if outcome=='after_commit_timeout':raise TimeoutError()
      msg='5;634500'if outcome=='success'else'Motivo nativo completo. Campo bancário rejeitado.'
      return ('<Envelope xmlns="http://www.totvs.com/"><SaveRecordResult>'+msg+'</SaveRecordResult></Envelope>').encode()
    class Adapter(m.DiagnosticAdapter):
     def read(self,*args,**kwargs):events.append('read');return copy.deepcopy(state)
     def config(self):return c.RUNTIME
    with patch.object(c,'ITEM_HASHES',pins),patch.object(c,'ROOT_SHA',c.sha(lp['before'])):
     proof=c.proof_template();adapter=Adapter(proof,lp,root/'output/ticket-228007');adapter.secret_values=[];adapter.opener=Mock();adapter.opener.open.return_value=Response()
     plan=m.op.review(state,228007);(root/'audit.json').write_text(json.dumps({'coverageComplete':True}))
     with patch.object(m,'OUT',root/'output'),patch.object(m.common,'AUDIT',root/'audit.json'),patch.object(m.lease,'OUT',root),patch.object(m.lease,'get',side_effect=get),patch.object(m.lease,'aws',side_effect=aws),patch.object(m.lease,'acquire',side_effect=acquire),patch.object(m.lease,'release',return_value={'released':True,'originalRootExactlyRestored':True})as release,patch.object(m,'fresh_plan',return_value=plan),patch.object(m,'DiagnosticAdapter',return_value=adapter),patch.object(m.op.claim_gate,'assert_diagnostic_ready',side_effect=lambda getter,company,ticket,p:c.assert_controls(getter,p)):
      if outcome=='success':self.assertEqual(m.apply_once(proof,plan,{'runId':'999'})['state'],'VERIFIED');release.assert_called_once()
      else:
       with self.assertRaises(m.op.GuardError):m.apply_once(proof,plan,{'runId':'999'})
       release.assert_not_called()
      with self.assertRaises(c.GuardError):m.apply_once(proof,plan,{'runId':'999'})
     self.assertEqual(events.count('claim'),1);self.assertEqual(events.count('http'),1)
     self.assertLess(events.index('claim'),events.index('http'));self.assertEqual(events.count('read'),4)
     self.assertEqual(adapter.opener.open.call_args.kwargs['timeout'],15)
     for key in pins:self.assertEqual(store[key],prior[key])
     if outcome!='after_commit_timeout':self.assertTrue((root/'output/ticket-228007/native-response-redacted.txt').exists())

if __name__=='__main__':unittest.main()
