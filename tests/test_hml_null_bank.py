"""Pure tests for the fixed DEV clear/reattach protocol; never calls a service."""
import copy,importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('hml_null_test',ROOT/'scripts/probe-hml-null-bank.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def original():return m.ET.fromstring('<FinLAN><FLAN><CODCOLIGADA>11</CODCOLIGADA><IDLAN>148481</IDLAN><CODCOLCFO>0</CODCOLCFO><CODCFO>0000173261</CODCFO><IDPGTO>2</IDPGTO><CODCOLPGTO>11</CODCOLPGTO><VALORORIGINAL>1</VALORORIGINAL><DATAVENCIMENTO>2026-12-31</DATAVENCIMENTO></FLAN><FLANCOMPL><CODCOLIGADA>11</CODCOLIGADA><IDLAN>148481</IDLAN><CAMPO>preservar</CAMPO></FLANCOMPL></FinLAN>')
def snapshot(bank=('2','11')):
 mov={'CODCOLIGADA':'11','CODFILIAL':'1','IDMOV':'90767','CODCOLCFO':'0','CODCFO':'0000173261','CODTMV':'1.2.03','STATUS':'F','VALORBRUTO':'1','VALORLIQUIDO':'1'}
 lan={**{k:mov[k]for k in ('CODCOLIGADA','CODFILIAL','IDMOV','CODCOLCFO','CODCFO')},'IDLAN':'148481','STATUSLAN':'0','VALORORIGINAL':'1','VALORBAIXADO':'0','BAIXAPENDENTE':'0','IDBOLETO':None,'DATAEMISSAO':'2026-10-26','DATAVENCIMENTO':'2026-12-31'}
 if bank!=(None,None):lan.update(IDPGTO=bank[0],CODCOLPGTO=bank[1])
 sl={**lan,'IDPGTO':bank[0],'CODCOLPGTO':bank[1]}
 return {'native':{'movement':[{'table':'TMOV','fields':mov},{'table':'TMOVCOMPL','fields':{'TICKET':'228310'}},{'table':'TMOVPAGTO','fields':{'IDLAN':'148481','VALOR':'1'}}],'launch':[{'table':'FLAN','fields':lan}]},'sql':{'MOVEMENT_JSON':[copy.deepcopy(mov)],'LAUNCH_JSON':[sl],'OWNED_MOVEMENTS_JSON':[{'CODCOLIGADA':11,'IDMOV':90767}],'OWNED_LAUNCHES_JSON':[{'CODCOLIGADA':11,'IDLAN':148481}],'COMPLEMENT_JSON':[{'TICKET':'228310'}]},'bankRecordHash':'same','bankOwnerMatches':True,'bankActive':'1','boletoCount':0,'paymentCount':0}
class Tests(unittest.TestCase):
 def probe(self):
  p=m.Probe();p.original=original();p.baseline=snapshot();p.environment=lambda:None;return p
 def test_clear_changes_only_two_cells_to_nil(self):
  o=original();x=m.clear_xml(o);m.validate_clear(o,x);r=m.ET.fromstring(x).find('FLAN')
  self.assertEqual(set(c.tag for c in r),{'CODCOLIGADA','IDLAN','CODCOLCFO','CODCFO','IDPGTO','CODCOLPGTO'});self.assertEqual(len(r),6)
  for field in('IDPGTO','CODCOLPGTO'):self.assertEqual(r.find(field).get(m.NIL),'true');self.assertIsNone(r.find(field).text)
  self.assertEqual(o.find('FLAN/IDPGTO').text,'2')
 def test_extra_field_value_date_removed_table_or_zero_rejected(self):
  x=m.clear_xml(original())
  for wrong in(x.replace('</FLAN>','<VALORORIGINAL>2</VALORORIGINAL></FLAN>'),x.replace('</FLAN>','<DATAVENCIMENTO>2026-12-31</DATAVENCIMENTO></FLAN>'),x.replace('</FinLAN>','<FLANCOMPL/></FinLAN>'),x.replace('nil="true"','nil="false"')):
   with self.assertRaises(m.b.GuardError):m.validate_clear(original(),wrong)
 def test_full_readrecord_even_unchanged_original_value_is_forbidden(self):
  full=original()
  for name in('IDPGTO','CODCOLPGTO'):
   cell=full.find('FLAN/'+name);cell.text=None;cell.set(m.NIL,'true')
  with self.assertRaises(m.b.GuardError):m.validate_clear(original(),m.ET.tostring(full,encoding='unicode'))
  minimal=m.clear_xml(original()).replace('</FLAN>','<VALORORIGINAL>1</VALORORIGINAL></FLAN>')
  with self.assertRaises(m.b.GuardError):m.validate_clear(original(),minimal)
 def test_original_identity_or_bank_must_still_be_exact(self):
  for field,value in(('CODCOLIGADA','5'),('IDLAN','999'),('CODCOLCFO','11'),('CODCFO','other'),('IDPGTO','3'),('CODCOLPGTO','0')):
   baseline=original();baseline.find('FLAN/'+field).text=value
   with self.assertRaises(m.b.GuardError):m.clear_xml(baseline)
 def test_no_attach_before_confirmed_clear_and_two_null_reads(self):
  p=self.probe();p.phase='attach'
  with self.assertRaises(m.b.GuardError):p.save_once('attach',m.minimal_xml())
  for confirmed in(False,True):
   p.clear_native_confirmed=confirmed;p.calls['clear']=1
   with self.assertRaises(m.b.GuardError):p.authorize_attach(snapshot(),snapshot((None,None)))
 def test_null_pair_must_be_both_null_global_supplier_preserved(self):
  m.validate_snapshot(snapshot((None,None)),(None,None));m.validate_snapshot(snapshot(),('2','11'))
  wrong=snapshot((None,None));wrong['sql']['LAUNCH_JSON'][0]['CODCOLPGTO']='11'
  with self.assertRaises(m.b.GuardError):m.validate_snapshot(wrong,(None,None))
 def test_only_bank_and_native_proven_audit_may_change(self):
  before=snapshot();after=snapshot((None,None));after['native']['launch'][0]['fields']['USUARIO']='p_heflo';m.immutable_except_bank_audit(before,after)
  for field in('DATAEMISSAO','DATAVENCIMENTO','VALORORIGINAL','CODCFO'):
   wrong=copy.deepcopy(after);wrong['native']['launch'][0]['fields'][field]='alterado'
   with self.assertRaises(m.b.GuardError):m.immutable_except_bank_audit(before,wrong)
 def test_two_null_readbacks_must_be_identical(self):
  p=self.probe();p.calls['clear']=1;p.clear_native_confirmed=True;first=snapshot((None,None));second=copy.deepcopy(first);second['native']['launch'][0]['fields']['USUARIO']='other'
  with self.assertRaises(m.b.GuardError):p.authorize_attach(first,second)
 def test_two_saves_max_no_retry_after_clear_timeout(self):
  p=self.probe();p.phase='clear'
  with patch.object(p,'http',side_effect=TimeoutError())as send:
   with self.assertRaises(TimeoutError):p.save_once('clear',m.clear_xml(p.original))
   with self.assertRaises(m.b.GuardError):p.save_once('clear',m.clear_xml(p.original))
   with self.assertRaises(m.b.GuardError):p.authorize_attach(snapshot((None,None)),snapshot((None,None)))
   self.assertEqual(send.call_count,1)
 def test_clear_then_attach_exactly_once_after_positive_proof(self):
  p=self.probe();p.phase='clear';body=b'<Envelope xmlns="http://www.totvs.com/"><SaveRecordResult>11;148481</SaveRecordResult></Envelope>'
  with patch.object(p,'http',return_value=(200,body))as send:
   p.save_once('clear',m.clear_xml(p.original));self.assertTrue(p.clear_native_confirmed)
   p.authorize_attach(snapshot((None,None)),snapshot((None,None)));p.phase='attach';p.save_once('attach',m.minimal_xml())
   with self.assertRaises(m.b.GuardError):p.save_once('attach',m.minimal_xml())
   self.assertEqual(send.call_count,2)
 def test_wrong_supplier_other_mov_boleto_baixa_block(self):
  for what in('supplier','amount','boleto','payment'):
   a=snapshot()
   if what=='supplier':a['native']['launch'][0]['fields']['CODCFO']='other'
   elif what=='amount':a['native']['launch'][0]['fields']['VALORORIGINAL']='2'
   elif what=='boleto':a['boletoCount']=1
   else:a['paymentCount']=1
   with self.assertRaises(m.b.GuardError):m.validate_snapshot(a,('2','11'))
if __name__=='__main__':unittest.main()
