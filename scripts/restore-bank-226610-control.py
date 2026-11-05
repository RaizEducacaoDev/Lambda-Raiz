"""Prepare exact administrative lease restoration; no RM or Zeev operations.

One separately approved CAS restores owner/lock only. The existing bank claim,
CREATED state, positive adjudication and original archive remain unchanged.
"""
import hashlib, importlib.util, json, os, re, subprocess, sys, urllib.request, uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('restore_226610_lease',ROOT/'scripts/lease-payment-bank-backlog.py')
lease=importlib.util.module_from_spec(s);s.loader.exec_module(lease)
RUN='41938110743'; COMMIT='4872fb586d6ac01dd7bfd4f80eb6127d866b65ee'
REPO='RaizEducacaoDev/Lambda-Raiz'; BRANCH='fix/idpgto-vinculo-obrigatorio'
SOURCE_WORKFLOW='.github/workflows/payment-bank-226610.yml'
WORKFLOW='.github/workflows/restore-bank-226610-control.yml'
CONFIG=ROOT/'.github/restore-bank-226610-control.json'
FUNCTION='lambda-raiz-prod-solicitacaoDePagamento'
RUNTIME={'codeSha256':'fATe4oapr4+C+6Lr1+HA34HKv2WxORkfpp4F70uv5Xw=',
         'revisionId':'a6054569-cbeb-4dd5-a78d-2636e9f1b8d2'}
PK='prod#PG#25#226610'; CLAIM=PK+'#BANK_REPAIR_ATTEMPT'
ROOT_SHA='72e34a290e7c1770b9f5dd2c00bae621be321e5cd0b25a42054d89c0b631e589'
LEASE_SHA='501c98d130e2ef04afc61ab8665a7cfa791ab24a53d9af59f649ed3b0299d728'
PLAN_SHA='f9b3a84cc773824fd3a14e9e840a49eb37efebf4fa3641a18be8661fdc35c8ed'
PRIVATE=Path('.restore-226610-reference/private'); LEASE_REF=Path('.restore-226610-reference/lease')
OUT=Path('.restore-bank-226610-control'); APPROVED=Path('.approved-restore-bank-226610-control')
ARTIFACTS={
 'private':(13374203888,'payment-bank-226610-private'),
 'lease':(13373934314,'payment-bank-226610-lease')}
PINS={
 'ticket-226610/native-response-redacted.txt':'4edc2ac561a37b79ab004b995572498975eace5248f7dd10bdf9bba25d664a33',
 'ticket-226610/readback-checks-226610.json':'d004373100fec29f46b4f9ab955bd3acb1261a0bdf4ffb6fe68dfe04a2cf6dea',
 'ticket-226610/after-same-session-226610.json':'22dcd334c499219aa4ab60e319389af07535a90ac843885e1c047a00c45338b0',
 'ticket-226610/after-independent-226610.json':'3e673fc7e196771aa0138f90d064be97e88056449a06f3dbeb777748ec13d263'}

class GuardError(Exception):pass
def require(ok,code):
 if not ok:raise GuardError(code)
def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def file_sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path,value):
 with path.open('x',encoding='utf-8')as handle:
  handle.write(json.dumps(value,indent=2));handle.flush();os.fsync(handle.fileno())

def github(path):
 token=os.environ.get('GH_TOKEN');require(bool(token),'GITHUB_READ_TOKEN_REQUIRED')
 req=urllib.request.Request('https://api.github.com/repos/'+REPO+path,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'})
 # This API endpoint contains no financial payload; redirects are not followed with credentials.
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 with urllib.request.build_opener(NoRedirect()).open(req,timeout=15)as response:return json.load(response)

def run_meta(meta,run,commit,workflow,conclusion=None):
 require(str(meta.get('id'))==run and meta.get('head_sha')==commit and meta.get('path')==workflow and
  meta.get('repository',{}).get('full_name')==REPO and meta.get('head_branch')==BRANCH and
  meta.get('event')=='push'and meta.get('run_attempt')==1,'RESTORE_RUN_PROVENANCE_CHANGED')
 if conclusion is not None:require(meta.get('status')=='completed'and meta.get('conclusion')==conclusion,'REFERENCE_RUN_NOT_FINISHED_AS_REVIEWED')

def artifact_meta(meta,run,name,identifier=None):
 require(isinstance(meta,dict)and isinstance(meta.get('artifacts'),list),'ARTIFACT_SCHEMA_INVALID')
 rows=[r for r in meta['artifacts']if r.get('name')==name]
 require(len(rows)==1 and rows[0].get('expired')is False and str(rows[0].get('workflow_run',{}).get('id'))==run and
  (identifier is None or rows[0].get('id')==identifier),'REFERENCE_ARTIFACT_CHANGED_OR_EXPIRED')

def source_hashes():
 return {p:file_sha(ROOT/p)for p in [
  'scripts/restore-bank-226610-control.py','scripts/lease-payment-bank-backlog.py',
  'tests/test_restore_bank_226610_control.py',WORKFLOW]}

def validate_config(value):
 require(isinstance(value,dict)and set(value)=={'version','mode','authorizedControlRestore','approvedPrepareRunId','approvedManifestSha256'}and
  type(value['version'])is int and value['version']==1 and value['mode']in('prepare','apply')and
  type(value['authorizedControlRestore'])is bool,'CONTROL_CONFIG_INVALID')
 require(isinstance(value['approvedPrepareRunId'],str)and isinstance(value['approvedManifestSha256'],str),'APPROVAL_FORMAT_INVALID')
 if value['mode']=='prepare':require(value['authorizedControlRestore']is False and value['approvedPrepareRunId']=='0'and value['approvedManifestSha256']=='','PREPARE_MUST_BE_READONLY')
 else:require(value['authorizedControlRestore']is True and re.fullmatch('[1-9][0-9]*',value['approvedPrepareRunId'])and re.fullmatch('[a-f0-9]{64}',value['approvedManifestSha256']),'EXPLICIT_PINNED_RESTORE_APPROVAL_REQUIRED')
 return value

def runtime():
 require(lease.aws('sts','get-caller-identity',{})['Account']==lease.ACCOUNT,'AWS_ACCOUNT_MISMATCH')
 r=subprocess.run(['aws','lambda','get-function-configuration','--function-name',FUNCTION,'--region',lease.REGION,
  '--output','json','--no-cli-pager','--cli-connect-timeout','5','--cli-read-timeout','15'],capture_output=True,text=True,timeout=25,
  env={**os.environ,'AWS_MAX_ATTEMPTS':'1','AWS_PAGER':''})
 require(r.returncode==0,'RUNTIME_READ_FAILED');cfg=json.loads(r.stdout)
 result={'codeSha256':cfg.get('CodeSha256'),'revisionId':cfg.get('RevisionId')}
 require(result==RUNTIME and cfg.get('State')=='Active'and cfg.get('LastUpdateStatus')=='Successful','CURRENT_RUNTIME_NOT_REVIEWED_OR_STABLE')
 return result

def load_proof():
 run_meta(github('/actions/runs/'+RUN),RUN,COMMIT,SOURCE_WORKFLOW,'failure')
 artifacts=github('/actions/runs/'+RUN+'/artifacts')
 for identifier,name in ARTIFACTS.values():artifact_meta(artifacts,RUN,name,identifier)
 path=LEASE_REF/'lease-226610.json';require(file_sha(path)==LEASE_SHA,'LEASE_FILE_CHANGED');proof=read(path)
 require(tuple(proof.get(k)for k in['version','ticket','company','idmov','idlan'])==(1,226610,25,42677,79094), 'LEASE_SCOPE_CHANGED')
 require(proof.get('conditionMatched')is True and proof.get('rootBusinessUnchanged')is True and
  lease.sha(proof.get('before'))==ROOT_SHA and proof['before'].get('state')=={'S':'CREATED'}and
  proof['before'].get('pg')=={'S':'42677'}and proof['before'].get('pk')=={'S':PK},'ORIGINAL_CREATED_ROOT_CHANGED')
 require(proof['leasedRoot']=={**proof['before'],'owner':{'S':proof['owner']},'lockUntil':proof['leasedRoot']['lockUntil']}and
  proof['archiveKey']==PK+'#BANK_REPAIR_LEASE#'+proof['owner'],'LEASE_BUSINESS_FIELDS_CHANGED')
 for name,expected in PINS.items():require(file_sha(PRIVATE/name)==expected,'NATIVE_BANK_EVIDENCE_FILE_CHANGED')
 checks=read(PRIVATE/'ticket-226610/readback-checks-226610.json')
 require(checks.get('responseExactKey')is True and checks.get('saveErrorType')is None and
  (PRIVATE/'ticket-226610/native-response-redacted.txt').read_text()=='25;79094','NATIVE_BANK_KEY_NOT_PROVEN')
 require(checks.get('checks')==[{'mode':mode,'valid':False,'errorType':'GuardError','code':'NONPAYMENT_SQL_COLUMN_CHANGED'}for mode in['same-session','independent']], 'BANK_EXCEPTION_NOT_THE_REVIEWED_EXCEPTION')
 for mode in['same-session','independent']:
  fields=read(PRIVATE/f'ticket-226610/after-{mode}-226610.json')['paymentFields']
  require({k:v.get('value')for k,v in fields.items()}=={'IDPGTO':5,'CODCOLPGTO':25},'BANK_PERSISTENCE_NOT_PROVEN')
 return proof

def expected_archive(proof):
 return {'pk':{'S':proof['archiveKey']},'original':{'M':proof['before']},
         'leaseOwner':proof['leasedRoot']['owner'],'leaseUntil':proof['leasedRoot']['lockUntil']}

def validate_claim(claim,proof):
 keys={'pk','nonce','ticket','company','idlan','leaseOwner','planSha256','targetFieldsSha256','state','observedUtc'}
 require(isinstance(claim,dict)and set(claim)==keys,'CANONICAL_CLAIM_SCHEMA_CHANGED')
 expected={'pk':{'S':CLAIM},'ticket':{'N':'226610'},'company':{'N':'25'},'idlan':{'N':'79094'},
  'leaseOwner':{'S':proof['owner']},'planSha256':{'S':PLAN_SHA},
  'targetFieldsSha256':{'S':lease.sha({'IDPGTO':'5','CODCOLPGTO':'25'})},'state':{'S':'CLAIMED_NO_AUTOMATIC_RETRY'}}
 require(all(claim.get(k)==v for k,v in expected.items()),'CANONICAL_CLAIM_DOES_NOT_IDENTIFY_APPLY')
 require(str(uuid.UUID(claim['nonce']['S']))==claim['nonce']['S'],'CLAIM_NONCE_INVALID')

def observe(proof):
 before_runtime=runtime();root=lease.get(PK);archive=lease.get(proof['archiveKey']);claim=lease.get(CLAIM)
 require(root==proof['leasedRoot'],'FRESH_ROOT_NOT_EXACT_LEASED_SNAPSHOT')
 require(archive==expected_archive(proof),'FRESH_ARCHIVE_CHANGED');validate_claim(claim,proof)
 require(runtime()==before_runtime,'RUNTIME_CHANGED_DURING_CONTROL_READ')
 return {'root':root,'archive':archive,'claim':claim,'runtime':before_runtime}

def restore_once(proof,approved):
 require(observe(proof)==approved,'FRESH_CONTROL_DIFFERS_FROM_REVIEWED_PREPARE')
 # Shared release performs one exact snapshot CAS; ambiguity is resolved by readback, never a second update.
 result=lease.release(proof)
 require(result.get('released')is True and result.get('originalRootExactlyRestored')is True,'RESTORATION_NOT_CONFIRMED_NO_RETRY')
 require(lease.get(PK)==proof['before'],'FINAL_ROOT_NOT_ORIGINAL')
 require(lease.get(proof['archiveKey'])==approved['archive']and lease.get(CLAIM)==approved['claim'],'CLAIM_OR_ARCHIVE_CHANGED_DURING_RESTORE')
 return {'state':'RESTORED_CONTROL_ONLY','rootBusinessPreserved':True,'claimPreserved':True,
  'archivePreserved':True,'financialWrites':False,'taskCompleted':False,'automaticRetry':False,
  'acknowledgementLost':result.get('acknowledgementLost',False)}

def approved_plan(cfg,ctx):
 run=cfg['approvedPrepareRunId'];require(run!=ctx['runId'],'APPROVAL_MUST_REFERENCE_PRIOR_RUN')
 require(file_sha(APPROVED/'manifest.json')==cfg['approvedManifestSha256'],'REVIEWED_MANIFEST_CHANGED')
 manifest=read(APPROVED/'manifest.json');meta=github('/actions/runs/'+run)
 run_meta(meta,run,manifest.get('workflow',{}).get('commit'),WORKFLOW,'success')
 artifact_meta(github('/actions/runs/'+run+'/artifacts'),run,'restore-bank-226610-control-evidence')
 require(manifest.get('mode')=='prepare'and manifest.get('readOnly')is True and
  manifest.get('sourceHashes')==source_hashes()and manifest.get('runtime')==RUNTIME and
  manifest.get('workflow')=={**ctx,'runId':run,'commit':meta['head_sha']}and
  manifest.get('leaseFileSha256')==LEASE_SHA,'REVIEWED_SOURCE_OR_RUNTIME_CHANGED')
 require(manifest.get('planFileSha256')==file_sha(APPROVED/'plan.json'),'REVIEWED_PLAN_FILE_CHANGED')
 plan=read(APPROVED/'plan.json');require(manifest.get('planSha256')==lease.sha(plan),'REVIEWED_PLAN_CHANGED');return plan

def main():
 require(os.environ.get('GITHUB_ACTIONS')=='true'and os.environ.get('GITHUB_EVENT_NAME')=='push'and
  os.environ.get('GITHUB_REPOSITORY')==REPO and os.environ.get('GITHUB_REF')=='refs/heads/'+BRANCH and
  os.environ.get('GITHUB_RUN_ATTEMPT')=='1','RESTORE_CONTEXT_OR_RERUN_REJECTED')
 ctx={'repository':REPO,'branch':BRANCH,'workflow':WORKFLOW,'runId':os.environ['GITHUB_RUN_ID'],'commit':os.environ['GITHUB_SHA']}
 run_meta(github('/actions/runs/'+ctx['runId']),ctx['runId'],ctx['commit'],WORKFLOW)
 cfg=validate_config(read(CONFIG));OUT.mkdir(exist_ok=False);proof=load_proof()
 if cfg['mode']=='prepare':
  plan=observe(proof);write(OUT/'plan.json',plan)
  write(OUT/'manifest.json',{'version':1,'mode':'prepare','readOnly':True,'workflow':ctx,'runtime':RUNTIME,
   'sourceHashes':source_hashes(),'leaseFileSha256':LEASE_SHA,'planFileSha256':file_sha(OUT/'plan.json'),'planSha256':lease.sha(plan),
   'financialWrites':False,'dynamoWrites':False,'bankAuxiliaryExceptionNotResolved':True})
  print(json.dumps({'state':'PREPARED_CONTROL_READ_ONLY','manifestSha256':file_sha(OUT/'manifest.json')}));return 0
 plan=approved_plan(cfg,ctx);lease.OUT=OUT
 try:result=restore_once(proof,plan)
 except Exception as error:result={'state':'STOPPED_NO_RETRY','gate':str(error)if isinstance(error,GuardError)else'EXTERNAL_FAILURE','errorType':type(error).__name__,'financialWrites':False}
 write(OUT/'result.json',{'workflow':ctx,'runtime':RUNTIME,'sourceHashes':source_hashes(),**result})
 print(json.dumps(result));return 0 if result['state']=='RESTORED_CONTROL_ONLY'else 2

if __name__=='__main__':
 try:raise SystemExit(main())
 except Exception as error:
  print(json.dumps({'state':'STOPPED_NO_RETRY','gate':str(error)if isinstance(error,GuardError)else'EXTERNAL_FAILURE','errorType':type(error).__name__}));raise SystemExit(2)
