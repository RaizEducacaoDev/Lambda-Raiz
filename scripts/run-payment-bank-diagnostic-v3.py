"""PREPARE by default; one explicit, pinned bank-only diagnostic on 5/634500.

No financial creation, Lambda invocation, Zeev mutation, claim deletion or retry.
"""
import base64,hashlib,http.client,importlib.util,json,os,re,sys,time
from pathlib import Path
import urllib.error,urllib.request,xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);sys.modules[name]=value;spec.loader.exec_module(value);return value
common=load('bank_diag_existing_runner',ROOT/'scripts/run-payment-bank-repair.py')
op=common.operator;lease=op.lease_module
c=load('bank_diag_v3_contract',ROOT/'scripts/payment_bank_diagnostic_contract.py')
redaction=load('bank_diag_private_redaction',ROOT/'scripts/payment_native_redaction.py')
WORKFLOW='.github/workflows/payment-bank-diagnostic-v3.yml';CONFIG=ROOT/'.github/payment-bank-diagnostic-v3.json'
OUT=Path('.payment-bank-diagnostic-v3');APPROVED=Path('.approved-bank-diagnostic-v3')
RESTORE=Path('.bank-diagnostic-references/restore');HML=Path('.bank-diagnostic-references/hml')
require=op.require
def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def file_sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def write(name,value):op.write_json(OUT/name,value,exclusive=True)
def github_run(run_id):
 token=os.environ.get('GH_TOKEN');require(bool(token),'GITHUB_READ_TOKEN_REQUIRED')
 request=urllib.request.Request(f'https://api.github.com/repos/{common.REPOSITORY}/actions/runs/{run_id}',headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'})
 try:
  with urllib.request.build_opener(op.observer.NoRedirect()).open(request,timeout=15)as response:return json.load(response)
 except(urllib.error.URLError,TimeoutError):raise op.GuardError('GITHUB_REFERENCE_READ_FAILED')from None
def context():
 ctx=common.context();ctx['workflow']=WORKFLOW;return ctx
def config(value):
 require(isinstance(value,dict)and set(value)=={'version','mode','authorizedDiagnosticWrite','approvedPrepareRunId','approvedManifestSha256'},'DIAGNOSTIC_CONFIG_SCHEMA')
 require(type(value['version'])is int and value['version']==1 and value['mode']in('prepare','apply')and type(value['authorizedDiagnosticWrite'])is bool,'DIAGNOSTIC_CONFIG_MODE')
 if value['mode']=='prepare':require(value['authorizedDiagnosticWrite']is False and value['approvedPrepareRunId']=='0'and value['approvedManifestSha256']=='','PREPARE_CANNOT_AUTHORIZE_WRITE')
 else:require(value['authorizedDiagnosticWrite']is True and re.fullmatch('[1-9][0-9]*',value['approvedPrepareRunId'])and re.fullmatch('[a-f0-9]{64}',value['approvedManifestSha256']),'EXPLICIT_FRESH_DIAGNOSTIC_APPROVAL_REQUIRED')
 return value
def source_hashes():
 result=common.code_hashes()
 for path in ['scripts/run-payment-bank-diagnostic-v3.py','scripts/payment_bank_diagnostic_contract.py','scripts/payment_native_redaction.py','tests/test_payment_bank_diagnostic_v3.py',WORKFLOW]:result[path]=file_sha(ROOT/path)
 return dict(sorted(result.items()))
def reference_proof():
 metas={name:github_run(pin['id'])for name,pin in c.RUNS.items()}
 token=os.environ['GH_TOKEN']
 for name,pin in c.RUNS.items():
  request=urllib.request.Request(f'https://api.github.com/repos/{common.REPOSITORY}/actions/runs/{pin["id"]}/artifacts',headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'})
  with urllib.request.build_opener(op.observer.NoRedirect()).open(request,timeout=15)as response:items=json.load(response)['artifacts']
  matching=[item for item in items if item.get('name')==c.ARTIFACTS[name]['name']]
  require(len(matching)==1 and matching[0].get('id')==c.ARTIFACTS[name]['id']and matching[0].get('expired')is False,'REFERENCE_ARTIFACT_ID_OR_EXPIRY_CHANGED')
 return c.load_proof(RESTORE,HML,metas)

class DiagnosticAdapter(op.RemoteLiveAdapter):
 def __init__(self,proof,lease_proof=None,message_dir=None):
  super().__init__(228007,lease_proof);c.validate_proof(proof);self.diagnostic_proof=proof
  self.message_dir=message_dir;self.secret_values=[];self.http_dispatch_count=0
 def config(self):
  runtime=super().config();require(runtime==c.RUNTIME,'DIAGNOSTIC_RUNTIME_PIN_CHANGED')
  require(self.rm_user=='p_heflo','DIAGNOSTIC_AUTH_USER_CHANGED')
  decoded=base64.b64decode(self.rm_auth[6:]).decode('utf-8');password=decoded.split(':',1)[1]
  self.secret_values.extend([self.rm_user,password,self.rm_auth,self.rm_auth[6:],self.zeev_token]);return runtime
 def node(self,value):
  result=super().node(value);self.secret_values.extend(redaction.known_pii(value));return result
 def capture_message(self,raw,stage,complete):
  require(self.message_dir is not None,'PRIVATE_MESSAGE_DIRECTORY_REQUIRED');self.message_dir.mkdir(parents=True,exist_ok=True)
  text=raw.decode('utf-8',errors='replace')if isinstance(raw,bytes)else str(raw)
  try:
   root=ET.fromstring(text);result=root.find('.//{http://www.totvs.com/}SaveRecordResult')
   fault=next((n for n in root.iter()if n.tag.endswith('Fault')),None)
   if result is not None and result.text is not None:text=result.text
   elif fault is not None:text='\n'.join(t for t in fault.itertext()if t.strip())
   else:
    body=root.find('{http://schemas.xmlsoap.org/soap/envelope/}Body')
    if body is not None:text=ET.tostring(body,encoding='unicode')
  except ET.ParseError:pass
  safe,counts=redaction.redact(text,self.secret_values)
  path=self.message_dir/'native-response-redacted.txt'
  with path.open('x',encoding='utf-8')as f:f.write(safe);f.flush();os.fsync(f.fileno())
  op.write_json(self.message_dir/'native-response-private-metadata.json',{'stage':stage,'responseSha256':op.hashlib.sha256(text.encode()).hexdigest(),'redactedSha256':file_sha(path),'length':len(text),'lineCount':len(text.splitlines()),'completeResponse':complete,'redactions':counts,'rawCredentialsOrKnownPiiRetained':False},exclusive=True)
 def native_save_http(self,raw,headers):
  require(self.http_dispatch_count==0 and self.save_attempted and self.claimed is not None and self.claimed['pk']=={'S':c.CLAIM_V3},'DIAGNOSTIC_HTTP_NOT_ONE_SHOT_CLAIMED')
  require(set(self.claimed_fields)=={'IDPGTO','CODCOLPGTO'}and self.claimed_fields=={'IDPGTO':'1','CODCOLPGTO':'5'},'DIAGNOSTIC_TARGET_FIELDS_CHANGED')
  c.assert_controls(lease.get,self.diagnostic_proof,own_claim=self.claimed)
  require(self.config()==c.RUNTIME,'DIAGNOSTIC_RUNTIME_CHANGED_BEFORE_HTTP')
  self.assert_live_lease(228007)
  require(self.preflight_deadline is not None and time.monotonic()<=self.preflight_deadline,'PREFLIGHT_EXPIRED_BEFORE_DIAGNOSTIC_POST')
  self.http_dispatch_count+=1
  try:
   with self.opener.open(urllib.request.Request(op.observer.HOST+'/wsDataServer/IwsDataServer',data=raw,headers=headers),timeout=15)as response:value=response.read(8000001)
  except urllib.error.HTTPError as error:
   body=error.read(8000001);self.capture_message(body,'HTTP_ERROR',len(body)<=8000000)
   raise op.NativeSaveError(f'BANK_SAVE_HTTP_{error.code}',op.native_diagnostic(body))from None
  except http.client.IncompleteRead as error:
   self.capture_message(error.partial,'INCOMPLETE_HTTP_RESPONSE',False)
   raise op.NativeSaveError('BANK_SAVE_INCOMPLETE_RESPONSE_NO_RETRY',op.native_diagnostic(error.partial))from None
  except(urllib.error.URLError,TimeoutError):raise op.GuardError('BANK_SAVE_NETWORK_OUTCOME_UNCERTAIN_NO_RETRY')from None
  self.capture_message(value,'SAVE_RECORD_HTTP_RESPONSE',len(value)<=8000000)
  require(len(value)<=8000000,'BANK_SAVE_RESPONSE_TOO_LARGE')
  try:root=op.observer.xml_dataset(value)
  except Exception:raise op.NativeSaveError('BANK_SAVE_INVALID_XML',op.native_diagnostic(value))from None
  if any(n.tag.endswith('Fault')for n in root.iter()):raise op.NativeSaveError('BANK_SAVE_SOAP_FAULT',op.native_diagnostic(value))
  result=root.find('.//{http://www.totvs.com/}SaveRecordResult')
  require(result is not None and result.text,'BANK_SAVE_RESULT_MISSING');return result.text

def fresh_plan(proof):
 started=time.monotonic();adapter=DiagnosticAdapter(proof);first=adapter.read(228007);second=adapter.read(228007,independent=True)
 require(op.review(first,228007)==op.review(second,228007),'CURRENT_BUSINESS_OBSERVATION_CHANGED')
 for value in(first,second):require(c.sha(op.audit_snapshot(value))==c.COLUMN_SHA,'CURRENT_FINANCIAL_FORM_OR_BANK_EFFECT_FOUND')
 c.assert_controls(lease.get,proof,before_lease=True)
 require(time.monotonic()-started<=60,'DIAGNOSTIC_OBSERVATIONS_OLDER_THAN_60_SECONDS')
 return op.review(second,228007)
def approved_plan(value,ctx,proof):
 require(value['approvedPrepareRunId']!=ctx['runId'],'APPROVAL_CANNOT_REFERENCE_CURRENT_RUN')
 require(file_sha(APPROVED/'manifest.json')==value['approvedManifestSha256'],'DIAGNOSTIC_MANIFEST_SHA_CHANGED')
 manifest=read(APPROVED/'manifest.json');meta=github_run(value['approvedPrepareRunId'])
 expected={'id':value['approvedPrepareRunId'],'commit':manifest['workflow']['commit'],'workflow':WORKFLOW};c.validate_run(meta,expected)
 require(manifest.get('workflow')=={**ctx,'runId':value['approvedPrepareRunId'],'commit':meta['head_sha']}and manifest.get('version')==1 and manifest.get('mode')=='prepare'and manifest.get('readOnly')is True,'DIAGNOSTIC_MANIFEST_NOT_READONLY')
 require(manifest.get('sourceHashes')==source_hashes()and manifest.get('runtime')==c.RUNTIME and manifest.get('proof')==proof,'DIAGNOSTIC_REVIEWED_SOURCE_OR_PROOF_CHANGED')
 require(manifest.get('planFileSha256')==file_sha(APPROVED/'plan.json'),'DIAGNOSTIC_PLAN_FILE_CHANGED')
 plan=read(APPROVED/'plan.json');require(manifest.get('planSha256')==op.digest(plan),'DIAGNOSTIC_PLAN_HASH_CHANGED')
 return plan
def apply_once(proof,plan,ctx):
 c.assert_controls(lease.get,proof,before_lease=True)
 require(fresh_plan(proof)==plan,'LIVE_PLAN_DIFFERS_FROM_APPROVED_PREPARE')
 audit=read(common.AUDIT);require(audit.get('coverageComplete')is True,'ORIGINAL_AUDIT_INCOMPLETE')
 lease.OUT.mkdir(exist_ok=True);lease.acquire({'ticket':228007},audit)
 path=lease.OUT/'lease-228007.json';lp=read(path);require(c.sha(lp['before'])==c.ROOT_SHA,'NEW_LEASE_ORIGINAL_ROOT_CHANGED')
 require(op.validate_lease(path,file_sha(path),228007)==lp,'NEW_LEASE_PROOF_CHANGED');op.checked_remote_proof(lp,228007)
 directory=OUT/'ticket-228007';adapter=DiagnosticAdapter(proof,lp,directory)
 result=op.execute(adapter,228007,plan,op.digest(plan),directory,f'https://github.com/{common.REPOSITORY}/actions/runs/{ctx["runId"]}',path,file_sha(path))
 require(result.get('state')=='VERIFIED'and result.get('sameSessionAndIndependentReadback')is True and adapter.http_dispatch_count==1,'DIAGNOSTIC_OUTCOME_NOT_VERIFIED_NO_RETRY')
 restored=lease.release(lp);require(restored.get('released')is True and restored.get('originalRootExactlyRestored')is True,'DIAGNOSTIC_LEASE_RELEASE_NOT_VERIFIED')
 return {'state':'VERIFIED','bankVerified':True,'leaseReleased':True,'httpDispatches':1}
def main():
 cfg=config(read(CONFIG));ctx=context();OUT.mkdir(exist_ok=False)
 current=github_run(ctx['runId'])
 require(current.get('head_sha')==ctx['commit']and current.get('path')==WORKFLOW and current.get('head_branch')==common.BRANCH and current.get('repository',{}).get('full_name')==common.REPOSITORY and current.get('event')=='push'and current.get('run_attempt')==1,'CURRENT_DIAGNOSTIC_RUN_PROVENANCE_INVALID')
 require(lease.aws('sts','get-caller-identity',{})['Account']==lease.ACCOUNT,'AWS_ACCOUNT_MISMATCH')
 proof=reference_proof();c.assert_controls(lease.get,proof,before_lease=True)
 if cfg['mode']=='prepare':
  plan=fresh_plan(proof);write('plan.json',plan)
  manifest={'version':1,'mode':'prepare','readOnly':True,'workflow':ctx,'runtime':c.RUNTIME,'sourceHashes':source_hashes(),'proof':proof,'planSha256':op.digest(plan),'planFileSha256':file_sha(OUT/'plan.json'),'financialWrites':False,'leaseAcquired':False}
  write('manifest.json',manifest);print(json.dumps({'state':'PREPARED_READ_ONLY','runId':ctx['runId'],'manifestSha256':file_sha(OUT/'manifest.json'),'automaticApply':False}));return 0
 plan=approved_plan(cfg,ctx,proof)
 try:result=apply_once(proof,plan,ctx)
 except Exception as e:
  result={'state':'STOPPED_NO_AUTOMATIC_RETRY','errorType':type(e).__name__,'gate':str(e)if isinstance(e,(op.GuardError,c.GuardError))else'EXTERNAL_FAILURE','leaseMayRemainUntilExpiry':True}
 write('result.json',{'ticket':228007,'company':5,'idmov':165611,'idlan':634500,'runtime':c.RUNTIME,'workflow':ctx,'sourceHashes':source_hashes(),'automaticRetry':False,'financialDocumentCreations':False,'zeevWrites':False,'lambdaInvoked':False,**result});print(json.dumps(result));return 0 if result['state']=='VERIFIED'else 2
if __name__=='__main__':
 try:raise SystemExit(main())
 except Exception as e:print(json.dumps({'state':'STOPPED_NO_RETRY','errorType':type(e).__name__,'gate':str(e)if isinstance(e,(op.GuardError,c.GuardError))else'EXTERNAL_FAILURE'}));raise SystemExit(2)
