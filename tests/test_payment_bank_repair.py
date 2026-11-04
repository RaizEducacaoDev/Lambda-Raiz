"""No network and no production fixture. Exercise financial and AWS write boundaries."""
import copy,importlib.util,json,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('payment_bank_repair',ROOT/'scripts/repair-payment-bank-backlog.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

def fixture(ticket=228007):
 company,mov,lan,old,oldcol,target,targetcol=r.TARGETS[ticket]
 form={'codigoDaColigada2':str(company),'codigoDaFilial2':'1','codigoDoFornecedor':'0000000001','dataDeEmissao':'01/11/2026','dataDeEntrada':'02/11/2026','valorTotalDoPagamento':'100,00','qtdParcelas':'1'}
 key={'codColPgto':str(targetcol),'codColCfo':'0','codCfo':'0000000001','idPgto':str(target)}
 movement={'CODCOLIGADA':str(company),'CODFILIAL':'1','CODCOLCFO':'0','CODCFO':'0000000001','IDMOV':str(mov),'CODTMV':'1.2.03','NUMEROMOV':'000000100','SERIE':'1','CODTDO':'002','STATUS':'F','DATAEMISSAO':'2026-11-01','DATASAIDA':'2026-11-02','VALORBRUTO':'100.00','VALORLIQUIDO':'100.00'}
 launch={'CODCOLIGADA':str(company),'CODFILIAL':'1','CODCOLCFO':'0','CODCFO':'0000000001','IDMOV':str(mov),'IDLAN':str(lan),'IDPGTO':None if old is None else str(old),'CODCOLPGTO':None if oldcol is None else str(oldcol),'STATUSLAN':'0','VALORBAIXADO':'0.00','BAIXAPENDENTE':'0','IDBOLETO':None,'DATAVENCIMENTO':'2026-11-10','DATAEMISSAO':'2026-11-01','VALORORIGINAL':'100.00','CODTDO':'002'}
 plans=[{'valor':'100.00','vencimento':'2026-11-10','campos':[['IDPGTO',str(target)],['CODCOLPGTO',str(targetcol)]]}]
 return {'active':True,'flow':299,'tasks':['T07 - Fiscal'],'form':form,'formDigest':'current-form','bankRecordHash':'current-bank','dataset':'FinLAN','validation':{'aliasIdentity':{'valid':True},'bankValidation':{'valid':True},'payloadValidation':{'valid':True,'key':key,'codTmv':'1.2.03','digest':'current-intent'}},'plans':plans,
  'sqlMov':[copy.deepcopy(movement)],'nativeMov':[copy.deepcopy(movement)],'sqlLan':[copy.deepcopy(launch)],'nativeLan':[copy.deepcopy(launch)],'ticketLink':str(ticket),'payments':[{'IDLAN':str(lan),'VALOR':'100.00'}],
  'allOwnMovementKeys':[[company,mov]],'allOwnLaunchKeys':[[company,lan]],'boletoCount':0,'pendingPaymentCount':0,
  'document':[{'DOC_MATCH_COUNT':1,'IDMOV':mov,'TICKET':str(ticket),'EFFECTIVE_NUMBER':'000000100','EFFECTIVE_SERIES':'1','EFFECTIVE_DOCUMENT_TYPE':'002'}],
  'remoteSources':{'runtime':{'codeSha256':'fixed-runtime','revisionId':'fixed-revision'},'contracts':{'BANK2':'fixed-sql'}}}

def proof(ticket=228007):
 company,mov,lan,*_=r.TARGETS[ticket];owner='f22b99e5-1b12-4758-89cc-ceca6c9725e9';pk=f'prod#PG#{company}#{ticket}';until=int(time.time())+1200
 before={'pk':{'S':pk},'state':{'S':'CREATED'},'owner':{'S':'old-owner'},'lockUntil':{'N':str((int(time.time())-60)*1000)},'digest':{'S':'old-digest'},'pg':{'S':str(mov)}}
 leased={**before,'owner':{'S':owner},'lockUntil':{'N':str(until*1000)}}
 return {'version':1,'ticket':ticket,'company':company,'idmov':mov,'idlan':lan,'owner':owner,'expiresAtEpoch':until,'conditionMatched':True,'rootBusinessUnchanged':True,'workflowRunUrl':'https://github.com/org/repo/actions/runs/123','observedUtc':r.utc(),'before':before,'leasedRoot':leased,'archiveKey':pk+'#BANK_REPAIR_LEASE#'+owner}

class Adapter:
 def __init__(self,s):self.s=copy.deepcopy(s);self.reads=0;self.saves=0;self.claims=0;self.before_read=None;self.failure=None;self.response=None;self.extra_change=False
 def read(self,ticket,independent=False):
  self.reads+=1
  if self.before_read:self.before_read(self,self.reads)
  if self.failure=='readback'and self.saves:raise TimeoutError()
  return copy.deepcopy(self.s)
 def claim_dispatch(self,*args):self.claims+=1
 def bind_reference(self,snapshot,ticket):self.reference_identity=r.reference_for(snapshot,ticket)
 def save(self,ticket,xml):
  self.saves+=1;self.saved_xml=xml
  if self.failure=='timeout':raise TimeoutError()
  if self.failure!='short_write':
   fields={x.tag:x.text for x in r.ET.fromstring(xml).find('FLAN')if x.tag in r.WRITABLE}
   for row in self.s['sqlLan']+self.s['nativeLan']:row.update(fields)
  if self.extra_change:self.s['sqlLan'][0]['CODTDO']='unexpected'
  company,_,lan,*_=r.TARGETS[ticket]
  return self.response if self.response is not None else f'{company};{lan}'

class CoreSafety(unittest.TestCase):
 def run_case(self,adapter,directory,ticket=228007):
  manifest=r.review(adapter.s,ticket);path=Path(directory)/'lease.json';r.write_json(path,proof(ticket))
  return r.execute(adapter,ticket,manifest,r.digest(manifest),Path(directory),'test-control',path,r.hashlib.sha256(path.read_bytes()).hexdigest())
 def test_canary_only_two_payment_ids_and_verified(self):
  a=Adapter(fixture())
  with tempfile.TemporaryDirectory()as d:
   result=self.run_case(a,d);self.assertEqual(result['state'],'VERIFIED');self.assertEqual((a.saves,a.claims,a.reads),(1,1,4))
   fields={x.tag:x.text for x in r.ET.fromstring(a.saved_xml).find('FLAN')}
   self.assertEqual(set(fields),{'CODCOLIGADA','IDLAN','IDPGTO','CODCOLPGTO','CODCOLCFO','CODCFO'})
   self.assertEqual({k:fields[k]for k in r.REFERENCE},{'CODCOLCFO':'0','CODCFO':'0000000001'})
   self.assertEqual(result['changedFields'],['CODCOLPGTO','IDPGTO'])
 def test_each_of_eight_targets_qualifies_only_exact_ids(self):
  for ticket in r.TARGETS:
   s=fixture(ticket);r.review(s,ticket);s['nativeLan'][0]['IDLAN']='999'
   with self.assertRaises(r.GuardError):r.review(s,ticket)
 def test_stale_form_and_bank_block_before_claim(self):
  for key in('formDigest','bankRecordHash'):
   a=Adapter(fixture());a.before_read=lambda a,n:a.s.update({key:'changed'})if n==2 else None
   with tempfile.TemporaryDirectory()as d:
    with self.assertRaises(r.GuardError):self.run_case(a,d)
    self.assertEqual((a.claims,a.saves),(0,0))
 def test_timeout_and_second_invocation_never_retry(self):
  a=Adapter(fixture());a.failure='timeout'
  with tempfile.TemporaryDirectory()as d:
   with self.assertRaises(TimeoutError):self.run_case(a,d)
   with self.assertRaises(FileExistsError):self.run_case(a,d)
   self.assertEqual(a.saves,1);self.assertEqual(a.reads,4)
 def test_shortwrite_readback_failure_and_unexpected_column_change(self):
  for problem in('short_write','readback','other_column'):
   a=Adapter(fixture());a.failure=problem;a.extra_change=problem=='other_column'
   with tempfile.TemporaryDirectory()as d:
    with self.assertRaises(r.GuardError):self.run_case(a,d)
    self.assertEqual(a.saves,1)
    self.assertTrue((Path(d)/'readback-checks-228007.json').exists())
 def test_paid_boleto_and_extra_installment_block(self):
  for change in('paid','boleto','parcel'):
   s=fixture()
   if change=='paid':s['sqlLan'][0]['VALORBAIXADO']='1.00'
   elif change=='boleto':s['boletoCount']=1
   else:s['sqlLan'].append(copy.deepcopy(s['sqlLan'][0]))
   with self.assertRaises(r.GuardError):r.review(s,228007)
 def test_entry_omitted_preserved_explicit_mismatch_rejected(self):
  s=fixture();s['form']['dataDeEntrada']='';self.assertEqual(r.review(s,228007)['entryComparison'],'form_omitted_preserve_existing')
  s['form']['dataDeEntrada']='01/01/2000'
  with self.assertRaises(r.GuardError):r.review(s,228007)
 def test_long_preflight_stops_before_durable_claim(self):
  a=Adapter(fixture())
  with tempfile.TemporaryDirectory()as d,patch.object(r.time,'monotonic',side_effect=[0,61]):
   with self.assertRaises(r.GuardError):self.run_case(a,d)
   self.assertEqual(a.claims,0)
 def test_existing_barcode_changes_only_to_reviewed_plan(self):
  a=Adapter(fixture(227386));a.s['plans'][0]['campos'] += [['CODIGOBARRA','synthetic-new-barcode'],['IPTE','synthetic-new-line']]
  for row in a.s['nativeLan']+a.s['sqlLan']:row.update(CODIGOBARRA='synthetic-old',IPTE='synthetic-old')
  with tempfile.TemporaryDirectory()as d:self.assertEqual(self.run_case(a,d,227386)['state'],'VERIFIED')
 def test_money_and_datetime_normalization_preserves_precision(self):
  a={'AMOUNT':r.Decimal('2580.9600'),'WHEN':'2026-11-04T15:15:27.53','CODE':'00001'}
  b={'AMOUNT':r.Decimal('2580.96'),'WHEN':'2026-11-04 15:15:27.530000','CODE':'00001'}
  self.assertEqual(r.fingerprint(a),r.fingerprint(b));b['CODE']='1';self.assertNotEqual(r.fingerprint(a),r.fingerprint(b))
 def test_different_plan_or_expired_lease_blocks(self):
  with tempfile.TemporaryDirectory()as d:
   path=Path(d)/'lease.json';p=proof();p['expiresAtEpoch']=int(time.time())+30;r.write_json(path,p)
   with self.assertRaises(r.GuardError):r.validate_lease(path,r.hashlib.sha256(path.read_bytes()).hexdigest(),228007)
 def test_native_rejection_is_durably_sanitized_before_failed_readback(self):
  a=Adapter(fixture());a.failure='readback'
  a.response="Column 'CODCFO' does not allow nulls.\nCliente Maria; CPF 123.456.789-00; pix=maria@example.com\nAuthorization: Bearer secret-value"
  with tempfile.TemporaryDirectory()as d:
   with self.assertRaises(r.GuardError):self.run_case(a,d)
   evidence=json.loads((Path(d)/'native-response-228007.json').read_text())['diagnostic']
   self.assertEqual(evidence['reasonCode'],'RM_REQUIRED_FIELD');self.assertEqual(evidence['mentionedFields'],['CODCFO'])
   self.assertEqual(evidence['responseSha256'],r.hashlib.sha256(a.response.encode()).hexdigest())
   exported=''.join(p.read_text()for p in Path(d).glob('*.json'))
   for secret in ('Maria','123.456.789','maria@example.com','secret-value',a.response):self.assertNotIn(secret,exported)
   self.assertEqual(a.saves,1);self.assertEqual(json.loads((Path(d)/'attempt-228007.json').read_text())['state'],'OUTCOME_UNCERTAIN_NO_RETRY')
 def test_modification_audit_only_may_change_financial_dates_remain_immutable(self):
  for changed in ('DATAALTERACAO','DATAEMISSAO','DATAVENCIMENTO','DATAPREVBAIXA','CODCFO','CODCOLCFO'):
   before=fixture();after=copy.deepcopy(before)
   fields=r.qualify(before,228007)
   for row in after['sqlLan']+after['nativeLan']:row.update(fields);row[changed]='2026-11-04'if changed.startswith('DATA')else'other'
   if changed=='DATAALTERACAO':r.validate_after(before,after,228007,fields)
   else:
    with self.assertRaises(r.GuardError):r.validate_after(before,after,228007,fields)
 def test_reference_must_match_both_native_and_sql_and_global_supplier_keeps_zeros(self):
  s=fixture();self.assertEqual(r.reference_for(s,228007),{'CODCOLCFO':'0','CODCFO':'0000000001'})
  for key in r.REFERENCE:
   wrong=copy.deepcopy(s);wrong['nativeLan'][0][key]='9'
   with self.assertRaises(r.GuardError):r.reference_for(wrong,228007)
  with self.assertRaises(r.GuardError):r.xml_for(228007,{'IDPGTO':'1','CODCOLPGTO':'5'}, {'CODCOLCFO':'0','CODCFO':''})
  with self.assertRaises(r.GuardError):r.xml_for(228007,{'IDPGTO':'1','CODCOLPGTO':'5','CODCFO':'foreign'},r.reference_for(s,228007))

class AwsBoundary(unittest.TestCase):
 def setUp(self):
  self.proof=proof();self.pk=self.proof['before']['pk']['S'];self.events=[]
  self.store={self.pk:copy.deepcopy(self.proof['leasedRoot']),self.proof['archiveKey']:{'pk':{'S':self.proof['archiveKey']},'original':{'M':self.proof['before']},'leaseOwner':self.proof['leasedRoot']['owner'],'leaseUntil':self.proof['leasedRoot']['lockUntil']}}
 def get(self,key):self.events.append(('get',key));return copy.deepcopy(self.store.get(key,{}))
 def aws(self,service,op,payload):
  self.assertEqual((service,op),('dynamodb','put-item'));self.assertEqual(payload['ConditionExpression'],'attribute_not_exists(pk)')
  key=payload['Item']['pk']['S'];self.events.append(('put',key))
  if key in self.store:raise RuntimeError('conditional failed')
  self.store[key]=copy.deepcopy(payload['Item']);return{}
 def adapter(self):
  a=r.RemoteLiveAdapter(228007,self.proof);a.rm_auth='Basic synthetic';a.rm_user='synthetic'
  a.bind_reference(fixture(),228007)
  a.preflight_deadline=time.monotonic()+60
  a.native_save_http=lambda *args:self.events.append(('post','native'))or'5;634500'
  return a
 def test_last_external_call_before_post_is_consistent_exact_root_get(self):
  a=self.adapter();fields={'IDPGTO':'1','CODCOLPGTO':'5'}
  with patch.object(r.lease_module,'get',self.get),patch.object(r.lease_module,'aws',self.aws):
   a.claim_dispatch(228007,'review-sha',self.proof,fields);a.save(228007,r.xml_for(228007,fields,a.reference_identity))
  self.assertEqual(self.events[-2:],[('get',self.pk),('post','native')])
 def test_revoked_or_replaced_owner_after_claim_stops_native_post(self):
  a=self.adapter();fields={'IDPGTO':'1','CODCOLPGTO':'5'}
  with patch.object(r.lease_module,'get',self.get),patch.object(r.lease_module,'aws',self.aws):
   a.claim_dispatch(228007,'review-sha',self.proof,fields);self.store[self.pk]['owner']={'S':'other-owner'}
   with self.assertRaises(r.GuardError):a.save(228007,r.xml_for(228007,fields,a.reference_identity))
  self.assertFalse(any(e[0]=='post'for e in self.events))
 def test_second_workflow_process_cannot_claim_same_ticket(self):
  first=self.adapter();second=self.adapter();fields={'IDPGTO':'1','CODCOLPGTO':'5'}
  with patch.object(r.lease_module,'get',self.get),patch.object(r.lease_module,'aws',self.aws):
   first.claim_dispatch(228007,'sha',self.proof,fields)
   with self.assertRaises(r.GuardError):second.claim_dispatch(228007,'sha',self.proof,fields)
  self.assertFalse(any(e[0]=='post'for e in self.events))
 def test_claim_lost_reply_confirmed_once_without_second_put(self):
  a=self.adapter();calls=[]
  def lost(*args):self.aws(*args);calls.append(1);raise TimeoutError()
  with patch.object(r.lease_module,'get',self.get),patch.object(r.lease_module,'aws',lost):a.claim_dispatch(228007,'sha',self.proof,{'IDPGTO':'1','CODCOLPGTO':'5'})
  self.assertEqual(len(calls),1);self.assertIsNotNone(a.claimed)
 def test_save_xml_cannot_escape_reviewed_fields(self):
  a=self.adapter();fields={'IDPGTO':'1','CODCOLPGTO':'5'}
  with patch.object(r.lease_module,'get',self.get),patch.object(r.lease_module,'aws',self.aws):
   a.claim_dispatch(228007,'sha',self.proof,fields)
   with self.assertRaises(r.GuardError):a.save(228007,r.xml_for(228007,{'IDPGTO':'99','CODCOLPGTO':'5'},a.reference_identity))
  self.assertFalse(any(e[0]=='post'for e in self.events))
 def test_same_adapter_never_resubmits_native(self):
  a=self.adapter();fields={'IDPGTO':'1','CODCOLPGTO':'5'}
  with patch.object(r.lease_module,'get',self.get),patch.object(r.lease_module,'aws',self.aws):
   a.claim_dispatch(228007,'sha',self.proof,fields);a.save(228007,r.xml_for(228007,fields,a.reference_identity))
   with self.assertRaises(r.GuardError):a.save(228007,r.xml_for(228007,fields,a.reference_identity))
  self.assertEqual(sum(e[0]=='post'for e in self.events),1)
 def test_slow_last_aws_get_cannot_send_stale_snapshot(self):
  a=self.adapter();fields={'IDPGTO':'1','CODCOLPGTO':'5'}
  with patch.object(r.lease_module,'get',self.get),patch.object(r.lease_module,'aws',self.aws):
   a.claim_dispatch(228007,'sha',self.proof,fields);a.preflight_deadline=time.monotonic()-1
   with self.assertRaises(r.GuardError):a.save(228007,r.xml_for(228007,fields,a.reference_identity))
  self.assertFalse(any(e[0]=='post'for e in self.events))
 def test_reference_is_mandatory_immutable_and_cannot_rebind_after_claim(self):
  for problem in ('missing','foreign','rebind'):
   a=self.adapter();fields={'IDPGTO':'1','CODCOLPGTO':'5'}
   with patch.object(r.lease_module,'get',self.get),patch.object(r.lease_module,'aws',self.aws):
    a.claim_dispatch(228007,'sha',self.proof,fields)
    with self.assertRaises(r.GuardError):
     if problem=='rebind':a.bind_reference(fixture(),228007)
     else:
      xml=r.xml_for(228007,fields,a.reference_identity)
      xml=xml.replace('<CODCFO>0000000001</CODCFO>',''if problem=='missing'else'<CODCFO>0000000099</CODCFO>')
      a.save(228007,xml)
   self.assertFalse(any(e[0]=='post'for e in self.events));self.store.pop(self.pk+'#BANK_REPAIR_ATTEMPT',None)

class NativeDiagnostic(unittest.TestCase):
 def test_multiline_1586_chars_has_only_fixed_codes_and_no_native_values(self):
  raw="CODCFO: nao pode ser nulo\n"+'fornecedor=José; conta=12345; chave=person@example.com; senha=private-value\n'*24
  raw=raw[:1586].ljust(1586,'x');d=r.native_diagnostic(raw)
  self.assertEqual(d['length'],1586);self.assertEqual(d['reasonCode'],'RM_REQUIRED_FIELD');self.assertEqual(d['mentionedFields'],['CODCFO'])
  self.assertFalse(d['rawRetained']);self.assertNotIn('private-value',json.dumps(d));self.assertNotIn('person@example.com',json.dumps(d))
 def test_unclassified_response_does_not_become_safe_retry_or_success(self):
  d=r.native_diagnostic('Erro desconhecido; retorno sem chave','5;634500')
  self.assertFalse(d['exactKey']);self.assertEqual(d['reasonCode'],'RM_UNCLASSIFIED_RESPONSE');self.assertNotIn('retryAllowed',d)
 def test_native_http_fault_keeps_sanitized_diagnostic_without_raw(self):
  body=b'<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultstring>CODCOLCFO cannot be null; password=secret-value</faultstring></s:Fault></s:Body></s:Envelope>'
  class Response:
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def read(self,*a):return body
  a=r.RemoteLiveAdapter(228007);a.opener=type('Opener',(),{'open':lambda *args,**kwargs:Response()})()
  with self.assertRaises(r.NativeSaveError)as ctx:a.native_save_http(b'fake',{})
  self.assertEqual(str(ctx.exception),'BANK_SAVE_SOAP_FAULT');self.assertTrue(ctx.exception.diagnostic['flags']['soapFault'])
  self.assertEqual(ctx.exception.diagnostic['reasonCode'],'RM_REQUIRED_FIELD');self.assertNotIn('secret-value',json.dumps(ctx.exception.diagnostic))

class QueryContract(unittest.TestCase):
 def row(self):
  return {'BANK_VERSION':1,'REQUEST_COMPANY':5,'REQUEST_TICKET':228007,'REQUEST_IDMOV':165611,'REQUEST_IDLAN':634500,'EXACT_SCOPE_ALLOWED':1,'MOVEMENT_JSON':'[]','LAUNCH_JSON':'[{"VALORORIGINAL":2580.9600}]','OWNED_MOVEMENTS_JSON':'[]','OWNED_LAUNCHES_JSON':'[]','COMPLEMENT_JSON':'[{"TICKET":"228007"}]','BOLETO_COUNT':0,'PAYMENT_COUNT':0}
 def test_json_decimals_are_not_binary_floats(self):
  data=r.parse_bank_query([self.row()],228007);self.assertIsInstance(data['LAUNCH_JSON'][0]['VALORORIGINAL'],r.Decimal)
 def test_wrong_scope_and_truncation_fail(self):
  row=self.row();row['REQUEST_IDLAN']=1
  with self.assertRaises(r.GuardError):r.parse_bank_query([row],228007)
  with self.assertRaises(r.GuardError):r.parse_bank_query([self.row(),self.row()],228007)

if __name__=='__main__':unittest.main(verbosity=2)
