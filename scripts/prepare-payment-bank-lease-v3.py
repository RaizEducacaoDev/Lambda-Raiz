"""Read-only proposal to restore one failed bank attempt's administrative lease.

There is deliberately no APPLY mode or external write method. Both attempt
claims, the prior receipt and the archive stay intact. This does not authorize
another financial attempt or manufacture a new no-effect receipt.
"""
import argparse
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
REPOSITORY='RaizEducacaoDev/Lambda-Raiz'
BRANCH='fix/idpgto-vinculo-obrigatorio'
WORKFLOW='.github/workflows/payment-bank-lease-v3-readonly.yml'
SOURCE_WORKFLOW='.github/workflows/payment-bank-repair.yml'
SOURCE_RUN='41911008831'
SOURCE_COMMIT='c6c01b1b1af1eed4cef73e54d95d908bedee3bb1'
ACCOUNT='757843862365';REGION='sa-east-1'
TABLE='lambda-raiz-prod-pagamento-idpgto'
TICKET=228007;COMPANY=5;IDMOV=165611;IDLAN=634500
ROOT_KEY='prod#PG#5#228007'
CLAIM_V1=ROOT_KEY+'#BANK_REPAIR_ATTEMPT'
CLAIM_V2=CLAIM_V1+'#CFO_REFERENCE_V2'
CLAIM_V1_SHA='ec8ebb29ce759e4499c2116e4294416c36b27612a3c5e149b0b2f486f2f66591'
RECEIPT_KEY=ROOT_KEY+'#BANK_REPAIR_NO_EFFECT#'+CLAIM_V1_SHA
RECEIPT_SHA='dd43d10552cf3cc86b3744b8ae1d8cdd704725913e3d8085d6b2a81a27ac7b8c'
LEASE_OWNER='16dca672-7a7c-4b70-87c2-7513d0cb52f7'
ARCHIVE_KEY=ROOT_KEY+'#BANK_REPAIR_LEASE#'+LEASE_OWNER
LEASE_SHA='d503664af2819a123b2488dfc4582eee10d82891c0c7aead92ca12e0685cc9fa'
BEFORE_ROOT_SHA='d37dbe6017559dc039927a7d4f941dc4dffd81f632dc2b1b88c22839ac998850'
LEASED_ROOT_SHA='bce56180e22352bf48af2ba953088ee45bd8c939d1cbf343ae4f3a9b7c840ad3'
PLAN_SHA='f92e81b214980019ccace1d4261d2052f6521e034467b4f7a70da390e161ddb3'
COLUMN_SHA='29adc8573bb2debff45aa16f2ea7725d24a44edcb235cc2f77d62921a7e78efb'
RUNTIME={'codeSha256':'ECffjgl6BpvRQrtHh3+O++D7/SAvTGAe8r9XTJqJIKE=',
         'revisionId':'29524d8b-327d-4389-a7ed-cab0b04aae2e'}
FILE_PINS={
 'summary.json':'0f46264ec6f58a7f6e26d4ad21d0bb56fcdb04021ad5ff1b5071e803ef927a89',
 'failure-228007.json':'ee6b5897e8580d979cb3b7e776c2314f3655aee9867ec463b2b0c5114324ffec',
 'ticket-228007/before-228007.json':'2c87d9d2cf76a7fb40092189d13cf6fb9669f842d515f5270aaf00613e7f6d3b',
 'ticket-228007/after-same-session-228007.json':'77d8dfc8c85c32737bb74e8f6c002196d3e5ba7b30130cba55218c59d2e365a5',
 'ticket-228007/after-independent-228007.json':'4ad4299aa5424845812c13992141790f09dd1800ee175d819c0315c4317809ec',
 'ticket-228007/attempt-228007.json':'9b1c579f0aa5380d653bd1f17b0d271e4edae270fafce01d5d5e5c6fd56c5071',
 'ticket-228007/native-response-228007.json':'12f57a8242a40b10d4ce3c84b3fe4617ec0b97a79ebd6223b795d645de20f87b'}
CLAIM_KEYS={'pk','nonce','ticket','company','idlan','leaseOwner','planSha256','targetFieldsSha256','state','observedUtc'}
CONTROL_KEYS=(ROOT_KEY,ARCHIVE_KEY,CLAIM_V1,CLAIM_V2,RECEIPT_KEY)

class GuardError(Exception):pass
def require(ok,code):
    if not ok:raise GuardError(code)
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
def sha(v):return hashlib.sha256(canonical(v).encode()).hexdigest()
def file_sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read_json(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def stamp(s):
    try:
        d=dt.datetime.fromisoformat(s.replace('Z','+00:00'));require(d.tzinfo is not None,'TIME_ZONE_REQUIRED');return d
    except (AttributeError,ValueError,TypeError):raise GuardError('INVALID_TIMESTAMP') from None

def validate_columns(v):
    require(set(v)=={'formDigest','bankRecordHash','sqlMovementColumnHashes','sqlLaunchColumnHashes','nativeLaunchColumnHashes','paymentLinkHash'},'COLUMN_SCHEMA_CHANGED')
    for k,n in [('sqlMovementColumnHashes',276),('sqlLaunchColumnHashes',271),('nativeLaunchColumnHashes',146)]:
        require(len(v[k])==n and all(re.fullmatch('[a-f0-9]{64}',h) for h in v[k].values()),'COLUMN_CENSUS_INCOMPLETE')
    require(sha(v)==COLUMN_SHA,'OBSERVED_FINANCIAL_EFFECT_OR_FORM_CHANGE')

def load_evidence(directory,lease_path):
    require(file_sha(lease_path)==LEASE_SHA,'LEASE_FILE_CHANGED')
    files={}
    for name,h in FILE_PINS.items():
        require(file_sha(directory/name)==h,'SOURCE_FILE_CHANGED');files[name]=read_json(directory/name)
    lease=read_json(lease_path);before=files['ticket-228007/before-228007.json'];summary=files['summary.json']
    require((lease['version'],lease['ticket'],lease['company'],lease['idmov'],lease['idlan'],lease['owner'])==
      (1,TICKET,COMPANY,IDMOV,IDLAN,LEASE_OWNER),'LEASE_TARGET_CHANGED')
    require(lease['archiveKey']==ARCHIVE_KEY and lease['rootBusinessUnchanged'] is True and lease['conditionMatched'] is True,'LEASE_PROOF_CHANGED')
    require(sha(lease['before'])==BEFORE_ROOT_SHA and sha(lease['leasedRoot'])==LEASED_ROOT_SHA,'ROOT_SNAPSHOT_CHANGED')
    require({k:v for k,v in lease['before'].items() if k not in ('owner','lockUntil')}==
      {k:v for k,v in lease['leasedRoot'].items() if k not in ('owner','lockUntil')},'BUSINESS_ROOT_DIFFERS')
    require(summary['workflow']=={'repository':REPOSITORY,'branch':BRANCH,'workflow':SOURCE_WORKFLOW,'runId':SOURCE_RUN,'commit':SOURCE_COMMIT} and
      summary['runtime']==RUNTIME and summary['mode']=='apply' and summary['requestedTickets']==[TICKET] and summary['allVerified'] is False,'SOURCE_RUN_CHANGED')
    require(all(summary[k] is False for k in ('zeevWrites','lambdaInvoked','financialDocumentCreations','automaticRetry')),'SOURCE_UNEXPECTED_WRITES')
    attempt=files['ticket-228007/attempt-228007.json']
    require(attempt['state']=='OUTCOME_UNCERTAIN_NO_RETRY' and attempt['errorCode']=='SAVE_RESPONSE_NOT_EXACT_KEY' and
      attempt['reviewSha256']==PLAN_SHA and attempt['retryAllowed'] is False,'ATTEMPT_NOT_PINNED')
    require(sha(before['review'])==PLAN_SHA and before['leaseOwner']==LEASE_OWNER,'SOURCE_REVIEW_CHANGED')
    require(before['review']['baseline']['remoteSources']['runtime']==RUNTIME,'SOURCE_RUNTIME_CHANGED')
    validate_columns(before['allColumnEvidence']);previous=stamp(before['observedUtc'])
    for name in ('same-session','independent'):
        after=files[f'ticket-228007/after-{name}-228007.json']
        require(after['allColumnEvidence']==before['allColumnEvidence'] and after['paymentFields']==before['review']['before'],'SOURCE_EFFECT_FOUND')
        require(previous<=stamp(after['observedUtc'])<=stamp(attempt['observedUtc']),'SOURCE_TIMELINE_INVALID');previous=stamp(after['observedUtc'])
    archive={'pk':{'S':ARCHIVE_KEY},'original':{'M':lease['before']},'leaseOwner':lease['leasedRoot']['owner'],'leaseUntil':lease['leasedRoot']['lockUntil']}
    return {'lease':lease,'archive':archive,'review':before['review'],'columns':before['allColumnEvidence'],'sourceHashes':summary['codeSha256']}

def validate_claims(items,receipt_validator):
    old=items[CLAIM_V1];new=items[CLAIM_V2];receipt=items[RECEIPT_KEY]
    require(sha(old)==CLAIM_V1_SHA and sha(receipt)==RECEIPT_SHA,'V1_CLAIM_OR_RECEIPT_CHANGED')
    receipt_validator(receipt,old)
    require(set(new)==CLAIM_KEYS,'V2_CLAIM_SCHEMA_CHANGED')
    expected={'pk':{'S':CLAIM_V2},'ticket':{'N':str(TICKET)},'company':{'N':str(COMPANY)},'idlan':{'N':str(IDLAN)},
      'leaseOwner':{'S':LEASE_OWNER},'planSha256':{'S':PLAN_SHA},'targetFieldsSha256':{'S':sha({'CODCOLPGTO':'5','IDPGTO':'1'})},
      'state':{'S':'CLAIMED_NO_AUTOMATIC_RETRY'}}
    require(all(new.get(k)==v for k,v in expected.items()),'V2_CLAIM_NOT_CORRELATED')
    require(set(new['nonce'])=={'S'} and re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',new['nonce']['S']),'V2_NONCE_INVALID')
    # The durable claim is written before the before-snapshot artifact, then SaveRecord.
    require(set(new['observedUtc'])=={'S'} and stamp('2026-11-04T20:54:49.465338Z')<=stamp(new['observedUtc']['S'])<=stamp('2026-11-04T20:55:18.191134Z'),'V2_CLAIM_TIME_INVALID')

def controls(backend,evidence):
    require(backend.runtime()==RUNTIME,'ACTIVE_RUNTIME_CHANGED')
    items={k:backend.get(k) for k in CONTROL_KEYS}
    require(items[ROOT_KEY]==evidence['lease']['leasedRoot'],'ROOT_NO_LONGER_LEASE_V3')
    require(items[ARCHIVE_KEY]==evidence['archive'],'LEASE_ARCHIVE_CHANGED')
    validate_claims(items,backend.validate_receipt)
    return items

def full_match(item):
    names={};values={};conditions=[]
    for i,(k,v) in enumerate(sorted(item.items())):
        names[f'#a{i}']=k;values[f':a{i}']=copy.deepcopy(v);conditions.append(f'#a{i} = :a{i}')
    if item.get('pk')=={'S':ROOT_KEY}:
        for k in ('pg','protocolVersion','recuperadaCriacaoIncerta','reconciliationEvidenceKey'):
            if k not in item:
                alias=f'#m{len(names)}';names[alias]=k;conditions.append(f'attribute_not_exists({alias})')
    return {'ConditionExpression':' AND '.join(conditions),'ExpressionAttributeNames':names,'ExpressionAttributeValues':values}

def restoration_transaction(evidence,items):
    """Pure proposal builder; never dispatched by this read-only program."""
    require(items[ROOT_KEY]==evidence['lease']['leasedRoot'] and items[ARCHIVE_KEY]==evidence['archive'],'TRANSACTION_SOURCE_CHANGED')
    ops=[]
    for key in (CLAIM_V1,CLAIM_V2,ARCHIVE_KEY,RECEIPT_KEY):
        ops.append({'ConditionCheck':{'TableName':TABLE,'Key':{'pk':{'S':key}},**full_match(items[key])}})
    update=full_match(items[ROOT_KEY]);update['ExpressionAttributeNames']['#restoreOwner']='owner'
    update['ExpressionAttributeValues'].update({':restoreOwner':evidence['lease']['before']['owner'],':restoreLock':evidence['lease']['before']['lockUntil']})
    update.update(TableName=TABLE,Key={'pk':{'S':ROOT_KEY}},UpdateExpression='SET #restoreOwner = :restoreOwner, lockUntil = :restoreLock')
    return {'TransactItems':ops+[{'Update':update}]}

def source_hashes():
    return {n:file_sha(ROOT/n) for n in ('scripts/prepare-payment-bank-lease-v3.py','tests/test_payment_bank_lease_v3.py',WORKFLOW)}

def prepare(backend,evidence,ctx):
    initial=controls(backend,evidence);start=time.monotonic();observations=[]
    for independent in (False,True):
        v=backend.observe(independent)
        require(v['runtime']==RUNTIME and v['review']==evidence['review'],'FORM_BANK_SOURCE_OR_PAYMENT_CHANGED')
        validate_columns(v['columns']);require(v['columns']==evidence['columns'],'FULL_COLUMN_HASH_CHANGED')
        require(0<=(stamp(utc())-stamp(v['observedUtc'])).total_seconds()<=60,'OBSERVATION_NOT_FRESH')
        observations.append(v['observedUtc'])
    final=controls(backend,evidence)
    require(final==initial,'CONTROL_CHANGED_DURING_OBSERVATION')
    require(time.monotonic()-start<=60,'OBSERVATION_WINDOW_EXCEEDS_60_SECONDS')
    tx=restoration_transaction(evidence,final)
    return {'version':1,'state':'READY_FOR_ROOT_REVIEW','preparedUtc':utc(),'workflow':ctx,'sourceRunId':SOURCE_RUN,'sourceCommit':SOURCE_COMMIT,
      'sourceFilesSha256':dict(FILE_PINS),'leaseFileSha256':LEASE_SHA,'reviewSha256':PLAN_SHA,'codeSha256':source_hashes(),
      'ticket':TICKET,'company':COMPANY,'idmov':IDMOV,'idlan':IDLAN,'runtime':dict(RUNTIME),
      'controlItemSha256':{k:sha(v) for k,v in final.items()},'expectedRestoredRootSha256':BEFORE_ROOT_SHA,'transactionSha256':sha(tx),
      'freshObservation':{'firstUtc':observations[0],'secondUtc':observations[1],'allColumnEvidenceSha256':COLUMN_SHA,
        'columnCounts':{'sqlMovement':276,'sqlLaunch':271,'nativeLaunch':146},'formBankSourceAndPaymentsUnchanged':True,'fullControlSweepUnchanged':True},
      'proposal':{'conditionChecks':4,'updates':1,'updateFields':['owner','lockUntil'],'newReceipts':0,'claimMutations':0,
        'preservedKeys':[CLAIM_V1,CLAIM_V2,ARCHIVE_KEY,RECEIPT_KEY]},
      'dynamoWrites':False,'financialWrites':False,'zeevWrites':False,'lambdaInvoked':False,'automaticRetryAllowed':False,
      'newFinancialAttemptAuthorized':False,'applyAuthorized':False,'historicalRollbackProven':False}

def context(env=None):
    e=os.environ if env is None else env
    require(e.get('GITHUB_ACTIONS')=='true' and e.get('GITHUB_EVENT_NAME')=='push' and e.get('GITHUB_RUN_ATTEMPT')=='1' and
      e.get('GITHUB_REPOSITORY')==REPOSITORY and e.get('GITHUB_REF')=='refs/heads/'+BRANCH,'WORKFLOW_CONTEXT_INVALID')
    require(re.fullmatch('[1-9][0-9]*',e.get('GITHUB_RUN_ID','')) and re.fullmatch('[a-f0-9]{40}',e.get('GITHUB_SHA','')),'WORKFLOW_ID_INVALID')
    return {'repository':REPOSITORY,'workflow':WORKFLOW,'runId':e['GITHUB_RUN_ID'],'commit':e['GITHUB_SHA']}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise GuardError('REDIRECT_FORBIDDEN')

class Live:
    def __init__(self,source_root,evidence):
        head=subprocess.run(['git','rev-parse','HEAD'],cwd=source_root,capture_output=True,text=True,check=True).stdout.strip()
        require(head==SOURCE_COMMIT,'SOURCE_CHECKOUT_CHANGED')
        for name,h in evidence['sourceHashes'].items():require(file_sha(source_root/name)==h,'SOURCE_DEPENDENCY_CHANGED')
        def module(name,path):
            spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
        self.operator=module('lease_v3_frozen_bank',source_root/'scripts/repair-payment-bank-backlog.py')
        receipts=module('lease_v3_frozen_receipts',source_root/'scripts/adjudicate-payment-bank-no-effect.py')
        self.validate_receipt=receipts.validate_manual_retry_receipt
        class ReadOnly(self.operator.RemoteLiveAdapter):
            def save(self,*a,**k):raise GuardError('FINANCIAL_WRITE_FORBIDDEN')
            def native_save_http(self,*a,**k):raise GuardError('FINANCIAL_WRITE_FORBIDDEN')
            def claim_dispatch(self,*a,**k):raise GuardError('CLAIM_WRITE_FORBIDDEN')
        self.adapter=ReadOnly(TICKET)
        self.verify_source_run()

    def verify_source_run(self):
        token=os.environ.get('GH_TOKEN');require(bool(token),'GITHUB_TOKEN_MISSING')
        request=urllib.request.Request(f'https://api.github.com/repos/{REPOSITORY}/actions/runs/{SOURCE_RUN}',headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'})
        with urllib.request.build_opener(NoRedirect()).open(request,timeout=15) as response:v=json.load(response)
        require(str(v.get('id'))==SOURCE_RUN and v.get('head_sha')==SOURCE_COMMIT and v.get('path')==SOURCE_WORKFLOW and
          v.get('repository',{}).get('full_name')==REPOSITORY and v.get('head_branch')==BRANCH and v.get('event')=='push' and
          v.get('run_attempt')==1 and v.get('status')=='completed' and v.get('conclusion')=='failure','SOURCE_RUN_NOT_ENDED_OR_CHANGED')

    def aws(self,operation,payload):
        require(operation=='get-item' and payload.get('TableName')==TABLE and payload.get('ConsistentRead') is True and
          payload.get('Key',{}).get('pk',{}).get('S') in CONTROL_KEYS,'READ_ONLY_OPERATION_REQUIRED')
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'read.json';p.write_text(json.dumps(payload),encoding='utf-8')
            r=subprocess.run(['aws','dynamodb',operation,'--region',REGION,'--cli-input-json','file://'+str(p),'--output','json','--no-cli-pager',
              '--cli-connect-timeout','5','--cli-read-timeout','15'],capture_output=True,text=True,timeout=25,
              env={**os.environ,'AWS_MAX_ATTEMPTS':'1','AWS_RETRY_MODE':'standard','AWS_PAGER':''})
        require(r.returncode==0,'AWS_READ_FAILED_NO_RETRY');return json.loads(r.stdout or '{}')
    def get(self,key):return self.aws('get-item',{'TableName':TABLE,'ConsistentRead':True,'Key':{'pk':{'S':key}}}).get('Item',{})
    def runtime(self):
        require(self.adapter.aws('sts','get-caller-identity')['Account']==ACCOUNT,'AWS_ACCOUNT_CHANGED')
        r=self.adapter.config();require(r==RUNTIME,'RUNTIME_CHANGED');return r
    def observe(self,independent):
        v=self.adapter.read(TICKET,independent=independent)
        return {'observedUtc':utc(),'runtime':v['remoteSources']['runtime'],'review':self.operator.review(v,TICKET),'columns':self.operator.audit_snapshot(v)}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--evidence-dir',type=Path,default=Path('.failed-bank-v2'))
    p.add_argument('--lease-proof',type=Path,default=Path('.failed-bank-v3-lease/lease-228007.json'))
    p.add_argument('--source-root',type=Path,default=Path('.bank-v2-source'))
    p.add_argument('--output-dir',type=Path,default=Path('.payment-bank-lease-v3'))
    args=p.parse_args();ctx=context();args.output_dir.mkdir(exist_ok=False)
    e=load_evidence(args.evidence_dir,args.lease_proof);b=Live(args.source_root.resolve(),e);v=prepare(b,e,ctx)
    out=args.output_dir/'proposed.json';out.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'state':v['state'],'ticket':TICKET,'fileSha256':file_sha(out),'planSha256':sha(v),'dynamoWrites':False,'financialWrites':False}))

if __name__=='__main__':
    try:main()
    except Exception as e:
        print(json.dumps({'state':'STOPPED_NO_RETRY','code':str(e) if isinstance(e,GuardError) else 'READ_OR_VALIDATION_FAILED','writes':False}));sys.exit(2)
