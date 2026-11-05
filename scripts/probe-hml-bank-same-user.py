"""One explicitly approved SAME-BANK SaveRecord on a fixed DEV fixture only.

PROD Lambda configuration is read solely to authenticate as the runtime user.
Credentials, request XML and headers never leave memory. No NULL reset occurs.
"""
import base64, copy, datetime as dt, hashlib, json, os, re, subprocess
from decimal import Decimal
from pathlib import Path
import urllib.error, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

HOST='https://raizeducacao160289.rm.cloudtotvs.com.br:8051'
DATABASE='C3U7RQ_160289_RM_DV';QUERY='RAIZ.HML.BANK'
SQL_SHA='aaffc5e7d341c90bd33026a854947d5158658584d1655eb5d6d3bdd73a81d929'
ACCOUNT='757843862365';FUNCTION='lambda-raiz-prod-solicitacaoDePagamento'
CONTEXT='CODCOLIGADA=11;CODSISTEMA=F;CODUSUARIO=p_heflo'
OUT=Path('.hml-bank-same-user');AUDIT={'DATAALTERACAO','RECMODIFIEDON','RECMODIFIEDBY'}
SOAP='http://www.totvs.com/';XSI='http://schemas.xmlsoap.org/soap/envelope/'

class GuardError(Exception):pass
def require(ok,code):
 if not ok:raise GuardError(code)
def sha(raw):return hashlib.sha256(raw if isinstance(raw,bytes)else raw.encode()).hexdigest()
def packed(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,default=str)
def canon(s):return s.replace('\r\n','\n').replace('\r','\n').strip()
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def write(name,value):
 with (OUT/name).open('x',encoding='utf-8')as f:f.write(json.dumps(value,indent=2,default=str));f.flush();os.fsync(f.fileno())
def rows(root,table):return [{c.tag:c.text for c in r}for r in root if r.tag==table]
def one(root,table):
 value=rows(root,table);require(len(value)==1,'NATIVE_EXACT_ROW_REQUIRED');return value[0]
def context_guard(env):
 require(env.get('GITHUB_ACTIONS')=='true'and env.get('GITHUB_EVENT_NAME')=='push'and env.get('GITHUB_RUN_ATTEMPT')=='1'and env.get('GITHUB_REPOSITORY')=='RaizEducacaoDev/Lambda-Raiz'and env.get('GITHUB_REF')=='refs/heads/fix/idpgto-vinculo-obrigatorio'and env.get('HML_SAME_BANK_AUTHORIZATION')=='ONE_SAME_BANK_SAVE_ONLY','WORKFLOW_CONTEXT_NOT_AUTHORIZED')
def validate_save_xml(xml):
 root=ET.fromstring(xml);r=one(root,'FLAN')
 require(root.tag=='FinLAN'and len(root)==1 and r=={'CODCOLIGADA':'11','IDLAN':'148481','CODCOLPGTO':'11','CODCOLCFO':'0','CODCFO':'0000173261','IDPGTO':'2'}and len(root[0])==6,'SAVE_MUST_BE_SAME_BANK_SIX_FIELDS')
def aws(service,op,args=()):
 require((service,op)in{('sts','get-caller-identity'),('lambda','get-function-configuration')},'AWS_WRITE_FORBIDDEN')
 p=subprocess.run(['aws',service,op,*args,'--region','sa-east-1','--output','json'],capture_output=True,text=True,timeout=25)
 require(p.returncode==0,'AWS_READ_FAILED');return json.loads(p.stdout)

def redact(message,secrets):
 value=message;counts={}
 for secret in sorted({str(s)for s in secrets if s},key=len,reverse=True):
  count=value.count(secret)
  if count:value=value.replace(secret,'[REDACTED_CREDENTIAL]');counts['knownCredential']=counts.get('knownCredential',0)+count
 patterns=[('authorization',r'(?im)(authorization\s*[:=]\s*)(?:basic|bearer)?\s*[^\r\n<]+'),
  ('token',r'(?i)\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+'),
  ('credential',r'(?im)["\x27]?(?:password|pwd|senha|access_token|refresh_token|client_secret)["\x27]?\s*[=:]\s*[^\r\n;<]+'),
  ('xmlCredential',r'(?is)<(?:password|pwd|senha|token|access_token|refresh_token|client_secret)\b[^>]*>.*?</[^>]+>'),
  ('connectionString',r'(?im)(?:connection\s*string|connectionstring)\s*[:=]\s*[^\r\n<]+'),
  ('databaseConnection',r'(?im)(?:data source|server)\s*=\s*[^\r\n<]*(?:initial catalog|database|user id|password)\s*=[^\r\n<]*'),
  ('urlCredentials',r'(?i)https?://[^\s/@:]+:[^\s/@]+@')]
 for label,pattern in patterns:
  value,n=re.subn(pattern,'[REDACTED_'+label.upper()+']',value);counts[label]=n
 require(all(secret not in value for secret in secrets if secret),'SECRET_REDACTION_FAILED')
 return value,counts

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

class Probe:
 def __init__(self):self.opener=urllib.request.build_opener(NoRedirect());self.token=None;self.basic=None;self.secrets=[];self.saves=0;self.armed=False
 def http(self,path,method='GET',data=None,soap_action=None):
  require(path.startswith('/')and not path.startswith('//'),'URL_OUTSIDE_DEV')
  allowed_get=path.startswith('/api/framework/v1/consultaSQLServer/RealizaConsulta/RAIZ.IDPGTO.ENV/0/T')or path.startswith('/api/framework/v1/consultaSQLServer/RealizaConsulta/'+QUERY+'/0/T')
  require((method=='GET'and allowed_get)or(method=='POST'and path in('/api/connect/token/','/wsDataServer/IwsDataServer')),'HTTP_SCOPE_FORBIDDEN')
  headers={'Content-Type':'application/json','Accept':'application/json'}
  if soap_action:
   require(soap_action in('ReadRecord','GetSchema','SaveRecord'),'SOAP_OPERATION_FORBIDDEN')
   headers={'Content-Type':'text/xml;charset=UTF-8','Authorization':self.basic,'SOAPAction':SOAP+'IwsDataServer/'+soap_action}
   if soap_action=='SaveRecord':
    require(self.saves==1 and self.armed,'TRANSPORT_SAVE_NOT_ARMED')
    operation=ET.fromstring(data).find('.//{'+SOAP+'}SaveRecord')
    require(operation is not None and len(operation)==3,'TRANSPORT_SAVE_SCOPE_INVALID')
    values={n.tag.rsplit('}',1)[-1]:n.text for n in operation}
    require(set(values)=={'DataServerName','XML','Contexto'}and values['DataServerName']=='FinLanDataBR'and values['Contexto']==CONTEXT,'TRANSPORT_SAVE_OUTSIDE_FIXTURE')
    validate_save_xml(values['XML'])
  elif self.token:headers['Authorization']='Bearer '+self.token
  try:
   with self.opener.open(urllib.request.Request(HOST+path,data=data,method=method,headers=headers),timeout=35)as r:return r.status,r.read(8000001)
  except urllib.error.HTTPError as e:return e.code,e.read(8000001)
  except(urllib.error.URLError,TimeoutError):raise GuardError('HTTP_OUTCOME_UNCERTAIN_NO_RETRY')from None
 def authenticate(self,env):
  user=env.get('USERNAME_TOTVS');password=env.get('PASSWORD_TOTVS')
  require(user=='p_heflo'and isinstance(password,str)and bool(password),'ACTUAL_AUTH_USER_NOT_RUNTIME_USER')
  require(env.get('RM_DEV','').rstrip('/')==HOST.replace(':8051',''),'CONFIGURED_DEV_HOST_CHANGED')
  self.basic='Basic '+base64.b64encode((user+':'+password).encode()).decode()
  self.secrets=[user,password,self.basic,self.basic[6:]]
  status,raw=self.http('/api/connect/token/','POST',json.dumps({'grant_type':'password','username':user,'password':password}).encode())
  require(status==200,'DEV_AUTH_FAILED_NO_FINANCIAL_WRITE');value=json.loads(raw)
  self.token=value.get('access_token');require(isinstance(self.token,str)and self.token,'DEV_TOKEN_MISSING')
  self.secrets.extend([self.token,value.get('refresh_token')]);self.secrets=[x for x in self.secrets if x]
 def query(self,code,params=None):
  path='/api/framework/v1/consultaSQLServer/RealizaConsulta/'+code+'/0/T'
  if params:path+='?'+urllib.parse.urlencode({'parameters':params})
  status,raw=self.http(path);require(status==200 and len(raw)<=8000000,'DEV_READ_QUERY_FAILED')
  return json.loads(raw,parse_float=Decimal)
 def environment(self):
  v=self.query('RAIZ.IDPGTO.ENV');require(isinstance(v,list)and len(v)==1 and v[0].get('DATABASE_NAME')==DATABASE,'DATABASE_NOT_VERIFIED_DEV')
 def soap(self,operation,arguments):
  if operation=='SaveRecord':require(self.saves==1 and self.armed,'SAVE_NOT_ARMED')
  else:require(operation in('ReadRecord','GetSchema'),'NATIVE_OPERATION_FORBIDDEN')
  root=ET.Element('{'+XSI+'}Envelope');body=ET.SubElement(root,'{'+XSI+'}Body');op=ET.SubElement(body,operation,xmlns=SOAP)
  for k,v in arguments.items():ET.SubElement(op,k).text=v
  status,raw=self.http('/wsDataServer/IwsDataServer','POST',ET.tostring(root),operation)
  require(len(raw)<=8000000,'NATIVE_RESPONSE_TOO_LARGE')
  try:r=ET.fromstring(raw)
  except ET.ParseError:
   if operation=='SaveRecord':return status,raw.decode('utf-8',errors='replace')
   raise GuardError('READ_RECORD_XML_INVALID')from None
  result=r.find('.//{'+SOAP+'}'+operation+'Result')
  if operation=='SaveRecord':return status,result.text if result is not None and result.text else ET.tostring(r,encoding='unicode')
  require(status==200 and result is not None and result.text and not any(n.tag.endswith('Fault')for n in r.iter()),'NATIVE_READ_FAILED')
  return ET.fromstring(result.text)
 def record(self,ds,key,company=11):
  require((ds,key)in{('FinLanDataBR','11;148481'),('MovMovimentoTBCData','11;90767'),('FinDadosPgtoDataBR','11;0;0000173261;2'),('GlbConsSQLData','0;T;'+QUERY)},'READ_RECORD_OUTSIDE_FIXTURE')
  ctx=CONTEXT if company==11 else'CODCOLIGADA=0;CODSISTEMA=G;CODUSUARIO=p_heflo'
  if ds=='MovMovimentoTBCData':ctx=ctx.replace('CODSISTEMA=F','CODSISTEMA=T')
  return self.soap('ReadRecord',{'DataServerName':ds,'PrimaryKey':key,'Contexto':ctx})
 def contract(self):
  r=one(self.record('GlbConsSQLData','0;T;'+QUERY,0),'GConsSql')
  require(sha(canon(r.get('SENTENCA','')))==SQL_SHA,'HML_QUERY_CONTRACT_NOT_EXACT')
 def save(self,xml):
  require(self.armed and self.saves==0,'SINGLE_SAVE_ALREADY_USED_OR_NOT_ARMED')
  validate_save_xml(xml)
  self.environment();self.saves+=1
  return self.soap('SaveRecord',{'DataServerName':'FinLanDataBR','XML':xml,'Contexto':CONTEXT})

def snapshot(p):
 p.environment();p.contract()
 roots={'movement':p.record('MovMovimentoTBCData','11;90767'),'launch':p.record('FinLanDataBR','11;148481')}
 bank=one(p.record('FinDadosPgtoDataBR','11;0;0000173261;2'),'FDadosPgto')
 m=one(roots['movement'],'TMOV');l=one(roots['launch'],'FLAN');h=one(roots['movement'],'TMOVCOMPL');payments=rows(roots['movement'],'TMOVPAGTO')
 for k,v in {'CODCOLIGADA':'11','IDMOV':'90767','CODFILIAL':'1','CODCOLCFO':'0','CODCFO':'0000173261','CODTMV':'1.2.03','STATUS':'F'}.items():require(m.get(k)==v,'NATIVE_MOVEMENT_IDENTITY_CHANGED')
 for k,v in {'CODCOLIGADA':'11','IDLAN':'148481','IDMOV':'90767','CODFILIAL':'1','CODCOLCFO':'0','CODCFO':'0000173261','IDPGTO':'2','CODCOLPGTO':'11','STATUSLAN':'0'}.items():require(l.get(k)==v,'NATIVE_LAUNCH_IDENTITY_OR_BANK_CHANGED')
 require(h.get('TICKET')=='228310'and len(payments)==1 and payments[0].get('IDLAN')=='148481','NATIVE_TICKET_CHAIN_CHANGED')
 require(Decimal(m['VALORBRUTO'])==Decimal(m['VALORLIQUIDO'])==Decimal(l['VALORORIGINAL'])==1 and Decimal(l['VALORBAIXADO'])==Decimal(l['BAIXAPENDENTE'])==0 and l.get('IDBOLETO')in(None,'','0'),'NATIVE_FINANCIAL_STATE_CHANGED')
 require(all(bank.get(k)==v for k,v in {'CODCOLIGADA':'11','CODCOLCFO':'0','CODCFO':'0000173261','IDPGTO':'2','ATIVO':'1'}.items()),'BANK_OWNER_OR_ACTIVE_CHANGED')
 q=p.query(QUERY,'CODCOLIGADA=11;TICKET=228310;IDMOV=90767;IDLAN=148481')
 require(isinstance(q,list)and len(q)==1,'SQL_SNAPSHOT_NOT_UNIQUE');q=q[0]
 require(all(type(q.get(k))is int and q[k]==v for k,v in {'BANK_VERSION':1,'REQUEST_COMPANY':11,'REQUEST_TICKET':228310,'REQUEST_IDMOV':90767,'REQUEST_IDLAN':148481,'EXACT_SCOPE_ALLOWED':1,'BOLETO_COUNT':0,'PAYMENT_COUNT':0}.items()),'SQL_ECHO_OR_DEPENDENCIES_CHANGED')
 arrays={k:json.loads(q[k],parse_float=Decimal)for k in ('MOVEMENT_JSON','LAUNCH_JSON','OWNED_MOVEMENTS_JSON','OWNED_LAUNCHES_JSON','COMPLEMENT_JSON')}
 require(all(isinstance(v,list)and len(v)==1 for v in arrays.values()),'SQL_CHAIN_NOT_ONE_MOVEMENT_ONE_LAUNCH')
 require(arrays['OWNED_MOVEMENTS_JSON']==[{'CODCOLIGADA':11,'IDMOV':90767}]and arrays['OWNED_LAUNCHES_JSON']==[{'CODCOLIGADA':11,'IDLAN':148481}]and arrays['COMPLEMENT_JSON']==[{'TICKET':'228310'}],'SQL_TICKET_PROVENANCE_CHANGED')
 for native,sql in ((m,arrays['MOVEMENT_JSON'][0]),(l,arrays['LAUNCH_JSON'][0])):
  for k in ('CODCOLIGADA','IDMOV','CODFILIAL','CODCOLCFO','CODCFO'):require(str(native[k])==str(sql[k]),'NATIVE_SQL_IDENTITY_MISMATCH')
  for k in ('IDLAN','IDPGTO','CODCOLPGTO','STATUSLAN'):
   if k in native:require(str(native[k])==str(sql[k]),'NATIVE_SQL_BANK_STATE_MISMATCH')
  for k in ('VALORORIGINAL','VALORBRUTO','VALORLIQUIDO'):
   if k in native:require(Decimal(native[k])==Decimal(str(sql[k]))==1,'NATIVE_SQL_AMOUNT_MISMATCH')
 data={'native':{name:[{'table':n.tag,'fields':{c.tag:c.text for c in n}}for n in root]for name,root in roots.items()},'sql':arrays,'bankRecordHash':sha(packed(bank))}
 return data

def changes(before,after):
 result=[]
 for kind in ('native','sql'):
  require(set(before[kind])==set(after[kind]),'READBACK_TABLE_SET_CHANGED')
  for table,a in before[kind].items():
   b=after[kind][table];require(len(a)==len(b),'READBACK_ROWS_CHANGED')
   for i,(ra,rb)in enumerate(zip(a,b)):
    if kind=='native':require(ra['table']==rb['table'],'READBACK_TABLE_ORDER_CHANGED');ra,rb=ra['fields'],rb['fields']
    require(set(ra)==set(rb),'READBACK_COLUMN_SET_CHANGED')
    result.extend({'kind':kind,'table':table,'row':i,'field':k}for k in ra if ra[k]!=rb[k])
 require(before['bankRecordHash']==after['bankRecordHash'],'BANK_RECORD_CHANGED')
 return result

def save_private_snapshot(name,data,p):
 safe,counts=redact(packed(data),p.secrets);write(name,{'observedUtc':utc(),'redactions':counts,'fullSnapshot':json.loads(safe)})

def main():
 context_guard(os.environ);OUT.mkdir(exist_ok=False)
 require(aws('sts','get-caller-identity')['Account']==ACCOUNT,'AWS_ACCOUNT_MISMATCH')
 cfg=aws('lambda','get-function-configuration',['--function-name',FUNCTION]);env=cfg.get('Environment',{}).get('Variables',{})
 p=Probe();p.authenticate(env);p.environment()
 write('environment.json',{'database':DATABASE,'host':HOST,'actualAuthUsernameExactlyP_heflo':True,'contextUsername':'p_heflo','company':11,'idmov':90767,'idlan':148481,'ticket':228310,'bankId':2,'bankCompany':11,'financialCreateAllowed':False,'maxSameBankSave':1})
 before=snapshot(p);again=snapshot(p);require(not changes(before,again),'PREFLIGHT_NOT_STABLE')
 save_private_snapshot('before-full.json',before,p)
 write('attempt.json',{'state':'DISPATCHING_ONE_SAME_BANK_SAVE','observedUtc':utc(),'automaticRetry':False})
 root=ET.Element('FinLAN');row=ET.SubElement(root,'FLAN')
 for k,v in {'CODCOLIGADA':'11','IDLAN':'148481','CODCOLPGTO':'11','CODCOLCFO':'0','CODCFO':'0000173261','IDPGTO':'2'}.items():ET.SubElement(row,k).text=v
 p.armed=True;error=None;status=None;response=None
 try:status,response=p.save(ET.tostring(root,encoding='unicode'))
 except Exception as e:error=e
 message_retained=False
 if response is not None:
  try:
   redacted,counts=redact(response,p.secrets)
   with (OUT/'native-response-redacted.txt').open('x',encoding='utf-8')as f:f.write(redacted)
   write('native-response.json',{'httpStatus':status,'responseSha256':sha(response),'redactedSha256':sha(redacted),'length':len(response),'lineCount':len(response.splitlines()),'redactions':counts,'exactKey':response.strip()=='11;148481','rawCredentialsRetained':False});message_retained=True
  except Exception:
   write('native-response-retention-failed.json',{'responseSha256':sha(response),'length':len(response),'gate':'REDACTED_MESSAGE_RETENTION_FAILED','rawCredentialsRetained':False})
 observed=[]
 for independent in (False,True):
  label='independent'if independent else'same-session'
  if independent:p.opener=urllib.request.build_opener(NoRedirect())
  try:
   after=snapshot(p);save_private_snapshot('after-'+label+'-full.json',after,p);diff=changes(before,after)
   observed.append({'mode':label,'validated':True,'changedColumns':diff,'onlyKnownAuditChanged':all(x['field']in AUDIT and x['table']in('launch','LAUNCH_JSON')for x in diff)})
  except Exception as e:observed.append({'mode':label,'validated':False,'errorType':type(e).__name__,'gate':str(e)if isinstance(e,GuardError)else'READBACK_FAILED'})
 result={'database':DATABASE,'ticket':228310,'company':11,'idmov':90767,'idlan':148481,'sameBankId':2,'sameBankCompany':11,'actualAuthUsernameExactlyP_heflo':True,'saveCalls':p.saves,'nativeExactKey':response is not None and response.strip()=='11;148481','transportErrorType':type(error).__name__ if error else None,'readbacks':observed,'productionFinancialWrites':False,'creations':False,'nullResetPerformed':False,'automaticRetry':False,'messageFile':'native-response-redacted.txt'if message_retained else None}
 write('result.json',result)
 ok=not error and result['nativeExactKey']and all(x['validated']and x['onlyKnownAuditChanged']for x in observed)
 print(json.dumps({'state':'VERIFIED_SAME_BANK'if ok else'UNKNOWN_OR_REJECTED_NO_RETRY','saveCalls':p.saves,'nativeExactKey':result['nativeExactKey'],'privateArtifactContainsRedactedMessage':response is not None}));return 0 if ok else 2

if __name__=='__main__':
 try:raise SystemExit(main())
 except Exception as e:print(json.dumps({'state':'STOPPED_NO_RETRY','errorType':type(e).__name__,'gate':str(e)if isinstance(e,GuardError)else'EXTERNAL_FAILURE'}));raise SystemExit(2)
