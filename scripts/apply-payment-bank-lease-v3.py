"""One explicitly reviewed administrative lease restoration, never bank repair.

Restores owner/lock only; preserves both claims, the archive and existing receipt.
There is one transaction dispatch, including on lost acknowledgement. All work
after dispatch is read-only. A new financial attempt remains unauthorized.
"""
import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('lease_v3_prepare_contract',ROOT/'scripts/prepare-payment-bank-lease-v3.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
GuardError=p.GuardError
require=p.require
WORKFLOW='.github/workflows/payment-bank-lease-v3-apply.yml'
REVIEW_RUN='41913520774'
REVIEW_COMMIT='f5ad00971e5f3d71303e7b611fa88e727e270683'
REVIEW_FILE_SHA='4714e8d9ddad8bdffefd6c9e9304c1dd89f7242fc191c0ed3ba251f9de3eaafa'
REVIEW_PLAN_SHA='2b1a0841d820e744915b9634618ef1798b60f783fadfa4a602c359ef2d2703cb'
TRANSACTION_SHA='8c90e6dffcde1c60f00665835511af9f8c4b365b4c4acd09327d8c276ea9f6f2'
PREPARE_SOURCE_PINS={
 'scripts/prepare-payment-bank-lease-v3.py':'e046591f78d10a5f6287d965ef2077b33d6e4fe779c95e38bc9b0fad3c29ec2c',
 'tests/test_payment_bank_lease_v3.py':'09865709e5552baca5902ef390b237a46b1959412cc1cfa82fc4891d585bf1e5',
 '.github/workflows/payment-bank-lease-v3-readonly.yml':'f2b87c856ab99c6defde6b1d8b46dafd979b4f06022a026df69916898fd7d630'}

def context(env=None):
    value=p.context(env);value['workflow']=WORKFLOW;return value

def validate_review(review):
    require(p.sha(review)==REVIEW_PLAN_SHA,'REVIEW_PLAN_CHANGED')
    require(review['workflow']=={'repository':p.REPOSITORY,'workflow':p.WORKFLOW,'runId':REVIEW_RUN,'commit':REVIEW_COMMIT},'REVIEW_RUN_CHANGED')
    require(review['transactionSha256']==TRANSACTION_SHA and review['codeSha256']==PREPARE_SOURCE_PINS,'REVIEW_SOURCE_OR_TRANSACTION_CHANGED')
    require(0<=(p.stamp(p.utc())-p.stamp(review['preparedUtc'])).total_seconds()<=7200,'REVIEW_TOO_OLD_OR_FUTURE')
    require(p.source_hashes()==PREPARE_SOURCE_PINS,'PREPARE_CODE_CHANGED')

def load_review(path):
    require(p.file_sha(path)==REVIEW_FILE_SHA,'REVIEW_FILE_CHANGED')
    review=p.read_json(path);validate_review(review);return review

def review_identity(value):
    result=copy.deepcopy(value);result.pop('preparedUtc',None)
    result['freshObservation'].pop('firstUtc',None);result['freshObservation'].pop('secondUtc',None)
    return result

def read_control_pass(backend,expected):
    actual={};errors={}
    try:runtime=backend.runtime()
    except Exception as error:runtime=None;errors['runtime']=type(error).__name__
    for key in p.CONTROL_KEYS:
        try:actual[key]=backend.get(key)
        except Exception as error:errors[key]=type(error).__name__
    return {'observedUtc':p.utc(),'runtimeUnchanged':runtime==p.RUNTIME,'allFiveExactlyMatched':actual==expected and not errors,
      'itemHashes':{k:p.sha(v) for k,v in actual.items()},'matched':{k:actual.get(k)==v for k,v in expected.items()},'readErrors':errors}

def execute(backend,evidence,review,ctx,authorized=False):
    require(authorized,'EXPLICIT_ADMINISTRATIVE_RESTORATION_REQUIRED')
    validate_review(review);backend.verify_review_run()
    start=time.monotonic()
    # Reuse the exact approved, frozen double financial + control observation.
    fresh=p.prepare(backend,evidence,review['workflow'])
    require(review_identity(fresh)==review_identity(review),'FRESH_REVIEW_CHANGED')
    items=p.controls(backend,evidence)
    require({k:p.sha(v) for k,v in items.items()}==review['controlItemSha256'],'CONTROL_CHANGED_BEFORE_TRANSACTION')
    tx=p.restoration_transaction(evidence,items)
    require(p.sha(tx)==TRANSACTION_SHA,'TRANSACTION_NOT_EXACT_REVIEWED_PAYLOAD')
    require(time.monotonic()-start<=60,'PREFLIGHT_EXCEEDS_60_SECONDS')
    require(0<=(p.stamp(p.utc())-p.stamp(fresh['freshObservation']['firstUtc'])).total_seconds()<=60,'FINANCIAL_OBSERVATION_STALE')
    token=str(uuid.uuid5(uuid.NAMESPACE_URL,f'https://github.com/{p.REPOSITORY}/actions/runs/{ctx["runId"]}#{REVIEW_PLAN_SHA}'))
    backend.authorize_dispatch(TRANSACTION_SHA,start+60,token)
    lost=False;dispatch_error=None
    try:backend.transact({**tx,'ClientRequestToken':token})
    except Exception as error:
        if not backend.sent:raise
        lost=True;dispatch_error=type(error).__name__
    # No state-changing action occurs after this point, even on timeout or mismatch.
    expected=copy.deepcopy(items);expected[p.ROOT_KEY]=copy.deepcopy(evidence['lease']['before'])
    first=read_control_pass(backend,expected)
    independent=None;second=None;financial=None;independent_error=None
    try:
        independent=backend.independent()
        second=read_control_pass(independent,expected)
        observed=independent.observe(True)
        p.validate_columns(observed['columns'])
        financial={'observedUtc':observed['observedUtc'],'unchanged':observed['runtime']==p.RUNTIME and
          observed['review']==evidence['review'] and observed['columns']==evidence['columns'],
          'allColumnEvidenceSha256':p.sha(observed['columns'])}
    except Exception as error:independent_error=type(error).__name__
    verified=(first['allFiveExactlyMatched'] and first['runtimeUnchanged'] and second is not None and
      second['allFiveExactlyMatched'] and second['runtimeUnchanged'] and financial is not None and financial['unchanged'] and independent_error is None)
    return {'version':1,'state':'ADMINISTRATIVE_LEASE_RESTORED' if verified else 'UNCONFIRMED_DO_NOT_RETRY','verified':bool(verified),
      'observedUtc':p.utc(),'workflow':ctx,'ticket':p.TICKET,'company':p.COMPANY,'idmov':p.IDMOV,'idlan':p.IDLAN,
      'reviewRunId':REVIEW_RUN,'reviewFileSha256':REVIEW_FILE_SHA,'reviewPlanSha256':REVIEW_PLAN_SHA,'transactionSha256':TRANSACTION_SHA,
      'clientRequestToken':token,'transactionAttempts':1,'acknowledgementLost':lost,'dispatchErrorType':dispatch_error,
      'expectedRestoredRootSha256':p.BEFORE_ROOT_SHA,'expectedControlItemHashes':{k:p.sha(v) for k,v in expected.items()},
      'freshObservation':fresh['freshObservation'],'firstReadback':first,'independentReadback':second,
      'independentFinancialReadback':financial,'independentReadErrorType':independent_error,
      'rootExactlyRestored':bool(verified),'fourPreservedItemsExactlyUnchanged':bool(verified),
      'intendedDynamoMutationCount':1,'financialWrites':False,'zeevWrites':False,'lambdaInvoked':False,
      'newReceipts':0,'claimMutations':0,'newFinancialAttemptAuthorized':False,'automaticRetryAllowed':False}

class Live(p.Live):
    def __init__(self,source_root,evidence):
        self.source_root=source_root;self.evidence=evidence;self.sent=False;self.dispatch=None
        super().__init__(source_root,evidence)

    def verify_review_run(self):
        token=os.environ.get('GH_TOKEN');require(bool(token),'GITHUB_TOKEN_MISSING')
        request=urllib.request.Request(f'https://api.github.com/repos/{p.REPOSITORY}/actions/runs/{REVIEW_RUN}',headers={
          'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'})
        with urllib.request.build_opener(p.NoRedirect()).open(request,timeout=15) as response:v=json.load(response)
        require(str(v.get('id'))==REVIEW_RUN and v.get('head_sha')==REVIEW_COMMIT and v.get('path')==p.WORKFLOW and
          v.get('repository',{}).get('full_name')==p.REPOSITORY and v.get('head_branch')==p.BRANCH and v.get('event')=='push' and
          v.get('run_attempt')==1 and v.get('status')=='completed' and v.get('conclusion')=='success','PREPARE_RUN_NOT_SUCCESSFULLY_PINNED')

    def authorize_dispatch(self,tx_sha,deadline,token):
        require(not self.sent and self.dispatch is None and tx_sha==TRANSACTION_SHA and time.monotonic()<deadline,'TRANSACTION_ALREADY_USED_OR_NOT_AUTHORIZED')
        require(str(uuid.UUID(token))==token,'CLIENT_REQUEST_TOKEN_INVALID')
        self.dispatch={'sha':tx_sha,'deadline':deadline,'token':token}

    def transact(self,payload):
        require(not self.sent and self.dispatch is not None,'ONE_TRANSACTION_ONLY')
        require(set(payload)=={'TransactItems','ClientRequestToken'} and payload['ClientRequestToken']==self.dispatch['token'] and
          p.sha({'TransactItems':payload['TransactItems']})==self.dispatch['sha'],'TRANSACTION_PAYLOAD_CHANGED')
        require(time.monotonic()<=self.dispatch['deadline'],'TRANSACTION_PREFLIGHT_EXPIRED')
        self.sent=True
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'transaction.json';path.write_text(json.dumps(payload),encoding='utf-8')
            r=subprocess.run(['aws','dynamodb','transact-write-items','--region',p.REGION,'--cli-input-json','file://'+str(path),
              '--output','json','--no-cli-pager','--cli-connect-timeout','5','--cli-read-timeout','15'],capture_output=True,text=True,timeout=25,
              env={**os.environ,'AWS_MAX_ATTEMPTS':'1','AWS_RETRY_MODE':'standard','AWS_PAGER':''})
        require(r.returncode==0,'TRANSACTION_ACK_UNCERTAIN_READ_ONLY_FROM_NOW')
        return json.loads(r.stdout or '{}')

    def independent(self):return p.Live(self.source_root,self.evidence)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--authorized-administrative-restoration',action='store_true')
    parser.add_argument('--review',type=Path,default=Path('.reviewed-v3-lease/proposed.json'))
    parser.add_argument('--evidence-dir',type=Path,default=Path('.failed-bank-v2'))
    parser.add_argument('--lease-proof',type=Path,default=Path('.failed-bank-v3-lease/lease-228007.json'))
    parser.add_argument('--source-root',type=Path,default=Path('.bank-v2-source'))
    parser.add_argument('--output-dir',type=Path,default=Path('.payment-bank-lease-v3-applied'))
    args=parser.parse_args();require(args.authorized_administrative_restoration,'AUTHORIZATION_FLAG_REQUIRED')
    ctx=context();args.output_dir.mkdir(exist_ok=False);review=load_review(args.review)
    evidence=p.load_evidence(args.evidence_dir,args.lease_proof);backend=Live(args.source_root.resolve(),evidence)
    result=execute(backend,evidence,review,ctx,True);result['applyCodeSha256']={n:p.file_sha(ROOT/n) for n in
      ('scripts/apply-payment-bank-lease-v3.py','tests/test_payment_bank_lease_v3_apply.py',WORKFLOW)}
    out=args.output_dir/'applied.json';out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'state':result['state'],'verified':result['verified'],'fileSha256':p.file_sha(out),
      'transactionAttempts':result['transactionAttempts'],'financialWrites':False,'newReceipts':0,'claimMutations':0}))
    return 0 if result['verified'] else 2

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as error:
        print(json.dumps({'state':'STOPPED_NO_RETRY','code':str(error) if isinstance(error,GuardError) else 'READ_OR_VALIDATION_FAILED','financialWrites':False}));sys.exit(2)
