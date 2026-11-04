"""No credentials/network. Verify the one approved HML write boundary."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('hml_probe_test',ROOT/'scripts/probe-hml-bank-same-user.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def xml():return '<FinLAN><FLAN><CODCOLIGADA>11</CODCOLIGADA><IDLAN>148481</IDLAN><CODCOLPGTO>11</CODCOLPGTO><CODCOLCFO>0</CODCOLCFO><CODCFO>0000173261</CODCFO><IDPGTO>2</IDPGTO></FLAN></FinLAN>'
class Tests(unittest.TestCase):
 def test_exact_six_field_current_bank_only(self):m.validate_save_xml(xml())
 def test_other_target_null_bank_other_bank_and_extra_field_rejected(self):
  for value in (xml().replace('148481','148482'),xml().replace('<IDPGTO>2</IDPGTO>','<IDPGTO/>'),xml().replace('<IDPGTO>2</IDPGTO>','<IDPGTO>3</IDPGTO>'),xml().replace('</FLAN>','<VALORORIGINAL>2</VALORORIGINAL></FLAN>'),xml().replace('<CODCOLIGADA>11','<CODCOLIGADA>5')):
   with self.assertRaises(m.GuardError):m.validate_save_xml(value)
 def test_unarmed_save_and_second_save_never_send(self):
  p=m.Probe();p.environment=lambda:None
  with patch.object(p,'soap',return_value=(200,'11;148481'))as post:
   with self.assertRaises(m.GuardError):p.save(xml())
   p.armed=True;self.assertEqual(p.save(xml()),(200,'11;148481'))
   with self.assertRaises(m.GuardError):p.save(xml())
   self.assertEqual(post.call_count,1)
 def test_timeout_does_not_allow_second_save(self):
  p=m.Probe();p.armed=True;p.environment=lambda:None
  with patch.object(p,'soap',side_effect=TimeoutError())as post:
   with self.assertRaises(TimeoutError):p.save(xml())
   with self.assertRaises(m.GuardError):p.save(xml())
   self.assertEqual(post.call_count,1)
 def test_dev_auth_wrong_user_or_401_stops_before_financial_write(self):
  p=m.Probe()
  with patch.object(p,'http',return_value=(401,b'{}'))as http:
   for user in ('different','p_heflo'):
    with self.assertRaises(m.GuardError):p.authenticate({'USERNAME_TOTVS':user,'PASSWORD_TOTVS':'synthetic-secret','RM_DEV':m.HOST.replace(':8051','')})
   self.assertEqual(p.saves,0);self.assertEqual(http.call_count,1)
 def test_prod_host_and_other_http_write_routes_forbidden(self):
  p=m.Probe()
  for path in ('https://prod.invalid/wsDataServer/IwsDataServer','//prod.invalid/','/api/processes/Save'):
   with self.assertRaises(m.GuardError):p.http(path,'POST',b'fake')
  with self.assertRaises(m.GuardError):p.authenticate({'USERNAME_TOTVS':'p_heflo','PASSWORD_TOTVS':'secret','RM_DEV':'https://production.invalid'})
 def test_transport_cannot_save_other_dataserver_even_if_armed(self):
  p=m.Probe();p.armed=True;p.saves=1
  data=b'<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://www.totvs.com/"><s:Body><t:SaveRecord><t:DataServerName>MovMovimentoTBCData</t:DataServerName><t:XML>fake</t:XML><t:Contexto>fake</t:Contexto></t:SaveRecord></s:Body></s:Envelope>'
  with self.assertRaises(m.GuardError):p.http('/wsDataServer/IwsDataServer','POST',data,'SaveRecord')
 def test_aws_allowlist_has_no_write(self):
  for service,op in (('lambda','invoke'),('lambda','update-function-code'),('dynamodb','put-item')):
   with self.assertRaises(m.GuardError):m.aws(service,op)
 def test_redaction_keeps_native_cause_full_lines_but_no_secrets(self):
  raw='Campo de origem: operação negada.\nAUTHUSER real-user\nPassword=known-pass; x\nAuthorization: Basic dXNlcjpwYXNz\naccess_token=real-token\nConnectionString=Server=private;Password=known-pass\nDetalhe fiscal necessário: 31/1234'
  result,counts=m.redact(raw,['real-user','known-pass','real-token'])
  for secret in ('real-user','known-pass','real-token','dXNlcjpwYXNz','Server=private'):self.assertNotIn(secret,result)
  self.assertIn('Campo de origem: operação negada.',result);self.assertIn('Detalhe fiscal necessário: 31/1234',result)
 def test_unknown_json_password_and_connection_patterns_redacted(self):
  raw='{"password":"not-known-secret"}\nData Source=private;Initial Catalog=private-db;Integrated Security=True\nCausa: usuário sem autorização financeira.'
  safe,_=m.redact(raw,[])
  self.assertNotIn('not-known-secret',safe);self.assertNotIn('private-db',safe);self.assertIn('Causa: usuário sem autorização financeira.',safe)
 def test_new_audit_field_only_does_not_hide_financial_date(self):
  b={'native':{'launch':[{'table':'FLAN','fields':{'DATAALTERACAO':'2026-10-30','DATAVENCIMENTO':'2026-12-31'}}]},'sql':{},'bankRecordHash':'same'}
  a=json.loads(json.dumps(b));a['native']['launch'][0]['fields']['DATAALTERACAO']='2026-11-04'
  self.assertEqual(m.changes(b,a),[{'kind':'native','table':'launch','row':0,'field':'DATAALTERACAO'}]);a['native']['launch'][0]['fields']['DATAVENCIMENTO']='2026-12-30';self.assertTrue(any(x['field']=='DATAVENCIMENTO'for x in m.changes(b,a)))
if __name__=='__main__':unittest.main()
