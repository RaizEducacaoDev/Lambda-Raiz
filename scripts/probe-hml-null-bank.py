"""Reviewed DEV fixture only: one full NULL clear, then at most one reattachment.

Never retries or restores after an ambiguous result. No PROD financial access.
"""
import copy, importlib.util, json, os, urllib.error, urllib.request
import xml.etree.ElementTree as ET
from decimal import Decimal
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('hml_readonly_base',ROOT/'scripts/probe-hml-bank-same-user.py')
b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
OUT=Path('.hml-null-bank');NIL='{http://www.w3.org/2001/XMLSchema-instance}nil'
AUDIT={'USUARIO','DATAALTERACAO','RECMODIFIEDON','RECMODIFIEDBY'}
require=b.require

def minimal_xml():
 root=ET.Element('FinLAN');row=ET.SubElement(root,'FLAN')
 for k,v in {'CODCOLIGADA':'11','IDLAN':'148481','CODCOLPGTO':'11','CODCOLCFO':'0','CODCFO':'0000173261','IDPGTO':'2'}.items():ET.SubElement(row,k).text=v
 return ET.tostring(root,encoding='unicode')

def clear_xml(original):
 root=copy.deepcopy(original);rows=[n for n in root if n.tag=='FLAN'];require(len(rows)==1,'FULL_CLEAR_REQUIRES_ONE_FLAN')
 for name,value in [('IDPGTO','2'),('CODCOLPGTO','11')]:
  nodes=rows[0].findall(name);require(len(nodes)==1 and nodes[0].text==value and not nodes[0].attrib,'BASELINE_BANK_NOT_EXACT')
  nodes[0].text=None;nodes[0].set(NIL,'true')
 return ET.tostring(root,encoding='unicode')

def validate_clear(original,xml):
 actual=ET.fromstring(xml);expected=ET.fromstring(clear_xml(original))
 # ET representation preserves every cell, row, attribute and child order.
 require(ET.tostring(actual)==ET.tostring(expected),'FULL_CLEAR_CHANGED_OTHER_FIELDS')

def read_snapshot(p):
 p.environment();p.contract()
 roots={'movement':p.record('MovMovimentoTBCData','11;90767'),'launch':p.record('FinLanDataBR','11;148481')}
 bank=b.one(p.record('FinDadosPgtoDataBR','11;0;0000173261;2'),'FDadosPgto')
 q=p.query(b.QUERY,'CODCOLIGADA=11;TICKET=228310;IDMOV=90767;IDLAN=148481')
 require(isinstance(q,list)and len(q)==1,'SQL_ROW_COUNT');q=q[0]
 require(all(type(q.get(k))is int and q[k]==v for k,v in {'BANK_VERSION':1,'REQUEST_COMPANY':11,'REQUEST_TICKET':228310,'REQUEST_IDMOV':90767,'REQUEST_IDLAN':148481,'EXACT_SCOPE_ALLOWED':1}.items()),'SQL_SCOPE_CHANGED')
 arrays={k:json.loads(q[k],parse_float=Decimal)for k in ('MOVEMENT_JSON','LAUNCH_JSON','OWNED_MOVEMENTS_JSON','OWNED_LAUNCHES_JSON','COMPLEMENT_JSON')}
 data={'native':{name:[{'table':r.tag,'fields':{c.tag:c.text for c in r}}for r in root]for name,root in roots.items()},'sql':arrays,'bankRecordHash':b.sha(b.packed(bank)),'bankActive':bank.get('ATIVO'),'bankOwnerMatches':all(bank.get(k)==v for k,v in {'CODCOLIGADA':'11','CODCOLCFO':'0','CODCFO':'0000173261','IDPGTO':'2'}.items()),'boletoCount':q.get('BOLETO_COUNT'),'paymentCount':q.get('PAYMENT_COUNT')}
 return data,roots['launch']

def native_one(data,entity,table):
 rows=[r['fields']for r in data['native'][entity]if r['table']==table];require(len(rows)==1,'NATIVE_ROW_COUNT');return rows[0]

def validate_snapshot(data,bank):
 require(bank in[(None,None),('2','11')],'INVALID_EXPECTED_BANK')
 m=native_one(data,'movement','TMOV');l=native_one(data,'launch','FLAN');h=native_one(data,'movement','TMOVCOMPL');payment=native_one(data,'movement','TMOVPAGTO')
 require(data['bankOwnerMatches']and data['bankActive']=='1'and data['boletoCount']==data['paymentCount']==0,'BANK_OR_DEPENDENCIES_CHANGED')
 require(all(len(v)==1 for v in data['sql'].values()),'SQL_CHAIN_COUNT')
 require(data['sql']['OWNED_MOVEMENTS_JSON']==[{'CODCOLIGADA':11,'IDMOV':90767}]and data['sql']['OWNED_LAUNCHES_JSON']==[{'CODCOLIGADA':11,'IDLAN':148481}]and data['sql']['COMPLEMENT_JSON']==[{'TICKET':'228310'}],'SQL_TICKET_PROVENANCE')
 require(h.get('TICKET')=='228310'and payment.get('IDLAN')=='148481','NATIVE_TICKET_CHAIN')
 for n,sql in[(m,data['sql']['MOVEMENT_JSON'][0]),(l,data['sql']['LAUNCH_JSON'][0])]:
  for k,v in {'CODCOLIGADA':'11','CODFILIAL':'1','IDMOV':'90767','CODCOLCFO':'0','CODCFO':'0000173261'}.items():require(str(n.get(k))==str(sql.get(k))==v,'IDENTITY_CHANGED')
 require(m.get('CODTMV')=='1.2.03'and m.get('STATUS')=='F'and l.get('IDLAN')=='148481','MOVEMENT_STATUS_OR_KIND_CHANGED')
 for row in(l,data['sql']['LAUNCH_JSON'][0]):
  pair=tuple(None if row.get(k)in(None,'')else str(row[k])for k in('IDPGTO','CODCOLPGTO'));require(pair==bank,'BANK_PAIR_NOT_EXPECTED')
  require(str(row.get('STATUSLAN'))=='0'and Decimal(str(row['VALORORIGINAL']))==1 and Decimal(str(row['VALORBAIXADO']))==Decimal(str(row['BAIXAPENDENTE']))==0 and row.get('IDBOLETO')in(None,'','0',0),'LAUNCH_FINANCIAL_STATE')
 sm=data['sql']['MOVEMENT_JSON'][0]
 require(sm.get('CODTMV')=='1.2.03'and sm.get('STATUS')=='F'and Decimal(str(sm['VALORBRUTO']))==Decimal(str(sm['VALORLIQUIDO']))==Decimal(m['VALORBRUTO'])==Decimal(m['VALORLIQUIDO'])==Decimal(payment['VALOR'])==1,'MOVEMENT_AMOUNT_OR_STATUS')

def differences(before,after):
 require(before['bankRecordHash']==after['bankRecordHash'],'BANK_REGISTRATION_CHANGED');result=[]
 for kind in('native','sql'):
  require(set(before[kind])==set(after[kind]),'TABLE_SET_CHANGED')
  for table,first in before[kind].items():
   second=after[kind][table];require(len(first)==len(second),'ROW_COUNT_CHANGED')
   for i,(a,z)in enumerate(zip(first,second)):
    native_table=None
    if kind=='native':require(a['table']==z['table'],'TABLE_ORDER_CHANGED');native_table=a['table'];a,z=a['fields'],z['fields']
    for key in sorted(set(a)|set(z)):
     if a.get(key)!=z.get(key):result.append({'kind':kind,'table':table,'nativeTable':native_table,'row':i,'field':key})
 return result

def immutable_except_bank_audit(before,after):
 diff=differences(before,after)
 require(all((x['kind']=='sql'and x['table']=='LAUNCH_JSON'or x['kind']=='native'and x['table']=='launch'and x['nativeTable']=='FLAN')and x['field']in(AUDIT|{'IDPGTO','CODCOLPGTO'})for x in diff),'NONBANK_BUSINESS_FIELD_CHANGED')
 return diff

class Probe(b.Probe):
 def __init__(self):super().__init__();self.calls={'clear':0,'attach':0};self.phase=None;self.original=None;self.baseline=None;self.clear_native_confirmed=False;self.attach_proven=False
 def authorize_attach(self,first,second):
  require(self.clear_native_confirmed and self.calls=={'clear':1,'attach':0},'CLEAR_NOT_NATIVELY_CONFIRMED')
  for data in(first,second):validate_snapshot(data,(None,None));immutable_except_bank_audit(self.baseline,data)
  require(not differences(first,second),'NULL_READBACKS_NOT_STABLE')
  self.attach_proven=True
 def http(self,path,method='GET',data=None,soap_action=None):
  if soap_action!='SaveRecord':return super().http(path,method,data,soap_action)
  require(path=='/wsDataServer/IwsDataServer'and method=='POST'and self.phase in('clear','attach')and self.calls[self.phase]==1,'TRANSPORT_PHASE_NOT_ARMED')
  r=ET.fromstring(data).find('.//{'+b.SOAP+'}SaveRecord');require(r is not None and len(r)==3,'SAVE_ARGS_CHANGED')
  v={n.tag.rsplit('}',1)[-1]:n.text for n in r};require(set(v)=={'DataServerName','XML','Contexto'}and v['DataServerName']=='FinLanDataBR'and v['Contexto']==b.CONTEXT,'SAVE_SCOPE_CHANGED')
  if self.phase=='clear':validate_clear(self.original,v['XML'])
  else:b.validate_save_xml(v['XML'])
  headers={'Authorization':self.basic,'Content-Type':'text/xml;charset=UTF-8','SOAPAction':b.SOAP+'IwsDataServer/SaveRecord'}
  try:
   with self.opener.open(urllib.request.Request(b.HOST+path,data=data,headers=headers),timeout=35)as response:return response.status,response.read(8000001)
  except urllib.error.HTTPError as e:return e.code,e.read(8000001)
  except(urllib.error.URLError,TimeoutError):raise b.GuardError('SAVE_OUTCOME_UNCERTAIN_NO_RETRY')from None
 def save_once(self,phase,xml):
  require(phase in('clear','attach')and self.phase==phase and self.calls[phase]==0 and sum(self.calls.values())<2,'SAVE_PHASE_ALREADY_USED_OR_NOT_ARMED')
  if phase=='clear':validate_clear(self.original,xml)
  else:require(self.calls['clear']==1 and self.attach_proven,'ATTACH_WITHOUT_TWO_NULL_READBACKS_FORBIDDEN');b.validate_save_xml(xml)
  self.environment();self.calls[phase]+=1
  root=ET.Element('{'+b.XSI+'}Envelope');body=ET.SubElement(root,'{'+b.XSI+'}Body');op=ET.SubElement(body,'SaveRecord',xmlns=b.SOAP)
  for k,v in {'DataServerName':'FinLanDataBR','XML':xml,'Contexto':b.CONTEXT}.items():ET.SubElement(op,k).text=v
  status,raw=self.http('/wsDataServer/IwsDataServer','POST',ET.tostring(root),'SaveRecord');require(len(raw)<=8000000,'SAVE_RESPONSE_TOO_LARGE')
  try:r=ET.fromstring(raw);n=r.find('.//{'+b.SOAP+'}SaveRecordResult');message=n.text if n is not None and n.text else ET.tostring(r,encoding='unicode')
  except ET.ParseError:message=raw.decode('utf-8',errors='replace')
  if phase=='clear':self.clear_native_confirmed=status==200 and message.strip()=='11;148481'
  return status,message

def private(name,data,p):
 safe,counts=b.redact(b.packed(data),p.secrets);b.write(name,{'observedUtc':b.utc(),'redactions':counts,'fullSnapshot':json.loads(safe)})

def phase(p,name,xml,before,expected):
 p.phase=name;error=None;status=None;message=None
 b.write(name+'-attempt.json',{'phase':name,'observedUtc':b.utc(),'automaticRetry':False,'maxTotalSaveCalls':2})
 try:status,message=p.save_once(name,xml)
 except Exception as e:error=e
 if message is not None:
  try:
   safe,counts=b.redact(message,p.secrets)
   with (OUT/(name+'-response-redacted.txt')).open('x',encoding='utf-8')as f:f.write(safe)
   b.write(name+'-response.json',{'status':status,'length':len(message),'lineCount':len(message.splitlines()),'responseSha256':b.sha(message),'redactedSha256':b.sha(safe),'redactions':counts,'exactKey':message.strip()=='11;148481'})
  except Exception:b.write(name+'-retention-failed.json',{'responseSha256':b.sha(message),'gate':'REDACTED_RETENTION_FAILED_NO_RAW_SECRET_SAVED'})
 checks=[];snapshots=[]
 for independent in(False,True):
  label='independent'if independent else'same-session'
  if independent:p.opener=urllib.request.build_opener(b.NoRedirect())
  try:
   data,_=read_snapshot(p);private(name+'-after-'+label+'.json',data,p);snapshots.append(data)
   validate_snapshot(data,expected);diff=immutable_except_bank_audit(before,data)
   checks.append({'mode':label,'validated':True,'changedColumns':diff})
  except Exception as e:checks.append({'mode':label,'validated':False,'errorType':type(e).__name__,'gate':str(e)if isinstance(e,b.GuardError)else'READBACK_FAILED'})
 ok=not error and status==200 and message is not None and message.strip()=='11;148481'and len(checks)==2 and all(c['validated']for c in checks)
 result={'phase':name,'verified':ok,'nativeExactKey':message is not None and message.strip()=='11;148481','errorType':type(error).__name__ if error else None,'checks':checks,'saveCalls':dict(p.calls),'automaticRetry':False}
 b.write(name+'-result.json',result);return ok,snapshots,result

def main():
 env=dict(os.environ);require(env.get('HML_NULL_BANK_AUTHORIZATION')=='ONE_CLEAR_AND_ONE_ATTACH_ONLY','NULL_PROBE_NOT_AUTHORIZED');env['HML_SAME_BANK_AUTHORIZATION']='ONE_SAME_BANK_SAVE_ONLY';b.context_guard(env)
 OUT.mkdir(exist_ok=False);b.OUT=OUT
 require(b.aws('sts','get-caller-identity')['Account']==b.ACCOUNT,'AWS_ACCOUNT_MISMATCH')
 cfg=b.aws('lambda','get-function-configuration',['--function-name',b.FUNCTION]);p=Probe();p.authenticate(cfg.get('Environment',{}).get('Variables',{}));p.environment()
 schema=p.soap('GetSchema',{'DataServerName':'FinLanDataBR','Contexto':b.CONTEXT});meta=[{k.rsplit('}',1)[-1]:v for k,v in e.attrib.items()}for e in schema.iter()if e.attrib.get('name')in('IDPGTO','CODCOLPGTO','USUARIO')]
 require(any(v.get('name')=='USUARIO'and v.get('Caption')=='Usuário de Alteração'for v in meta),'USUARIO_AUDIT_NOT_NATIVE_PROVEN')
 for field in('IDPGTO','CODCOLPGTO'):require(any(v.get('name')==field and v.get('minOccurs')=='0'for v in meta),'BANK_FIELD_NOT_NULLABLE_IN_NATIVE_SCHEMA')
 b.write('environment-schema.json',{'database':b.DATABASE,'authUsernameExactlyP_heflo':True,'schemaFields':meta,'nilFormat':'xsi:nil=true; no added schema','maxSaveCalls':2,'productionWrites':False})
 before,original=read_snapshot(p);again,_=read_snapshot(p);validate_snapshot(before,('2','11'));validate_snapshot(again,('2','11'));require(not differences(before,again),'BASELINE_NOT_STABLE');private('baseline-full.json',before,p)
 p.original=copy.deepcopy(original);p.baseline=copy.deepcopy(before);clear=clear_xml(original)
 ok,cleared,first=phase(p,'clear',clear,before,(None,None));out={'database':b.DATABASE,'ticket':228310,'idlan':148481,'clear':first,'attach':None,'automaticRetry':False,'productionWrites':False,'creations':False}
 if ok:
  require(len(cleared)==2,'TWO_NULL_READBACKS_REQUIRED');p.authorize_attach(cleared[0],cleared[1])
  ok,attached,second=phase(p,'attach',minimal_xml(),cleared[-1],('2','11'));out['attach']=second
  if ok:
   for data in attached:immutable_except_bank_audit(before,data)
 out['finalBankRestoredAndVerified']=bool(ok and out['attach']and out['attach']['verified']);out['saveCalls']=dict(p.calls);b.write('result.json',out)
 print(json.dumps({'state':'BANK_RESTORED_VERIFIED'if out['finalBankRestoredAndVerified']else'STOPPED_NO_RETRY_ROOT_DECIDES','saveCalls':p.calls,'clearVerified':first['verified'],'attachVerified':bool(out['attach']and out['attach']['verified'])}));return 0 if out['finalBankRestoredAndVerified']else 2

if __name__=='__main__':
 try:raise SystemExit(main())
 except Exception as e:print(json.dumps({'state':'STOPPED_NO_RETRY','errorType':type(e).__name__,'gate':str(e)if isinstance(e,b.GuardError)else'EXTERNAL_FAILURE'}));raise SystemExit(2)
