"""One reviewed bank-attempt adjudication. Default PREPARE is entirely read-only.

Never saves RM, invokes Lambda, changes Zeev or deletes/changes an attempt claim.
APPLY restores only the exact original owner/lock and atomically records an
immutable NO_EFFECT_OBSERVED receipt. A future manual repair needs its own key.
All public receipt validators below are pure and import no adapter or checkout.
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
import urllib.error
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
REPOSITORY='RaizEducacaoDev/Lambda-Raiz'
BRANCH='fix/idpgto-vinculo-obrigatorio'
WORKFLOW='.github/workflows/payment-bank-no-effect.yml'
SOURCE_WORKFLOW='.github/workflows/payment-bank-repair.yml'
SOURCE_RUN='41905310017'
SOURCE_COMMIT='71bda76c539ea155320aec4f46de0679de5da4a6'
ACCOUNT='757843862365';REGION='sa-east-1'
TABLE='lambda-raiz-prod-pagamento-idpgto'
TICKET=228007;COMPANY=5;IDMOV=165611;IDLAN=634500
ROOT_KEY='prod#PG#5#228007'
OLD_ATTEMPT_KEY=ROOT_KEY+'#BANK_REPAIR_ATTEMPT'
NEXT_ATTEMPT_KEY=OLD_ATTEMPT_KEY+'#CFO_REFERENCE_V2'
LEASE_OWNER='fa7b99f2-c706-4fbf-8c1c-6f430e64c95c'
ARCHIVE_KEY=ROOT_KEY+'#BANK_REPAIR_LEASE#'+LEASE_OWNER
LEASE_SHA='b4d66348638d9b56793b1d86723e9b8aafc12e82da256625cbf6d7e163a0979e'
BEFORE_ROOT_SHA='d37dbe6017559dc039927a7d4f941dc4dffd81f632dc2b1b88c22839ac998850'
LEASED_ROOT_SHA='4ed5e68cb130525a4f888a9f6b4aa9b2cd3cb6f5eadeb70b2e63567181db4ceb'
PLAN_SHA='4ae883e984db6a7df3b26e1c8d8265dd9aaa39426af1f32ec11de90c5f57a0be'
UNCHANGED_EVIDENCE_SHA='29adc8573bb2debff45aa16f2ea7725d24a44edcb235cc2f77d62921a7e78efb'
SOURCE_RUNTIME={'codeSha256':'U8MIHNjNZ2iEeyt02SWx4q5TztrmrcpehRqBlf86OY8=',
                'revisionId':'d6c03245-d62e-4ef2-834b-22dbada25c1b'}
CURRENT_RUNTIME={'codeSha256':'ECffjgl6BpvRQrtHh3+O++D7/SAvTGAe8r9XTJqJIKE=',
                 'revisionId':'29524d8b-327d-4389-a7ed-cab0b04aae2e'}
CURRENT_REVIEW_SHA='e9f1ade8ad4b08162eab3a52b591791970dc48f1e7eb91bb663e334f082be91c'
RUNTIME_PROVENANCE={'runId':'41908274896','commit':'6e86df16ed9873b18f337228ff77da680eb7d497',
  'workflow':'.github/workflows/remove-uncertain-creation-release.yml',
  'branch':'fix/remove-uncertain-creation-20261104',
  'filesSha256':{'deployment.json':'687fb95a633603e3d03f9444f403070a94226cd5f497eb7fdb01a6ea25d50096',
    'independent-readback.json':'069cd750b75b71e2b3ee475a01cd7786c55aba857b099988a39c05ef0fed72fd',
    'monitor.json':'0bb2deeebd963ca00af820cfe96f5cb9c38f0b333595fa1332d11e16a443d8a2'},
  'outsideModulesSha256':'SVKPgvGAAbP/SW47HPxnvi74+ZarjrSFK91M531sjKM=',
  'modules':{'src/functions/rm/post/pagamentoV2Idempotencia.ts':'o4ItJOqL46PbgG9UtDYEztG3KA2xgY6ZNflf3Gzf2iI=',
    'src/functions/rm/post/solicitacaoDePagamentoSeguro.ts':'8nLAesvrYu5c+VjipPVystLhQexypizf9atcJ9ukcWs='}}
FILE_PINS={
 'summary.json':'806b3bb05b51782b3d68d02f178b223b400d4d6ffcabce13b26b02eb54e0b9b3',
 'failure-228007.json':'ee6b5897e8580d979cb3b7e776c2314f3655aee9867ec463b2b0c5114324ffec',
 'ticket-228007/before-228007.json':'b59ab0cdc56753f10950279bca968df5d0e9f0bb72ad3f9b5e66d58ddac8a9de',
 'ticket-228007/after-same-session-228007.json':'e551dab20a09e0eb749fcf9743e93ad186b6fc22cf52cf3ea7410e888b21850d',
 'ticket-228007/after-independent-228007.json':'cbe695b369ab7af2109e71dc6b6237173e57bf433b76abd4ae0b1fffdcd727e2',
 'ticket-228007/attempt-228007.json':'bfa21fb462eabdf82d4d93804a947d04a9a74107fa42c4fec7e86bee4dcd48c3',
 'ticket-228007/readback-checks-228007.json':'b0cde486d630c8ad79a7dbd428efb26d5b5c8d35d0c706cbf796107db8cc90d7',
}
HEX=r'[a-f0-9]{64}'
UUID=r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}'
CLAIM_KEYS={'pk','nonce','ticket','company','idlan','leaseOwner','planSha256','targetFieldsSha256','state','observedUtc'}
RECEIPT_KEYS={'pk','version','state','ticket','company','idmov','idlan','oldClaimSha256','nextAttemptKey',
              'proofJson','proofSha256','confirmedUtc','confirmedByRun','automaticRetryAllowed'}


class GuardError(Exception): pass


def require(ok,code):
    if not ok: raise GuardError(code)


def canonical(value): return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
def sha(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def file_sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def utc(): return dt.datetime.now(dt.timezone.utc).isoformat()
def read_json(path): return json.loads(path.read_text(encoding='utf-8-sig'))


def stamp(value):
    try:
        parsed=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
        require(parsed.tzinfo is not None,'CLOCK_ZONE_MISSING')
        return parsed
    except (ValueError,TypeError,AttributeError): raise GuardError('CLOCK_INVALID') from None


def validate_old_claim(claim):
    require(isinstance(claim,dict) and set(claim)==CLAIM_KEYS,'OLD_CLAIM_SCHEMA_CHANGED')
    expected={'pk':{'S':OLD_ATTEMPT_KEY},'ticket':{'N':str(TICKET)},'company':{'N':str(COMPANY)},
      'idlan':{'N':str(IDLAN)},'leaseOwner':{'S':LEASE_OWNER},'planSha256':{'S':PLAN_SHA},
      'targetFieldsSha256':{'S':sha({'CODCOLPGTO':'5','IDPGTO':'1'})},'state':{'S':'CLAIMED_NO_AUTOMATIC_RETRY'}}
    require(all(claim.get(k)==v for k,v in expected.items()),'OLD_CLAIM_NOT_EXACT_ATTEMPT')
    require(set(claim['nonce'])=={'S'} and re.fullmatch(UUID,claim['nonce']['S']),'OLD_CLAIM_NONCE_INVALID')
    require(set(claim['observedUtc'])=={'S'} and
      stamp('2026-11-04T20:21:52.953144+00:00')<=stamp(claim['observedUtc']['S'])<=stamp('2026-11-04T20:22:20.685091+00:00'),'OLD_CLAIM_TIME_MISMATCH')
    return sha(claim)


def receipt_key(old_claim): return ROOT_KEY+'#BANK_REPAIR_NO_EFFECT#'+validate_old_claim(old_claim)


def receipt_proof(old_claim):
    return {'version':1,'outcome':'NO_EFFECT_OBSERVED','sourceRunId':SOURCE_RUN,'sourceCommit':SOURCE_COMMIT,
      'sourceWorkflow':SOURCE_WORKFLOW,'sourceFilesSha256':copy.deepcopy(FILE_PINS),'leaseProofSha256':LEASE_SHA,
      'sourcePlanSha256':PLAN_SHA,'oldClaimSha256':validate_old_claim(old_claim),'originalRootSha256':BEFORE_ROOT_SHA,
      'leasedRootSha256':LEASED_ROOT_SHA,'sourceRuntime':dict(SOURCE_RUNTIME),'currentRuntime':dict(CURRENT_RUNTIME),
      'runtimePublication':copy.deepcopy(RUNTIME_PROVENANCE),'currentReviewSha256':CURRENT_REVIEW_SHA,
      'onlyAcceptedReviewDifference':'baseline.remoteSources.runtime','noEffectObserved':True,'allColumnsUnchanged':True,
      'observationHashes':{name:UNCHANGED_EVIDENCE_SHA for name in ('before','sameSessionAfter','independentAfter','freshFirst','freshSecond')},
      'columnCounts':{'sqlMovement':276,'sqlLaunch':271,'nativeLaunch':146},
      'formBankSourceAndPaymentUnchanged':True,'oldClaimPreservedExactly':True,'originalRootRestoredExactly':True,
      'financialWrites':False,'zeevWrites':False,'lambdaInvoked':False,'historicalRollbackProven':False,
      'nextManualAttemptKey':NEXT_ATTEMPT_KEY,'automaticRetryAllowed':False}


def make_receipt(old_claim,confirmed_utc,run_url):
    proof=receipt_proof(old_claim)
    return {'pk':{'S':receipt_key(old_claim)},'version':{'N':'1'},'state':{'S':'NO_EFFECT_OBSERVED'},
      'ticket':{'N':str(TICKET)},'company':{'N':str(COMPANY)},'idmov':{'N':str(IDMOV)},'idlan':{'N':str(IDLAN)},
      'oldClaimSha256':{'S':validate_old_claim(old_claim)},'nextAttemptKey':{'S':NEXT_ATTEMPT_KEY},
      'proofJson':{'S':canonical(proof)},'proofSha256':{'S':sha(proof)},
      'confirmedUtc':{'S':confirmed_utc},'confirmedByRun':{'S':run_url},'automaticRetryAllowed':{'BOOL':False}}


def validate_manual_retry_receipt(receipt,old_claim):
    """Pure validation; caller must independently read both items consistently.

    This proves only the fixed receipt contract. It never permits auto-retry,
    skips fresh business validation, acquires a lease, or creates a new claim.
    """
    validate_old_claim(old_claim)
    require(isinstance(receipt,dict) and set(receipt)==RECEIPT_KEYS,'NO_EFFECT_RECEIPT_SCHEMA_INVALID')
    when=receipt.get('confirmedUtc',{});run=receipt.get('confirmedByRun',{})
    require(set(when)==set(run)=={'S'},'RECEIPT_CONFIRMATION_INVALID')
    require(stamp(when['S'])>=stamp('2026-11-04T20:22:46.130954+00:00'),'RECEIPT_PREDATES_ATTEMPT')
    require(re.fullmatch(r'https://github\.com/'+re.escape(REPOSITORY)+r'/actions/runs/[1-9]\d*',run['S']) and
      not run['S'].endswith('/'+SOURCE_RUN),'RECEIPT_ADJUDICATION_RUN_INVALID')
    require(receipt==make_receipt(old_claim,when['S'],run['S']),'NO_EFFECT_RECEIPT_CONTENT_CHANGED')
    return {'receiptKey':receipt_key(old_claim),'oldClaimSha256':sha(old_claim),'nextAttemptKey':NEXT_ATTEMPT_KEY,
      'automaticRetryAllowed':False,'freshValidationAndExplicitAuthorizationRequired':True}


def load_evidence(evidence_dir,lease_path):
    require(file_sha(lease_path)==LEASE_SHA,'LEASE_ARTIFACT_PIN_MISMATCH')
    files={}
    for name,digest in FILE_PINS.items():
        path=evidence_dir/name;require(file_sha(path)==digest,'SOURCE_ARTIFACT_PIN_MISMATCH');files[name]=read_json(path)
    lease=read_json(lease_path)
    require(set(lease)=={'version','ticket','company','idmov','idlan','owner','expiresAtEpoch','conditionMatched',
      'rootBusinessUnchanged','workflowRunUrl','observedUtc','archiveKey','before','leasedRoot','acknowledgementLost'},'LEASE_SCHEMA_CHANGED')
    require((lease['version'],lease['ticket'],lease['company'],lease['idmov'],lease['idlan'])==(1,TICKET,COMPANY,IDMOV,IDLAN) and
      lease['owner']==LEASE_OWNER and lease['archiveKey']==ARCHIVE_KEY and lease['conditionMatched'] is True and
      lease['rootBusinessUnchanged'] is True and lease['workflowRunUrl']==f'https://github.com/{REPOSITORY}/actions/runs/{SOURCE_RUN}',
      'LEASE_TARGET_OR_SOURCE_CHANGED')
    require(sha(lease['before'])==BEFORE_ROOT_SHA and sha(lease['leasedRoot'])==LEASED_ROOT_SHA,'LEASE_ROOT_SNAPSHOTS_CHANGED')
    require({k:v for k,v in lease['before'].items() if k not in ('owner','lockUntil')}==
      {k:v for k,v in lease['leasedRoot'].items() if k not in ('owner','lockUntil')},'LEASE_BUSINESS_CHANGED')
    summary=files['summary.json'];before=files['ticket-228007/before-228007.json']
    require(summary['workflow']=={'repository':REPOSITORY,'branch':BRANCH,'workflow':SOURCE_WORKFLOW,'runId':SOURCE_RUN,'commit':SOURCE_COMMIT} and
      summary['mode']=='apply' and summary['requestedTickets']==[TICKET] and summary['runtime']==SOURCE_RUNTIME and
      summary['allVerified'] is False and summary['zeevWrites'] is False and summary['lambdaInvoked'] is False and
      summary['financialDocumentCreations'] is False and summary['automaticRetry'] is False,'SOURCE_RUN_SUMMARY_CHANGED')
    attempt=files['ticket-228007/attempt-228007.json'];checks=files['ticket-228007/readback-checks-228007.json']
    require(attempt['ticket']==TICKET and attempt['state']=='OUTCOME_UNCERTAIN_NO_RETRY' and attempt['errorCode']=='SAVE_RESPONSE_NOT_EXACT_KEY' and
      attempt['reviewSha256']==PLAN_SHA and attempt['retryAllowed'] is False,'ATTEMPT_FAILURE_NOT_EXPECTED')
    require(checks=={'checks':[{'mode':mode,'valid':False,'errorType':'GuardError','code':'AFTER_BANK_INCORRECT'} for mode in ('same-session','independent')],
      'saveErrorType':None,'responseExactKey':False},'SOURCE_READBACK_FAILURE_CHANGED')
    require(before['leaseOwner']==LEASE_OWNER and sha(before['review'])==PLAN_SHA,'ORIGINAL_REVIEW_CHANGED')
    evidence=before['allColumnEvidence'];validate_column_evidence(evidence)
    previous=stamp(before['observedUtc'])
    for label in ('same-session','independent'):
        after=files[f'ticket-228007/after-{label}-228007.json']
        require(after['allColumnEvidence']==evidence and after['paymentFields']==before['review']['before'],'ORIGINAL_EFFECT_NOT_UNCHANGED')
        require(previous<=stamp(after['observedUtc'])<=stamp(attempt['observedUtc']),'ORIGINAL_READBACK_TIMELINE_INVALID')
        previous=stamp(after['observedUtc'])
    archive={'pk':{'S':ARCHIVE_KEY},'original':{'M':lease['before']},'leaseOwner':lease['leasedRoot']['owner'],'leaseUntil':lease['leasedRoot']['lockUntil']}
    return {'lease':lease,'archive':archive,'review':before['review'],'columnEvidence':evidence,'sourceHashes':summary['codeSha256']}


def expected_current_review(original):
    """Accept exactly the independently verified runtime publication, no rebase."""
    require(original.get('baseline',{}).get('remoteSources',{}).get('runtime')==SOURCE_RUNTIME,'ORIGINAL_REVIEW_RUNTIME_CHANGED')
    current=copy.deepcopy(original)
    current['baseline']['remoteSources']['runtime']=dict(CURRENT_RUNTIME)
    return current


def load_runtime_provenance(release_dir,independent_dir):
    values={}
    for name,digest in RUNTIME_PROVENANCE['filesSha256'].items():
        path=(release_dir if name=='deployment.json' else independent_dir)/name
        require(file_sha(path)==digest,'RUNTIME_PUBLICATION_ARTIFACT_CHANGED');values[name]=read_json(path)
    deployment=values['deployment.json'];independent=values['independent-readback.json'];monitor=values['monitor.json']
    require(deployment.get('previousCodeSha256')==SOURCE_RUNTIME['codeSha256'] and deployment.get('commit')==RUNTIME_PROVENANCE['commit'] and
      deployment.get('configurationPreserved') is True and deployment.get('onlyChangedEntry')=='src/functions/rm/post/solicitacaoDePagamento.js' and
      deployment.get('outsideModulesSha256')==RUNTIME_PROVENANCE['outsideModulesSha256'] and deployment.get('modules')==RUNTIME_PROVENANCE['modules'] and
      all(deployment.get(k) is False for k in ('ticketRetriesPerformed','financialWrites','dynamoWrites','zeevWrites')),'RUNTIME_PUBLICATION_NOT_SCOPED')
    for document in (deployment,independent,monitor):
        require(document.get('function')=='lambda-raiz-prod-solicitacaoDePagamento' and
          {'codeSha256':document.get('activeCodeSha256'),'revisionId':document.get('revisionId')}==CURRENT_RUNTIME,'RUNTIME_PUBLICATION_PIN_MISMATCH')
    require(all(document.get('packageIndependentlyVerified') is True and document.get('allEntryHashesConfirmed') is True and
      document.get('ticketRetriesPerformed') is False for document in (independent,monitor)),'RUNTIME_INDEPENDENT_VERIFICATION_MISSING')
    require(stamp(deployment['deployedUtc'])<=stamp(independent['observedUtc'])<=stamp(monitor['observedUtc']) and
      monitor.get('monitorSeconds',0)>=300 and monitor.get('lambdaExecutionErrors')==0,'RUNTIME_MONITOR_NOT_VERIFIED')
    return copy.deepcopy(RUNTIME_PROVENANCE)


def validate_column_evidence(evidence):
    require(isinstance(evidence,dict) and set(evidence)=={'formDigest','bankRecordHash','sqlMovementColumnHashes','sqlLaunchColumnHashes','nativeLaunchColumnHashes','paymentLinkHash'},'ALL_COLUMN_EVIDENCE_SCHEMA_INVALID')
    for key,count in [('sqlMovementColumnHashes',276),('sqlLaunchColumnHashes',271),('nativeLaunchColumnHashes',146)]:
        require(isinstance(evidence[key],dict) and len(evidence[key])==count and all(re.fullmatch(HEX,v) for v in evidence[key].values()),'ALL_COLUMNS_REQUIRED')
    require(sha(evidence)==UNCHANGED_EVIDENCE_SHA,'FINANCIAL_OR_FORM_EFFECT_FOUND')


def full_match(item):
    names={};values={};conditions=[]
    for index,(key,value) in enumerate(sorted(item.items())):
        names[f'#a{index}']=key;values[f':a{index}']=copy.deepcopy(value);conditions.append(f'#a{index} = :a{index}')
    for key in ('pg','protocolVersion','recuperadaCriacaoIncerta','reconciliationEvidenceKey'):
        if key not in item:
            token=f'#missing{len(names)}';names[token]=key;conditions.append(f'attribute_not_exists({token})')
    return {'ConditionExpression':' AND '.join(conditions),'ExpressionAttributeNames':names,'ExpressionAttributeValues':values}


def transaction(evidence,claim,receipt):
    validate_manual_retry_receipt(receipt,claim)
    lease=evidence['lease'];root=full_match(lease['leasedRoot'])
    root['ExpressionAttributeNames']['#restoreOwner']='owner'
    root['ExpressionAttributeValues'].update({':restoreOwner':lease['before']['owner'],':restoreLock':lease['before']['lockUntil']})
    root.update(TableName=TABLE,Key={'pk':{'S':ROOT_KEY}},UpdateExpression='SET #restoreOwner = :restoreOwner, lockUntil = :restoreLock')
    def check(item): return {'ConditionCheck':{'TableName':TABLE,'Key':{'pk':item['pk']},**full_match(item)}}
    return {'TransactItems':[check(claim),check(evidence['archive']),{'Update':root},
      {'Put':{'TableName':TABLE,'Item':receipt,'ConditionExpression':'attribute_not_exists(pk)'}},
      {'ConditionCheck':{'TableName':TABLE,'Key':{'pk':{'S':NEXT_ATTEMPT_KEY}},'ConditionExpression':'attribute_not_exists(pk)'}}]}


def source_hashes():
    return {name:file_sha(ROOT/name) for name in ('scripts/adjudicate-payment-bank-no-effect.py',
      'tests/test_payment_bank_no_effect.py',WORKFLOW)}


def context(env=None):
    env=os.environ if env is None else env
    require(env.get('GITHUB_ACTIONS')=='true' and env.get('GITHUB_EVENT_NAME')=='push' and env.get('GITHUB_RUN_ATTEMPT')=='1' and
      env.get('GITHUB_REPOSITORY')==REPOSITORY and env.get('GITHUB_REF')=='refs/heads/'+BRANCH,'WORKFLOW_CONTEXT_REJECTED')
    require(re.fullmatch(r'[1-9]\d*',env.get('GITHUB_RUN_ID','')) and re.fullmatch(r'[a-f0-9]{40}',env.get('GITHUB_SHA','')),'WORKFLOW_IDENTITY_INVALID')
    return {'repository':REPOSITORY,'workflow':WORKFLOW,'runId':env['GITHUB_RUN_ID'],'commit':env['GITHUB_SHA']}


def observe_unchanged(backend,evidence):
    start=time.monotonic();first=backend.observe(False);second=backend.observe(True)
    expected=expected_current_review(evidence['review'])
    for value in (first,second):
        require(value['runtime']==CURRENT_RUNTIME and value['review']==expected,'LIVE_REVIEW_FORM_BANK_SOURCE_OR_RUNTIME_CHANGED')
        validate_column_evidence(value['columnEvidence'])
        require(value['columnEvidence']==evidence['columnEvidence'],'LIVE_ALL_COLUMN_EVIDENCE_CHANGED')
    require(time.monotonic()-start<=60,'FRESH_OBSERVATIONS_EXCEEDED_60_SECONDS')
    return start,{'firstUtc':first['observedUtc'],'secondUtc':second['observedUtc'],'allColumnsSha256':UNCHANGED_EVIDENCE_SHA,
      'sourceReviewSha256':PLAN_SHA,'currentReviewSha256':CURRENT_REVIEW_SHA,'runtime':dict(CURRENT_RUNTIME)}


def control_read(backend,evidence,expected_claim_sha=None):
    require(backend.runtime()==CURRENT_RUNTIME,'CURRENT_RUNTIME_CHANGED')
    claim=backend.get(OLD_ATTEMPT_KEY);digest=validate_old_claim(claim)
    require(expected_claim_sha is None or digest==expected_claim_sha,'CLAIM_CHANGED_SINCE_REVIEW')
    require(backend.get(ARCHIVE_KEY)==evidence['archive'],'ORIGINAL_LEASE_ARCHIVE_CHANGED')
    require(backend.get(ROOT_KEY)==evidence['lease']['leasedRoot'],'ROOT_NO_LONGER_EXACT_LEASE2')
    require(backend.get(receipt_key(claim))=={} and backend.get(NEXT_ATTEMPT_KEY)=={},'RECEIPT_OR_NEXT_ATTEMPT_ALREADY_EXISTS_NO_RETRY')
    return claim


def prepare(backend,evidence,ctx):
    claim=control_read(backend,evidence)
    started,observation=observe_unchanged(backend,evidence)
    require(control_read(backend,evidence,sha(claim))==claim,'CLAIM_CHANGED_DURING_OBSERVATION')
    require(time.monotonic()-started<=60,'EVIDENCE_STALE_BEFORE_PREPARE')
    plan={'version':1,'mode':'PREPARE','ticket':TICKET,'company':COMPANY,'idmov':IDMOV,'idlan':IDLAN,
      'preparedUtc':utc(),'workflow':ctx,'codeSha256':source_hashes(),'sourceRunId':SOURCE_RUN,'sourceCommit':SOURCE_COMMIT,
      'sourceFilesSha256':FILE_PINS,'leaseProofSha256':LEASE_SHA,'runtime':dict(CURRENT_RUNTIME),
      'sourceRuntime':dict(SOURCE_RUNTIME),'runtimePublication':copy.deepcopy(RUNTIME_PROVENANCE),
      'oldClaimSha256':sha(claim),'archiveSha256':sha(evidence['archive']),'leasedRootSha256':LEASED_ROOT_SHA,
      'restoreRootSha256':BEFORE_ROOT_SHA,'observation':observation,'proposedReceiptProof':receipt_proof(claim),
      'receiptKey':receipt_key(claim),'nextAttemptKey':NEXT_ATTEMPT_KEY,'automaticRetryAllowed':False,
      'financialWrites':False,'dynamoWrites':False,'zeevWrites':False,'lambdaInvoked':False}
    return plan


def apply(backend,evidence,plan,expected_sha,ctx,authorized=False):
    require(authorized,'EXPLICIT_ADJUDICATION_AUTHORIZATION_REQUIRED')
    require(sha(plan)==expected_sha and plan.get('version')==1 and plan.get('mode')=='PREPARE','REVIEWED_PLAN_HASH_INVALID')
    require(plan.get('codeSha256')==source_hashes(),'ADJUDICATION_CODE_CHANGED')
    require((plan.get('ticket'),plan.get('company'),plan.get('idmov'),plan.get('idlan'))==(TICKET,COMPANY,IDMOV,IDLAN) and
      all(plan.get(key) is False for key in ('automaticRetryAllowed','financialWrites','dynamoWrites','zeevWrites','lambdaInvoked')),
      'REVIEWED_PLAN_SCOPE_OR_AUTHORIZATION_CHANGED')
    require(-2<=(dt.datetime.now(dt.timezone.utc)-stamp(plan['preparedUtc'])).total_seconds()<=7200,'PREPARE_REVIEW_TOO_OLD')
    claim=control_read(backend,evidence,plan.get('oldClaimSha256'))
    require(plan.get('sourceRunId')==SOURCE_RUN and plan.get('sourceCommit')==SOURCE_COMMIT and plan.get('sourceFilesSha256')==FILE_PINS and
      plan.get('leaseProofSha256')==LEASE_SHA and plan.get('runtime')==CURRENT_RUNTIME and plan.get('sourceRuntime')==SOURCE_RUNTIME and
      plan.get('runtimePublication')==RUNTIME_PROVENANCE and plan.get('proposedReceiptProof')==receipt_proof(claim) and
      plan.get('receiptKey')==receipt_key(claim) and plan.get('nextAttemptKey')==NEXT_ATTEMPT_KEY and
      plan.get('archiveSha256')==sha(evidence['archive']) and plan.get('leasedRootSha256')==LEASED_ROOT_SHA and plan.get('restoreRootSha256')==BEFORE_ROOT_SHA,'REVIEWED_PLAN_CONTENT_CHANGED')
    backend.verify_prepare_run(plan['workflow'])
    started,observed=observe_unchanged(backend,evidence)
    require(control_read(backend,evidence,sha(claim))==claim,'FINAL_CONTROL_CHANGED')
    require(time.monotonic()-started<=60,'EVIDENCE_STALE_BEFORE_TRANSACTION')
    receipt=make_receipt(claim,utc(),f'https://github.com/{REPOSITORY}/actions/runs/{ctx["runId"]}')
    payload=transaction(evidence,claim,receipt);lost=False
    try: backend.transact(payload)
    except Exception: lost=True
    after={key:backend.get(key) for key in (ROOT_KEY,OLD_ATTEMPT_KEY,ARCHIVE_KEY,receipt_key(claim),NEXT_ATTEMPT_KEY)}
    exact=(after[ROOT_KEY]==evidence['lease']['before'] and after[OLD_ATTEMPT_KEY]==claim and
      after[ARCHIVE_KEY]==evidence['archive'] and after[receipt_key(claim)]==receipt and after[NEXT_ATTEMPT_KEY]=={})
    if exact:validate_manual_retry_receipt(after[receipt_key(claim)],after[OLD_ATTEMPT_KEY])
    return {'version':1,'ticket':TICKET,'state':'NO_EFFECT_OBSERVED_AND_LEASE_RESTORED' if exact else 'UNCONFIRMED_DO_NOT_RETRY',
      'verified':exact,'acknowledgementLost':lost,'receiptKey':receipt_key(claim),'receiptSha256':sha(receipt),
      'claimPreservedExactly':after[OLD_ATTEMPT_KEY]==claim,'archivePreservedExactly':after[ARCHIVE_KEY]==evidence['archive'],
      'rootRestoredExactly':after[ROOT_KEY]==evidence['lease']['before'],'freshObservation':observed,'automaticRetryAllowed':False,
      'financialWrites':False,'zeevWrites':False,'lambdaInvoked':False,'transactionAttempts':1}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): raise GuardError('HTTP_REDIRECT_REJECTED')


class Live:
    def __init__(self,source_root,evidence,apply_enabled=False):
        self.apply_enabled=apply_enabled;self.sent=False;self.source_root=source_root
        head=subprocess.run(['git','rev-parse','HEAD'],cwd=source_root,text=True,capture_output=True,check=True).stdout.strip()
        require(head==SOURCE_COMMIT,'FROZEN_SOURCE_COMMIT_MISMATCH')
        for name,digest in evidence['sourceHashes'].items():
            require(file_sha(source_root/name)==digest,'FROZEN_SOURCE_FILE_MISMATCH')
        path=source_root/'scripts/repair-payment-bank-backlog.py'
        spec=importlib.util.spec_from_file_location('no_effect_frozen_bank',path);module=importlib.util.module_from_spec(spec)
        sys.modules[spec.name]=module;spec.loader.exec_module(module);self.operator=module
        class ReadOnlyAdapter(module.RemoteLiveAdapter):
            def save(self,*args,**kwargs): raise GuardError('FINANCIAL_WRITE_FORBIDDEN')
            def native_save_http(self,*args,**kwargs): raise GuardError('FINANCIAL_WRITE_FORBIDDEN')
            def claim_dispatch(self,*args,**kwargs): raise GuardError('CLAIM_WRITE_FORBIDDEN')
        self.adapter=ReadOnlyAdapter(TICKET)
        self.verify_source_run()
        self.verify_runtime_publication_run()

    def github_run(self,run_id):
        token=os.environ.get('GH_TOKEN');require(bool(token),'GITHUB_READ_TOKEN_MISSING')
        request=urllib.request.Request(f'https://api.github.com/repos/{REPOSITORY}/actions/runs/{run_id}',headers={
          'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
        try:
            with urllib.request.build_opener(NoRedirect()).open(request,timeout=15) as response: result=json.load(response)
        except (urllib.error.URLError,TimeoutError): raise GuardError('GITHUB_SOURCE_READ_FAILED') from None
        return result

    def verify_source_run(self):
        result=self.github_run(SOURCE_RUN)
        require(str(result.get('id'))==SOURCE_RUN and result.get('head_sha')==SOURCE_COMMIT and result.get('path')==SOURCE_WORKFLOW and
          result.get('repository',{}).get('full_name')==REPOSITORY and result.get('head_branch')==BRANCH and
          result.get('event')=='push' and result.get('run_attempt')==1 and result.get('status')=='completed' and result.get('conclusion')=='failure','FAILED_SOURCE_RUN_NOT_PINNED')

    def verify_prepare_run(self,workflow):
        require(isinstance(workflow,dict) and workflow.get('repository')==REPOSITORY and workflow.get('workflow')==WORKFLOW,'PREPARE_PROVENANCE_INVALID')
        result=self.github_run(workflow.get('runId'))
        require(str(result.get('id'))==workflow.get('runId') and result.get('head_sha')==workflow.get('commit') and result.get('path')==WORKFLOW and
          result.get('head_branch')==BRANCH and result.get('event')=='push' and result.get('run_attempt')==1 and
          result.get('status')=='completed' and result.get('conclusion')=='success','PREPARE_RUN_NOT_SUCCESSFUL')

    def verify_runtime_publication_run(self):
        result=self.github_run(RUNTIME_PROVENANCE['runId'])
        require(str(result.get('id'))==RUNTIME_PROVENANCE['runId'] and result.get('head_sha')==RUNTIME_PROVENANCE['commit'] and
          result.get('path')==RUNTIME_PROVENANCE['workflow'] and result.get('head_branch')==RUNTIME_PROVENANCE['branch'] and
          result.get('repository',{}).get('full_name')==REPOSITORY and result.get('event')=='push' and result.get('run_attempt')==1 and
          result.get('status')=='completed' and result.get('conclusion')=='success','RUNTIME_PUBLICATION_RUN_NOT_VERIFIED')

    def aws(self,operation,payload):
        require(operation=='get-item' or self.apply_enabled and operation=='transact-write-items','AWS_OPERATION_FORBIDDEN')
        if operation=='get-item':
            require(payload.get('TableName')==TABLE and payload.get('ConsistentRead') is True,'AWS_READ_NOT_CONSISTENT')
        with tempfile.TemporaryDirectory(prefix='bank-no-effect-') as directory:
            path=Path(directory)/'input.json';path.write_text(json.dumps(payload),encoding='utf-8')
            process=subprocess.run(['aws','dynamodb',operation,'--region',REGION,'--cli-input-json','file://'+str(path),
              '--output','json','--no-cli-pager','--cli-connect-timeout','5','--cli-read-timeout','15'],capture_output=True,text=True,timeout=25,
              env={**os.environ,'AWS_MAX_ATTEMPTS':'1','AWS_RETRY_MODE':'standard','AWS_PAGER':''})
        require(process.returncode==0,'AWS_CALL_FAILED_NO_RETRY');return json.loads(process.stdout or '{}')

    def get(self,key):
        require(key in (ROOT_KEY,OLD_ATTEMPT_KEY,ARCHIVE_KEY,NEXT_ATTEMPT_KEY) or re.fullmatch(re.escape(ROOT_KEY)+r'#BANK_REPAIR_NO_EFFECT#[a-f0-9]{64}',key),'AWS_KEY_NOT_ALLOWLISTED')
        return self.aws('get-item',{'TableName':TABLE,'ConsistentRead':True,'Key':{'pk':{'S':key}}}).get('Item',{})

    def runtime(self):
        require(self.adapter.aws('sts','get-caller-identity')['Account']==ACCOUNT,'AWS_ACCOUNT_MISMATCH')
        runtime=self.adapter.config();require(runtime==CURRENT_RUNTIME,'RUNTIME_PIN_MISMATCH');return runtime

    def observe(self,independent):
        snapshot=self.adapter.read(TICKET,independent=independent)
        return {'observedUtc':utc(),'runtime':snapshot['remoteSources']['runtime'],
          'review':self.operator.review(snapshot,TICKET),'columnEvidence':self.operator.audit_snapshot(snapshot)}

    def transact(self,payload):
        require(self.apply_enabled and not self.sent,'TRANSACTION_ALREADY_ATTEMPTED_OR_NOT_AUTHORIZED')
        self.sent=True
        return self.aws('transact-write-items',payload)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir',type=Path,default=Path('.failed-bank-attempt'))
    parser.add_argument('--lease-proof',type=Path,default=Path('.failed-bank-lease/lease-228007.json'))
    parser.add_argument('--source-root',type=Path,default=Path('.bank-original-code'))
    parser.add_argument('--runtime-release-dir',type=Path,default=Path('.verified-runtime-release'))
    parser.add_argument('--runtime-independent-dir',type=Path,default=Path('.verified-runtime-independent'))
    parser.add_argument('--output-dir',type=Path,default=Path('.payment-bank-no-effect'))
    parser.add_argument('--apply',action='store_true');parser.add_argument('--authorized-no-effect-adjudication',action='store_true')
    parser.add_argument('--review',type=Path);parser.add_argument('--expect-plan-sha')
    args=parser.parse_args();ctx=context();args.output_dir.mkdir(exist_ok=False)
    require(not args.apply or args.authorized_no_effect_adjudication and args.review and args.expect_plan_sha,'EXPLICIT_REVIEWED_APPLY_REQUIRED')
    evidence=load_evidence(args.evidence_dir,args.lease_proof)
    load_runtime_provenance(args.runtime_release_dir,args.runtime_independent_dir)
    require(sha(expected_current_review(evidence['review']))==CURRENT_REVIEW_SHA,'RUNTIME_ONLY_REVIEW_SUBSTITUTION_CHANGED')
    backend=Live(args.source_root.resolve(),evidence,args.apply)
    if args.apply:result=apply(backend,evidence,read_json(args.review),args.expect_plan_sha,ctx,True)
    else:result=prepare(backend,evidence,ctx)
    path=args.output_dir/('applied.json' if args.apply else 'proposed.json')
    path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'ticket':TICKET,'mode':'APPLY' if args.apply else 'PREPARE','state':result.get('state','READY_FOR_ROOT_REVIEW'),
      'file':path.name,'fileSha256':file_sha(path),'planSha256':sha(result),'dynamoWrites':args.apply,'financialWrites':False,'automaticRetry':False}))
    return 0 if not args.apply or result['verified'] else 2


if __name__=='__main__':
    try: raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'state':'STOPPED_NO_RETRY','code':str(error) if isinstance(error,GuardError) else 'READ_OR_VALIDATION_FAILED','financialWrites':False}));raise SystemExit(2)
