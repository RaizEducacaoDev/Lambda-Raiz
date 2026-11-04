"""Remote bank-only repair of eight existing FLAN targets. Dry-run default.

No creation/workflow/root mutation. Application requires a fresh consistent AWS
lease check at the actual native POST boundary and a durable one-shot claim.
Secrets/full records stay in RAM. Amounts and dates never enter SaveRecord XML.
"""
from pathlib import Path
from decimal import Decimal
import argparse, datetime as dt, hashlib, importlib.util, json, os, re
import subprocess, sys, time, uuid, xml.etree.ElementTree as ET
import base64, copy, urllib.request, urllib.parse, urllib.error

ROOT=Path(__file__).resolve().parents[1]
TARGETS={
 228007:(5,165611,634500,None,None,1,5),
 227386:(18,407685,2191110,None,None,7,18),
 226610:(25,42677,79094,None,None,5,25),
 228103:(8,565011,870364,1,8,24,8),
 228158:(8,565012,870365,1,8,24,8),
 228198:(8,565013,870366,1,8,24,8),
 228275:(8,565014,870367,1,8,24,8),
 228793:(2,278473,751379,1,2,7,2),
}
AUDIT={'RECMODIFIEDBY','RECMODIFIEDON'}
WRITABLE={'IDPGTO','CODCOLPGTO','CODIGOBARRA','IPTE'}

class GuardError(Exception):pass
def require(ok,code):
 if not ok:raise GuardError(code)
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def serial(v):
 if isinstance(v,Decimal):return str(v)
 if isinstance(v,(dt.datetime,dt.date)):return v.isoformat()
 if isinstance(v,(bytes,bytearray,memoryview)):return {'binarySha256':hashlib.sha256(bytes(v)).hexdigest()}
 raise TypeError(type(v).__name__)
def packed(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,default=serial)
def digest(v):return hashlib.sha256(packed(v).encode()).hexdigest()
def text(v):return ''if v is None else str(v)
def day(v):
 v=text(v).split('T')[0].split(' ')[0]
 return '-'.join(v.split('/')[::-1])if'/'in v else v
def money(v):
 v=text(v)
 return Decimal(v.replace('.','').replace(',','.'))if','in v else Decimal(v)
def normalized_record_value(value):
 if isinstance(value, bool) or value is None:return value
 if isinstance(value, (int, Decimal)):
  number=Decimal(value);return {'number':format(number.normalize(),'f') if number else '0'}
 if isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?',value):
  return {'datetime':dt.datetime.fromisoformat(value).isoformat(timespec='microseconds')}
 return value

def fingerprint(row,exclude=()):return digest({k:normalized_record_value(v)for k,v in row.items()if k not in exclude})
def safe_fields(row,fields):
 return {k:{'present':row.get(k)not in(None,''),'sha256':hashlib.sha256(text(row.get(k)).strip().encode()).hexdigest(),**({'value':row.get(k)}if k in('IDPGTO','CODCOLPGTO')else{})}for k in fields}

def qualify(s,ticket,after=False):
 require(ticket in TARGETS,'TICKET_NOT_ALLOWLISTED')
 company,mov,lan,old,oldcol,target,targetcol=TARGETS[ticket]
 require(s['active']is True and s['flow']==299,'ZEEV_NOT_ACTIVE_FINANCIAL')
 require(not any(t.startswith('T15')for t in s['tasks']),'WORKFLOW_ALREADY_ADVANCED')
 v=s['validation'];f=s['form'];pv=v['payloadValidation'];key=pv.get('key',{})
 require(v.get('aliasIdentity',{}).get('valid')is True and pv.get('valid')is True,'INVALID_PAYMENT_IDENTITY')
 require(v.get('bankValidation',{}).get('valid')is True,'INVALID_BANK_SELECTION')
 require(text(f.get('codigoDaColigada2'))==str(company),'FORM_COMPANY_CHANGED')
 require((text(key.get('idPgto')),text(key.get('codColPgto')))==(str(target),str(targetcol)),'CURRENT_SELECTION_CHANGED')
 require(len(s['sqlMov'])==len(s['nativeMov'])==1,'OWN_MOVEMENT_COUNT_CHANGED')
 require(len(s['sqlLan'])==len(s['nativeLan'])==len(s['plans'])==1,'INSTALLMENT_COUNT_CHANGED')
 sm=s['sqlMov'][0];nm=s['nativeMov'][0];sl=s['sqlLan'][0];nl=s['nativeLan'][0];plan=s['plans'][0]
 require((int(sm['CODCOLIGADA']),int(sm['IDMOV']),int(sl['IDLAN']))==(company,mov,lan),'EXACT_TARGET_CHANGED')
 require(text(s['ticketLink'])==str(ticket),'MOVEMENT_TICKET_PROVENANCE_CHANGED')
 require(s['allOwnMovementKeys']==[[company,mov]],'TICKET_HAS_OTHER_MOVEMENT')
 require(s['allOwnLaunchKeys']==[[company,lan]],'TICKET_HAS_OTHER_LAUNCH')
 expected={'CODCOLIGADA':str(company),'CODFILIAL':f['codigoDaFilial2'],'CODCOLCFO':key['codColCfo'],'CODCFO':f['codigoDoFornecedor'],'CODTMV':pv['codTmv']}
 for k,value in expected.items():require(text(nm.get(k))==text(sm.get(k))==text(value),'HEADER_'+k+'_MISMATCH')
 require(text(nm['IDMOV'])==text(sm['IDMOV'])==str(mov),'MOVEMENT_KEY_MISMATCH')
 require(nm.get('STATUS')!='C' and text(nm.get('STATUS'))==text(sm.get('STATUS')),'MOVEMENT_STATUS_MISMATCH')
 doc=s['document'];require(len(doc)==1,'DOCUMENT_CONTRACT_AMBIGUOUS')
 d=doc[0];require(d.get('DOC_MATCH_COUNT')==1 and text(d.get('IDMOV'))==str(mov)and text(d.get('TICKET'))==str(ticket),'DOCUMENT_NOT_EXACTLY_OWNED')
 for native,effective in [('NUMEROMOV','EFFECTIVE_NUMBER'),('SERIE','EFFECTIVE_SERIES'),('CODTDO','EFFECTIVE_DOCUMENT_TYPE')]:
  require(text(nm.get(native))==text(sm.get(native))==text(d.get(effective)),'DOCUMENT_'+native+'_MISMATCH')
 require(day(nm['DATAEMISSAO'])==day(sm['DATAEMISSAO'])==day(f['dataDeEmissao']),'EMISSION_MISMATCH')
 require(day(nm['DATASAIDA'])==day(sm['DATASAIDA']),'ENTRY_NATIVE_SQL_MISMATCH')
 if f.get('dataDeEntrada'):require(day(nm['DATASAIDA'])==day(f['dataDeEntrada']),'EXPLICIT_ENTRY_MISMATCH')
 for k in('VALORBRUTO','VALORLIQUIDO'):require(money(nm[k])==money(sm[k])==money(f['valorTotalDoPagamento']),'MOVEMENT_AMOUNT_MISMATCH')
 require(f.get('qtdParcelas')in(None,'','1'),'DECLARED_INSTALLMENT_COUNT_MISMATCH')
 for k in('CODCOLIGADA','CODFILIAL','CODCOLCFO','CODCFO','IDMOV'):
  require(text(nl.get(k))==text(sl.get(k))==text(nm.get(k)),'LAN_'+k+'_MISMATCH')
 require(text(nl.get('IDLAN'))==text(sl.get('IDLAN'))==str(lan),'LAN_KEY_MISMATCH')
 require(day(nl['DATAVENCIMENTO'])==day(sl['DATAVENCIMENTO'])==day(plan['vencimento']),'DUE_DATE_MISMATCH')
 require(day(nl['DATAEMISSAO'])==day(sl['DATAEMISSAO'])==day(f['dataDeEmissao']),'LAN_EMISSION_MISMATCH')
 require(money(nl['VALORORIGINAL'])==money(sl['VALORORIGINAL'])==money(plan['valor'])==money(f['valorTotalDoPagamento']),'LAN_AMOUNT_MISMATCH')
 for row in(nl,sl):
  require(text(row.get('STATUSLAN'))=='0'and money(row['VALORBAIXADO'])==0 and money(row['BAIXAPENDENTE'])==0,'LAN_NOT_OPEN_UNPAID')
  require(row.get('IDBOLETO')in(None,'','0',0),'LAN_HAS_BOLETO')
 require(s['boletoCount']==0 and s['pendingPaymentCount']==0,'LAN_DEPENDENCY_EXISTS')
 require(len(s['payments'])==1 and text(s['payments'][0]['IDLAN'])==str(lan),'TMOVPAGTO_CHAIN_MISMATCH')
 expected_before=(target,targetcol)if after else(old,oldcol)
 for row in(nl,sl):require(tuple(text(row.get(k))for k in('IDPGTO','CODCOLPGTO'))==tuple(text(x)for x in expected_before),'BEFORE_BANK_CHANGED'if not after else'AFTER_BANK_INCORRECT')
 fields=dict(plan['campos']);require(set(fields)<=WRITABLE and {'IDPGTO','CODCOLPGTO'}<=set(fields),'UNSUPPORTED_PAYMENT_FIELDS')
 require((fields['IDPGTO'],fields['CODCOLPGTO'])==(str(target),str(targetcol)),'PLAN_TARGET_CHANGED')
 require(all(isinstance(v,str)and v.strip()==v and v for v in fields.values()),'NONCANONICAL_PAYMENT_VALUE')
 if ticket==228007:require(set(fields)=={'IDPGTO','CODCOLPGTO'},'CANARY_MUST_ONLY_WRITE_TWO_IDS')
 for k in('CODIGOBARRA','IPTE'):
  require(text(nl.get(k)).strip()==text(sl.get(k)).strip(),'PAYMENT_NATIVE_SQL_MISMATCH')
  if k not in fields:require(not text(nl.get(k)).strip(),'EXISTING_PAYMENT_FIELD_NOT_IN_SELECTED_PLAN')
 if after:
  for k,value in fields.items():require(text(nl.get(k)).strip()==text(sl.get(k)).strip()==value,'AFTER_'+k+'_INCORRECT')
 return fields

def review(s,ticket):
 fields=qualify(s,ticket);company,mov,lan,*_=TARGETS[ticket]
 baseline={
  'formDigest':s['formDigest'],'intentDigest':s['validation']['payloadValidation']['digest'],
  'sqlMovFull':fingerprint(s['sqlMov'][0]),'sqlLanFull':fingerprint(s['sqlLan'][0]),
  'nativeMovFull':fingerprint(s['nativeMov'][0]),'nativeLanFull':fingerprint(s['nativeLan'][0]),
  'bankRecordHash':s['bankRecordHash'],'paymentLinkHash':digest(s['payments']),
  'documentHash':digest(s['document']),'tasks':s['tasks'],
  'dataset':s['dataset'],'remoteSources':s.get('remoteSources',{}),
 }
 return {'version':1,'ticket':ticket,'company':company,'idmov':mov,'idlan':lan,'baseline':baseline,
  'before':safe_fields(s['sqlLan'][0],sorted(fields)),'target':safe_fields(fields,sorted(fields)),
  'writeFields':sorted(fields),'entryComparison':'explicit_equal'if s['form'].get('dataDeEntrada')else'form_omitted_preserve_existing',
  'sqlImmutableHash':fingerprint(s['sqlLan'][0],set(fields)|AUDIT),'sqlMovementHash':fingerprint(s['sqlMov'][0]),
  'scope':'existing bank association only; no document creation or financial amounts/dates',
  'requiresControlWindow':True}

def xml_for(ticket,fields,dataset='FinLAN'):
 company,_,lan,*_=TARGETS[ticket]
 require(set(fields)<=WRITABLE and {'IDPGTO','CODCOLPGTO'}<=set(fields),'INVALID_WRITE_ALLOWLIST')
 root=ET.Element(dataset);row=ET.SubElement(root,'FLAN')
 for k,v in [('CODCOLIGADA',str(company)),('IDLAN',str(lan)),*sorted(fields.items())]:ET.SubElement(row,k).text=v
 return ET.tostring(root,encoding='unicode')

def validate_after(before,after,ticket,fields):
 qualify(after,ticket,after=True)
 require(before['formDigest']==after['formDigest'],'FORM_CHANGED_DURING_WRITE')
 require(before['bankRecordHash']==after['bankRecordHash'],'BANK_CHANGED_DURING_WRITE')
 require(before.get('remoteSources',{})==after.get('remoteSources',{}),'REMOTE_SOURCE_CHANGED_DURING_WRITE')
 require(fingerprint(before['sqlMov'][0])==fingerprint(after['sqlMov'][0]),'SOURCE_MOVEMENT_CHANGED')
 require(fingerprint(before['sqlLan'][0],set(fields)|AUDIT)==fingerprint(after['sqlLan'][0],set(fields)|AUDIT),'NONPAYMENT_SQL_COLUMN_CHANGED')
 require(digest(before['payments'])==digest(after['payments']),'SOURCE_PAYMENT_LINK_CHANGED')
 require(fingerprint(before['nativeLan'][0],set(fields)|AUDIT)==fingerprint(after['nativeLan'][0],set(fields)|AUDIT),'NONPAYMENT_NATIVE_COLUMN_CHANGED')

def write_json(path,value,exclusive=False):
 with path.open('x'if exclusive else'w',encoding='utf-8')as handle:
  handle.write(json.dumps(value,default=serial,ensure_ascii=False,indent=2));handle.flush();os.fsync(handle.fileno())

def validate_lease(path,expected_sha,ticket):
 raw=path.read_bytes();require(hashlib.sha256(raw).hexdigest()==expected_sha,'LEASE_FILE_SHA_MISMATCH')
 lease=json.loads(raw);company,mov,lan,*_=TARGETS[ticket]
 for k,v in {'version':1,'ticket':ticket,'company':company,'idmov':mov,'idlan':lan}.items():
  require(type(lease.get(k))is int and lease[k]==v,'LEASE_EXACT_TARGET_MISMATCH')
 require(lease.get('conditionMatched')is True and lease.get('rootBusinessUnchanged')is True,'LEASE_CAS_NOT_PROVEN')
 require(str(uuid.UUID(lease.get('owner','')))==lease['owner'],'LEASE_OWNER_INVALID')
 require(bool(re.fullmatch(r'https://github\.com/[^/]+/[^/]+/actions/runs/[0-9]+',lease.get('workflowRunUrl',''))),'LEASE_WORKFLOW_REFERENCE_INVALID')
 remaining=lease.get('expiresAtEpoch',0)-time.time()
 require(120<remaining<=25*60,'LEASE_EXPIRY_INVALID_OR_TOO_CLOSE')
 dt.datetime.fromisoformat(lease['observedUtc'].replace('Z','+00:00'))
 return lease

def audit_snapshot(s):
 return {'formDigest':s['formDigest'],'bankRecordHash':s['bankRecordHash'],
  'sqlMovementColumnHashes':{k:fingerprint({k:v})for k,v in s['sqlMov'][0].items()},
  'sqlLaunchColumnHashes':{k:fingerprint({k:v})for k,v in s['sqlLan'][0].items()},
  'nativeLaunchColumnHashes':{k:digest(v)for k,v in s['nativeLan'][0].items()},
  'paymentLinkHash':digest(s['payments'])}

def execute(adapter,ticket,expected,expected_sha,output,control_reference,lease_path,lease_sha):
 require(digest(expected)==expected_sha,'REVIEW_SHA_MISMATCH')
 require(expected.get('ticket')==ticket,'REVIEW_TICKET_MISMATCH')
 require(bool(control_reference.strip()),'CONTROL_WINDOW_REFERENCE_REQUIRED')
 lease=validate_lease(lease_path,lease_sha,ticket)
 output.mkdir(parents=True,exist_ok=True)
 marker=output/f'attempt-{ticket}.json'
 # Exclusive persistent marker also prohibits repeat after success, failure or unknown response.
 write_json(marker,{'ticket':ticket,'state':'LOCKED_PREFLIGHT','createdUtc':utc(),'reviewSha256':expected_sha,'controlReference':control_reference,'leaseOwner':lease['owner'],'leaseFileSha256':lease_sha},exclusive=True)
 dispatched=False
 try:
  read_started=time.monotonic()
  first=adapter.read(ticket);require(review(first,ticket)==expected,'STALE_REVIEW_OR_CONCURRENT_CHANGE')
  fresh=adapter.read(ticket,independent=True);require(review(fresh,ticket)==expected,'FRESH_RECHECK_CHANGED')
  require(time.monotonic()-read_started<=60,'PREFLIGHT_OLDER_THAN_60_SECONDS')
  require(validate_lease(lease_path,lease_sha,ticket)==lease,'LEASE_CHANGED')
  fields=qualify(fresh,ticket)
  adapter.preflight_deadline=read_started+60
  adapter.claim_dispatch(ticket,expected_sha,lease,fields)
  require(time.monotonic()-read_started<=60,'PREFLIGHT_OLDER_THAN_60_SECONDS')
  write_json(output/f'before-{ticket}.json',{'observedUtc':utc(),'review':expected,'allColumnEvidence':audit_snapshot(fresh),'leaseOwner':lease['owner']})
  write_json(marker,{'ticket':ticket,'state':'DISPATCHING','atUtc':utc(),'reviewSha256':expected_sha,'controlReference':control_reference})
  dispatched=True
  response=None;save_error=None
  try:response=adapter.save(ticket,xml_for(ticket,fields,fresh['dataset']))
  except Exception as exc:save_error=exc
  company,_,lan,*_=TARGETS[ticket]
  after_checks=[];independent=None
  for separate in(False,True):
   label='independent'if separate else'same-session'
   try:
    observed=adapter.read(ticket,independent=separate)
    write_json(output/f'after-{label}-{ticket}.json',{'observedUtc':utc(),'allColumnEvidence':audit_snapshot(observed),'paymentFields':safe_fields(observed['sqlLan'][0],sorted(fields))})
    validate_after(fresh,observed,ticket,fields)
    after_checks.append({'mode':label,'valid':True})
    if separate:independent=observed
   except Exception as exc:
    after_checks.append({'mode':label,'valid':False,'errorType':type(exc).__name__,'code':str(exc)if isinstance(exc,GuardError)else'READBACK_FAILED'})
  write_json(output/f'readback-checks-{ticket}.json',{'checks':after_checks,'saveErrorType':type(save_error).__name__ if save_error else None,'responseExactKey':text(response).strip()==f'{company};{lan}'})
  if save_error:raise save_error
  require(text(response).strip()==f'{company};{lan}','SAVE_RESPONSE_NOT_EXACT_KEY')
  require(all(x['valid']for x in after_checks),'READBACK_NOT_FULLY_VERIFIED')
  result={'ticket':ticket,'state':'VERIFIED','observedUtc':utc(),'reviewSha256':expected_sha,'changedFields':sorted(fields),
   'after':safe_fields(independent['sqlLan'][0],sorted(fields)),
   'sqlImmutableHash':fingerprint(independent['sqlLan'][0],set(fields)|AUDIT),
   'sqlMovementHash':fingerprint(independent['sqlMov'][0]),'sameSessionAndIndependentReadback':True,'retryAllowed':False}
  write_json(output/f'result-{ticket}.json',result);write_json(marker,result);return result
 except Exception as exc:
  failure={'ticket':ticket,'state':'OUTCOME_UNCERTAIN_NO_RETRY'if dispatched else'BLOCKED_BEFORE_DISPATCH','observedUtc':utc(),'reviewSha256':expected_sha,
   'errorType':type(exc).__name__,'errorCode':str(exc)if isinstance(exc,GuardError)else'EXTERNAL_FAILURE','retryAllowed':False}
  write_json(marker,failure);raise

def load_module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec)
 sys.modules[name]=module;spec.loader.exec_module(module);return module

observer=load_module('bank_remote_observer',ROOT/'scripts/observe-payment-backlog.py')
lease_module=load_module('bank_remote_lease',ROOT/'scripts/lease-payment-bank-backlog.py')
CONTRACTS={'RAIZ.PG.DOC2':'pagamento-documento-v2.sql','RAIZ.PG.BANK2':'pagamento-bank-readback.sql'}

NODE=r"""
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const load=require('./tests/load-ts.cjs');
const m=load(path.resolve('src/functions/rm/post/pagamentoIdentidade.ts'));
const d=load(path.resolve('src/functions/rm/post/pagamentoDocumento.ts'));
const x=JSON.parse(fs.readFileSync(0,'utf8'));let out;
try {
 const key=m.identidadePagamento(x.payload),alias=m.identidadePagamento(x.form);
 if(JSON.stringify(key)!==JSON.stringify(alias))throw Error('alias');
 const plans=m.planosPagamento(x.payload,key),type=m.codigoMovimento(x.payload);
 const documentKey=d.prepararDocumento(x.payload,{codColigada:x.form.codigoDaColigada2,codFilial:x.form.codigoDaFilial2,codColCfo:key.codColCfo,codCfo:key.codCfo,codTmv:type});
 if(!documentKey)throw Error('document');
 out={valid:true,aliasIdentity:{valid:true,key:alias},payloadValidation:{valid:true,key,codTmv:type,digest:m.hashIntencao(m.intencaoPagamento(x.payload,key,plans,type))},documentKey,plans};
 if(x.bank){
   m.validarCadastro(x.bank,key,{...x.payload,...x.form},plans);
   d.validarDocumentoExistente(x.document,documentKey,String(x.idmov),String(x.ticket));
   out.bankValidation={valid:true};
 }
}catch(e){out={valid:false,code:typeof e.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(e.code)?e.code:'CURRENT_PAYMENT_VALIDATION_FAILED'};}
process.stdout.write(JSON.stringify(out));
"""

def parse_bank_query(rows,ticket):
 require(ticket in TARGETS and isinstance(rows,list)and len(rows)==1,'BANK_QUERY_NOT_UNIQUE')
 row=rows[0];company,mov,lan,*_=TARGETS[ticket]
 expected={'BANK_VERSION':1,'REQUEST_COMPANY':company,'REQUEST_TICKET':ticket,'REQUEST_IDMOV':mov,'REQUEST_IDLAN':lan,'EXACT_SCOPE_ALLOWED':1}
 require(all(type(row.get(k))is int and row[k]==v for k,v in expected.items()),'BANK_QUERY_SCOPE_MISMATCH')
 result={}
 for key in('MOVEMENT_JSON','LAUNCH_JSON','OWNED_MOVEMENTS_JSON','OWNED_LAUNCHES_JSON','COMPLEMENT_JSON'):
  require(isinstance(row.get(key),str),'BANK_QUERY_JSON_MISSING')
  value=json.loads(row[key],parse_float=Decimal)
  require(isinstance(value,list)and len(value)<1001 and all(isinstance(x,dict)for x in value),'BANK_QUERY_JSON_INVALID')
  result[key]=value
 for key in('BOLETO_COUNT','PAYMENT_COUNT'):
  require(type(row.get(key))is int and row[key]>=0,'BANK_QUERY_COUNT_INVALID');result[key]=row[key]
 require(len(result['COMPLEMENT_JSON'])==1,'BANK_QUERY_COMPLEMENT_NOT_UNIQUE')
 return result

def checked_remote_proof(proof,ticket):
 company,mov,lan,*_=TARGETS[ticket];pk=f'prod#PG#{company}#{ticket}'
 require((proof.get('ticket'),proof.get('company'),proof.get('idmov'),proof.get('idlan'))==(ticket,company,mov,lan),'LEASE_REMOTE_TARGET_MISMATCH')
 before=proof.get('before',{});leased=proof.get('leasedRoot',{})
 require(before.get('pk')==leased.get('pk')=={'S':pk},'LEASE_REMOTE_ROOT_MISMATCH')
 require(before.get('state',{}).get('S')in('CREATED','CREATING'),'LEASE_ROOT_STATE_INVALID')
 require(leased.get('owner')=={'S':proof['owner']}and int(leased.get('lockUntil',{}).get('N',0))//1000==proof['expiresAtEpoch'],'LEASE_REMOTE_OWNER_OR_EXPIRY_MISMATCH')
 require({k:v for k,v in before.items()if k not in('owner','lockUntil')}=={k:v for k,v in leased.items()if k not in('owner','lockUntil')},'LEASE_ROOT_BUSINESS_CHANGED')
 if 'pg'in before:require(before['pg']=={'S':str(mov)},'LEASE_ROOT_MOVEMENT_MISMATCH')
 require(proof.get('archiveKey')==pk+'#BANK_REPAIR_LEASE#'+proof['owner'],'LEASE_ARCHIVE_KEY_MISMATCH')
 require(120<proof['expiresAtEpoch']-time.time()<=25*60,'LEASE_EXPIRED_OR_NEAR_EXPIRY')
 return pk

class RemoteLiveAdapter(observer.Observer):
 def __init__(self,ticket,proof=None):
  require(ticket in TARGETS,'TICKET_NOT_ALLOWLISTED')
  self.plan={'ticket':ticket};self.deadline=time.monotonic()+600
  self.opener=urllib.request.build_opener(observer.NoRedirect())
  self.template=observer.TEMPLATE.read_text(encoding='utf-8-sig')
  self.proof=proof;self.claimed=None;self.save_attempted=False;self.preflight_deadline=None
  self.rm_auth=None;self.rm_user=None;self.zeev_token=None

 def config(self):
  require(self.aws('sts','get-caller-identity')['Account']==observer.m.ACCOUNT,'AWS_ACCOUNT_MISMATCH')
  cfg=self.aws('lambda','get-function-configuration','--function-name',observer.m.FUNCTION)
  env=cfg.get('Environment',{}).get('Variables',{})
  require(cfg.get('State')=='Active'and cfg.get('LastUpdateStatus')=='Successful','LAMBDA_NOT_STABLE')
  require(env.get('STAGE')=='prod'and env.get('PAGAMENTO_IDPGTO_TABLE')==lease_module.TABLE,'LAMBDA_ENVIRONMENT_MISMATCH')
  require(env.get('RM_PROD','').rstrip('/')==observer.HOST.replace(':8051','')and env.get('ZEEV_PROD','').rstrip('/')==observer.ZEEV,'REMOTE_ENDPOINT_MISMATCH')
  token=os.environ.get('RECONCILE_ZEEV_TOKEN')
  require(token and env.get('USERNAME_TOTVS')and env.get('PASSWORD_TOTVS'),'REMOTE_READ_CREDENTIALS_MISSING')
  self.rm_auth='Basic '+base64.b64encode((env['USERNAME_TOTVS']+':'+env['PASSWORD_TOTVS']).encode()).decode()
  self.rm_user=env['USERNAME_TOTVS'];self.zeev_token=token
  return {'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId']}

 def contracts(self):
  hashes={}
  for code,filename in CONTRACTS.items():
   expected=observer.normalized_sql((ROOT/'sql'/filename).read_text(encoding='utf-8-sig'))
   row=observer.unique(self.read_record('GlbConsSQLData','0;T;'+code,0),'GConsSql')
   require(observer.normalized_sql(row.get('SENTENCA',''))==expected,'NATIVE_BANK_CONTRACT_CHANGED')
   hashes[code]=hashlib.sha256(expected.encode()).hexdigest()
  return hashes

 def query(self,code,params):
  require(code in CONTRACTS and all(re.fullmatch(r'[A-Za-z0-9._~:\-]+',str(v))for v in params.values()),'QUERY_OUTSIDE_BANK_SCOPE')
  url=observer.HOST+f'/api/framework/v1/consultaSQLServer/RealizaConsulta/{code}/0/T?'+urllib.parse.urlencode({'parameters':';'.join(f'{k}={v}'for k,v in params.items())})
  return json.loads(self.http(url,'RM_QUERY',headers={'Authorization':self.rm_auth,'Accept':'application/json'}))

 def node(self,value):
  p=subprocess.run(['node','-e',NODE],cwd=ROOT,input=json.dumps(value,ensure_ascii=False),capture_output=True,text=True,encoding='utf-8',timeout=20)
  require(p.returncode==0,'BANK_PLAN_VALIDATOR_FAILED');result=json.loads(p.stdout)
  require(result.get('valid')is True,result.get('code','BANK_PLAN_INVALID'));return result

 def read(self,ticket,independent=False):
  require(ticket==self.plan['ticket'],'ADAPTER_TARGET_CHANGED')
  self.deadline=time.monotonic()+180
  previous=self.opener
  if independent:self.opener=urllib.request.build_opener(observer.NoRedirect())
  try:
   runtime=self.config();contracts=self.contracts()
   names=sorted(set(re.findall(r'\{Form\.(\w+)\}',self.template)+observer.EXTRA))
   data,_=self.zeev_snapshot(names);payload,form=observer.render(data,self.template)
   first=self.node({'payload':payload,'form':form});key=first['payloadValidation']['key']
   company,mov,lan,*_=TARGETS[ticket]
   bank=observer.unique(self.read_record('FinDadosPgtoDataBR',f"{key['codColPgto']};{key['codColCfo']};{key['codCfo']};{key['idPgto']}",company),'FDadosPgto')
   dk=first['documentKey']
   document=self.query('RAIZ.PG.DOC2',{'CODCOLIGADA':dk['codColigada'],'CODFILIAL':dk['codFilial'],'CODCOLCFO':dk['codColCfo'],'CODCFO':dk['codCfo'],'CODTMV':dk['codTmv'],'NUMERO':dk['numero'],'SERIE':dk['serie']or'~'})
   checked=self.node({'payload':payload,'form':form,'bank':bank,'document':document,'idmov':mov,'ticket':ticket})
   mx=self.read_record('MovMovimentoTBCData',f'{company};{mov}',company)
   lx=self.read_record('FinLanDataBR',f'{company};{lan}',company)
   complement=observer.unique(mx,'TMOVCOMPL')
   independent_rows=parse_bank_query(self.query('RAIZ.PG.BANK2',{'CODCOLIGADA':company,'TICKET':ticket,'IDMOV':mov,'IDLAN':lan}),ticket)
   require(text(independent_rows['COMPLEMENT_JSON'][0].get('TICKET'))==text(complement.get('TICKET')),'NATIVE_SQL_TICKET_MISMATCH')
   return {'active':data['active'],'flow':data['flow']['id'],
    'tasks':sorted({x.get('task',{}).get('name','')for x in data['instanceTasks']if x.get('active')}),
    'form':form,'formDigest':digest(data['formFields']),'validation':checked,'plans':checked['plans'],'bankRecordHash':digest(bank),
    'nativeMov':observer.records(mx,'TMOV'),'nativeLan':observer.records(lx,'FLAN'),
    'sqlMov':independent_rows['MOVEMENT_JSON'],'sqlLan':independent_rows['LAUNCH_JSON'],
    'dataset':lx.tag,'ticketLink':complement.get('TICKET'),'payments':observer.records(mx,'TMOVPAGTO'),'document':document,
    'allOwnMovementKeys':[[x['CODCOLIGADA'],x['IDMOV']]for x in independent_rows['OWNED_MOVEMENTS_JSON']],
    'allOwnLaunchKeys':[[x['CODCOLIGADA'],x['IDLAN']]for x in independent_rows['OWNED_LAUNCHES_JSON']],
    'boletoCount':independent_rows['BOLETO_COUNT'],'pendingPaymentCount':independent_rows['PAYMENT_COUNT'],
    'remoteSources':{'runtime':runtime,'contracts':contracts,'templateSha256':observer.template_sha(),'operatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}}
  finally:self.opener=previous

 def assert_live_lease(self,ticket,archive=False):
  require(self.proof is not None,'REMOTE_LEASE_REQUIRED');pk=checked_remote_proof(self.proof,ticket)
  if archive:
   expected={'pk':{'S':self.proof['archiveKey']},'original':{'M':self.proof['before']},'leaseOwner':self.proof['leasedRoot']['owner'],'leaseUntil':self.proof['leasedRoot']['lockUntil']}
   require(lease_module.get(self.proof['archiveKey'])==expected,'REMOTE_LEASE_ARCHIVE_CHANGED')
  require(lease_module.get(pk)==self.proof['leasedRoot'],'LIVE_DYNAMODB_LEASE_CHANGED')
  return pk

 def claim_dispatch(self,ticket,plan_sha,proof,fields):
  require(self.proof==proof and self.claimed is None,'DISPATCH_LEASE_PROOF_CHANGED')
  require(self.preflight_deadline is not None and time.monotonic()<=self.preflight_deadline,'FRESH_PREFLIGHT_REQUIRED')
  pk=self.assert_live_lease(ticket,archive=True);company,_,lan,_,_,target,targetcol=TARGETS[ticket]
  require(set(fields)<=WRITABLE and fields.get('IDPGTO')==str(target)and fields.get('CODCOLPGTO')==str(targetcol),'CLAIM_FIELDS_NOT_ALLOWLISTED')
  if ticket==228007:require(set(fields)=={'IDPGTO','CODCOLPGTO'},'CANARY_FIELDS_NOT_MINIMAL')
  key=pk+'#BANK_REPAIR_ATTEMPT'
  claim={'pk':{'S':key},'nonce':{'S':str(uuid.uuid4())},'ticket':{'N':str(ticket)},'company':{'N':str(company)},'idlan':{'N':str(lan)},'leaseOwner':{'S':proof['owner']},'planSha256':{'S':plan_sha},'targetFieldsSha256':{'S':digest(fields)},'state':{'S':'CLAIMED_NO_AUTOMATIC_RETRY'},'observedUtc':{'S':utc()}}
  try:lease_module.aws('dynamodb','put-item',{'TableName':lease_module.TABLE,'Item':claim,'ConditionExpression':'attribute_not_exists(pk)'})
  except Exception:pass
  require(lease_module.get(key)==claim,'DURABLE_BANK_ATTEMPT_ALREADY_EXISTS_OR_UNCERTAIN')
  self.claimed=claim;self.claimed_fields=copy.deepcopy(fields)

 def native_save_http(self,raw,headers):
  try:
   with self.opener.open(urllib.request.Request(observer.HOST+'/wsDataServer/IwsDataServer',data=raw,headers=headers),timeout=15)as response:value=response.read(8000001)
  except urllib.error.HTTPError as error:raise GuardError(f'BANK_SAVE_HTTP_{error.code}')from None
  except(urllib.error.URLError,TimeoutError):raise GuardError('BANK_SAVE_NETWORK_OUTCOME_UNCERTAIN')from None
  require(len(value)<=8000000,'BANK_SAVE_RESPONSE_TOO_LARGE')
  root=observer.xml_dataset(value)
  require(not any(x.tag.endswith('Fault')for x in root.iter()),'BANK_SAVE_SOAP_FAULT')
  result=root.find('.//{http://www.totvs.com/}SaveRecordResult')
  require(result is not None and result.text,'BANK_SAVE_RESULT_MISSING');return result.text

 def save(self,ticket,xml):
  require(ticket==self.plan['ticket']and self.claimed is not None and not self.save_attempted,'SAVE_NOT_CLAIMED_OR_ALREADY_ATTEMPTED')
  self.save_attempted=True;company,_,lan,*_=TARGETS[ticket]
  dataset=observer.xml_dataset(xml);rows=observer.records(dataset,'FLAN')
  require(len(rows)==1 and len(dataset)==1,'SAVE_RECORD_NOT_MINIMAL')
  row=rows[0];require(row.get('CODCOLIGADA')==str(company)and row.get('IDLAN')==str(lan)and set(row)<={'CODCOLIGADA','IDLAN'}|WRITABLE,'SAVE_RECORD_SCOPE_INVALID')
  require({k:v for k,v in row.items()if k not in('CODCOLIGADA','IDLAN')}==self.claimed_fields,'SAVE_FIELDS_DIFFER_FROM_CLAIM')
  envelope=ET.Element('{http://schemas.xmlsoap.org/soap/envelope/}Envelope');body=ET.SubElement(envelope,'{http://schemas.xmlsoap.org/soap/envelope/}Body');operation=ET.SubElement(body,'SaveRecord',xmlns='http://www.totvs.com/')
  for k,v in {'DataServerName':'FinLanDataBR','XML':xml,'Contexto':f'CODCOLIGADA={company};CODSISTEMA=F;CODUSUARIO={self.rm_user}'}.items():ET.SubElement(operation,k).text=v
  raw=ET.tostring(envelope);headers={'Authorization':self.rm_auth,'Content-Type':'text/xml;charset=UTF-8','SOAPAction':'http://www.totvs.com/IwsDataServer/SaveRecord'}
  # Last external operation before the native POST: consistent exact lease read.
  self.assert_live_lease(ticket)
  require(self.preflight_deadline is not None and time.monotonic()<=self.preflight_deadline,'PREFLIGHT_EXPIRED_BEFORE_NATIVE_POST')
  return self.native_save_http(raw,headers)

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--ticket',type=int,choices=sorted(TARGETS),required=True);parser.add_argument('--output-dir',type=Path,default=ROOT/'.payment-bank-repair')
 parser.add_argument('--apply',action='store_true');parser.add_argument('--review',type=Path);parser.add_argument('--expect-plan-sha')
 parser.add_argument('--lease-proof',type=Path);parser.add_argument('--expect-lease-sha');parser.add_argument('--control-reference',default='')
 args=parser.parse_args();args.output_dir.mkdir(parents=True,exist_ok=True)
 if args.apply:
  require(args.review and args.expect_plan_sha and args.lease_proof and args.expect_lease_sha,'REMOTE_REVIEW_AND_LEASE_REQUIRED')
  proof=validate_lease(args.lease_proof,args.expect_lease_sha,args.ticket);checked_remote_proof(proof,args.ticket)
  expected=json.loads(args.review.read_text(encoding='utf-8'))
  adapter=RemoteLiveAdapter(args.ticket,proof)
  result=execute(adapter,args.ticket,expected,args.expect_plan_sha,args.output_dir,args.control_reference or proof['workflowRunUrl'],args.lease_proof,args.expect_lease_sha)
 else:
  adapter=RemoteLiveAdapter(args.ticket);snapshot=adapter.read(args.ticket);plan=review(snapshot,args.ticket)
  path=args.output_dir/f'plan-{args.ticket}.json';write_json(path,plan)
  result={'ticket':args.ticket,'mode':'READ_ONLY','planFile':path.name,'planSha256':digest(plan),'writeFields':plan['writeFields'],'observedUtc':utc(),'financialWrites':False}
 write_json(args.output_dir/f'summary-{args.ticket}.json',result);print(json.dumps(result,default=serial))

if __name__=='__main__':
 try:main()
 except Exception as exc:
  safe=isinstance(exc,(GuardError,observer.m.GateError))
  print(json.dumps({'status':'STOPPED_NO_AUTOMATIC_RETRY','errorType':type(exc).__name__,'code':str(exc)if safe else'UNEXPECTED_FAILURE'}));sys.exit(2)
