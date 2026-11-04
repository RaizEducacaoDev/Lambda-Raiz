"""Prepare/read-only by default; exact reviewed artifact gates one scoped CAS.

Never invokes Lambda or writes Zeev/RM. All business observations and mutation
fencing remain in the reviewed observer/operator; this runner only orchestrates.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
BRANCH='fix/idpgto-vinculo-obrigatorio'
WORKFLOW='.github/workflows/payment-backlog-recovery.yml'
AUDIT_RUN='41892943724'
AUDIT_PATH=Path('.payment-bulk-readonly/readback.json')
OUT=Path('.payment-backlog-recovery')
APPROVED=Path('.approved-payment-backlog-recovery')
CONFIG=ROOT/'.github/payment-backlog-recovery.json'
OBSERVER=ROOT/'scripts/observe-payment-backlog.py'
TARGETS={
  225136:{'company':1,'action':'RESERVE_NEW','historicalIdentity':{
    'company':'1','branch':'1','supplierCompany':'0','supplier':'0000157430','movementType':'1.2.03',
    'number':'000000018','series':'1','documentType':'002','issueDate':'2026-10-23','entryDate':'2026-10-23','total':'20000.00'}},
  225573:{'company':2,'action':'RESERVE_NEW','historicalIdentity':{
    'company':'2','branch':'6','supplierCompany':'0','supplier':'0000156422','movementType':'1.2.01',
    'number':'000006925','series':'1','documentType':'055','issueDate':'2026-10-10','entryDate':'2026-10-26','total':'870.71'}},
  226925:{'company':18,'action':'ADOPT_EXISTING','idMov':407691},
  228007:{'company':5,'action':'ADOPT_EXISTING','idMov':165611},
  227386:{'company':18,'action':'ADOPT_EXISTING','idMov':407685},
  226610:{'company':25,'action':'ADOPT_EXISTING','idMov':42677},
  228103:{'company':8,'action':'ADOPT_EXISTING','idMov':565011},
  228158:{'company':8,'action':'ADOPT_EXISTING','idMov':565012},
  228198:{'company':8,'action':'ADOPT_EXISTING','idMov':565013},
  228275:{'company':8,'action':'ADOPT_EXISTING','idMov':565014},
  228793:{'company':2,'action':'ADOPT_EXISTING','idMov':278473},
  223885:{'company':26,'action':'RESERVE_NEW','alternativeOriginalClosure':True},
  226025:{'company':2,'action':'RESERVE_NEW','alternativeOriginalClosure':True},
  226348:{'company':8,'action':'RESERVE_NEW','alternativeOriginalClosure':True},
  226530:{'company':11,'action':'RESERVE_NEW','alternativeOriginalClosure':True},
  227585:{'company':12,'action':'RESERVE_NEW','alternativeOriginalClosure':True},
  226455:{'company':9,'action':'RESERVE_NEW','alternativeOriginalClosure':True},
  226698:{'company':8,'action':'RESERVE_NEW','alternativeOriginalClosure':True},
}

def load_module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
observer=load_module('backlog_runner_observer',OBSERVER)
operator=observer.m

class RecoveryObserver(observer.Observer):
    """Do not pin the elapsed-age counter as if it were a business edit.

    The parent still checks both complete snapshots and all task/header data.
    Only the two documented elapsed-age paths are excluded from the long-lived
    approval fingerprint; deadlines, task identities and business dates remain.
    """
    def zeev_snapshot(self,names):
        data,observed=super().zeev_snapshot(names)
        data=copy.deepcopy(data)
        data.pop('leadTimeInDays',None)
        for task in data.get('instanceTasks',[]):task.pop('leadTimeInDays',None)
        return data,observed

# Both prepare_plan and create_observer resolve this class within this private
# imported module. The shared bank-repair observer and its pinned code are intact.
observer.Observer=RecoveryObserver

def require(ok,code):operator.require(ok,code)
def file_sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def write_json(path,value):
    with path.open('x',encoding='utf-8') as handle:
        json.dump(value,handle,ensure_ascii=False,indent=2);handle.write('\n');handle.flush();os.fsync(handle.fileno())
def read_json(path):return json.loads(path.read_text(encoding='utf-8-sig'))

def validate_config(config):
    require(isinstance(config,dict) and set(config)=={'version','mode','tickets','authorizedBacklogRecovery','approvedPlanRunId','approvedManifestSha256'},'CONFIG_SCHEMA_INVALID')
    require(type(config['version']) is int and config['version']==1 and config['mode'] in ('prepare','dry-run','apply'),'MODE_INVALID')
    tickets=config['tickets']
    require(isinstance(tickets,list) and tickets and all(type(t) is int and t in TARGETS for t in tickets) and len(set(tickets))==len(tickets),'TICKET_SCOPE_INVALID')
    require(type(config['authorizedBacklogRecovery']) is bool,'AUTHORIZATION_FLAG_INVALID')
    require(isinstance(config['approvedPlanRunId'],str) and isinstance(config['approvedManifestSha256'],str),'APPROVAL_FIELDS_INVALID')
    if config['mode']=='prepare':
        require(config['authorizedBacklogRecovery'] is False and config['approvedPlanRunId']=='0' and config['approvedManifestSha256']=='','PREPARE_MUST_NOT_AUTHORIZE_APPLY')
    else:
        require(re.fullmatch(r'[1-9]\d*',config['approvedPlanRunId']) and re.fullmatch(r'[a-f0-9]{64}',config['approvedManifestSha256']),'APPROVED_ARTIFACT_REQUIRED')
        require(config['authorizedBacklogRecovery']==(config['mode']=='apply'),'EXPLICIT_APPLY_AUTHORIZATION_REQUIRED')
    return config

def context(env=None):
    env=os.environ if env is None else env
    require(env.get('GITHUB_ACTIONS')=='true' and env.get('GITHUB_EVENT_NAME')=='push' and
      env.get('GITHUB_REF')=='refs/heads/'+BRANCH and env.get('GITHUB_RUN_ATTEMPT')=='1','WORKFLOW_CONTEXT_OR_RETRY_REJECTED')
    require(re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',env.get('GITHUB_REPOSITORY','')) and
      re.fullmatch(r'[1-9]\d*',env.get('GITHUB_RUN_ID','')) and re.fullmatch(r'[a-f0-9]{40}',env.get('GITHUB_SHA','')),'WORKFLOW_IDENTITY_INVALID')
    return {'repository':env['GITHUB_REPOSITORY'],'runId':env['GITHUB_RUN_ID'],'commit':env['GITHUB_SHA'],'branch':BRANCH,'workflow':WORKFLOW}

def code_hashes():
    paths=[Path('scripts/run-payment-backlog-recovery.py'),Path('scripts/observe-payment-backlog.py'),
      Path('scripts/reconcile-payment-backlog.py'),Path('scripts/payment_backlog_window.py'),Path('scripts/audit-payment-conflict-20261103-0609.py'),
      Path('scripts/payment-backlog-template.txt'),Path('tests/load-ts.cjs'),Path('package-lock.json'),Path(WORKFLOW)]
    paths.extend(Path('sql')/filename for filename in observer.CONTRACTS.values())
    paths.extend(path.relative_to(ROOT) for path in (ROOT/'src/functions/rm/post').glob('*.ts'))
    return {path.as_posix():file_sha(ROOT/path) for path in sorted(set(paths))}

def validate_target(plan,ticket):
    target=TARGETS[ticket]
    require(plan.get('ticket')==ticket and plan.get('company')==target['company'] and plan.get('action')==target['action'] and
      plan.get('idMov')==target.get('idMov') and plan.get('historicalIdentity')==target.get('historicalIdentity'),'PLAN_TARGET_CHANGED')
    require(bool(plan.get('alternativeOriginalClosure'))==bool(target.get('alternativeOriginalClosure')),'PLAN_ORIGINAL_CLOSURE_POLICY_CHANGED')
    require(plan.get('auditFile')==AUDIT_PATH.as_posix() and plan.get('auditSha256')==file_sha(AUDIT_PATH),'AUDIT_CHANGED')
    require(plan.get('observerSha256')==file_sha(OBSERVER),'OBSERVER_CODE_CHANGED')
    operator.validate_plan(plan)

def verify_run(run_id,ctx):
    require(run_id!=ctx['runId'],'APPROVAL_CANNOT_REFERENCE_CURRENT_RUN')
    token=os.environ.get('GH_TOKEN');require(bool(token),'GITHUB_READ_TOKEN_MISSING')
    url=f'https://api.github.com/repos/{ctx["repository"]}/actions/runs/{run_id}'
    request=urllib.request.Request(url,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
    try:
        with urllib.request.build_opener(observer.NoRedirect()).open(request,timeout=15) as response:data=json.load(response)
    except (urllib.error.URLError,TimeoutError):raise operator.GateError('APPROVED_WORKFLOW_READ_FAILED') from None
    require(str(data.get('id'))==run_id and data.get('repository',{}).get('full_name')==ctx['repository'] and
      data.get('path')==WORKFLOW and data.get('head_branch')==BRANCH and data.get('event')=='push' and
      data.get('run_attempt')==1 and data.get('status')=='completed' and data.get('conclusion')=='success','APPROVED_WORKFLOW_NOT_SUCCESSFUL')
    return data

def approved_plans(config,ctx):
    path=APPROVED/'manifest.json';require(file_sha(path)==config['approvedManifestSha256'],'APPROVED_MANIFEST_SHA_MISMATCH')
    manifest=read_json(path)
    require(manifest.get('version')==1 and manifest.get('mode')=='prepare' and
      manifest.get('financialWrites') is False and manifest.get('zeevWrites') is False and manifest.get('lambdaInvoked') is False,'APPROVED_MANIFEST_NOT_PREPARE')
    source=manifest.get('workflow',{})
    require(source.get('runId')==config['approvedPlanRunId'] and source.get('repository')==ctx['repository'] and
      source.get('branch')==BRANCH and source.get('workflow')==WORKFLOW,'APPROVED_PROVENANCE_MISMATCH')
    run=verify_run(config['approvedPlanRunId'],ctx);require(run.get('head_sha')==source.get('commit'),'APPROVED_COMMIT_MISMATCH')
    require(manifest.get('codeSha256')==code_hashes(),'REVIEWED_CODE_CHANGED')
    require(manifest.get('audit')=={'runId':AUDIT_RUN,'file':AUDIT_PATH.as_posix(),'sha256':file_sha(AUDIT_PATH)},'APPROVED_AUDIT_CHANGED')
    tickets=manifest.get('requestedTickets');require(isinstance(tickets,list) and tickets and len(set(tickets))==len(tickets) and all(type(t) is int and t in TARGETS for t in tickets),'APPROVED_SCOPE_INVALID')
    prepared=manifest.get('preparedTickets');require(isinstance(prepared,list) and prepared and len(set(prepared))==len(prepared) and set(prepared)<=set(tickets),'APPROVED_PREPARED_SCOPE_INVALID')
    require(set(config['tickets'])<=set(prepared),'APPROVED_TICKET_MISSING')
    inventory=manifest.get('files',{});expected={f'{kind}-{ticket}.json' for ticket in prepared for kind in ('plan','proof','dry-run')}
    require(set(inventory)==expected,'APPROVED_FILE_INVENTORY_INVALID')
    for name,digest in inventory.items():require(file_sha(APPROVED/name)==digest,'APPROVED_FILE_CHANGED')
    plans={}
    for ticket in config['tickets']:
        plan=read_json(APPROVED/f'plan-{ticket}.json');validate_target(plan,ticket)
        proof=read_json(APPROVED/f'proof-{ticket}.json');dry=read_json(APPROVED/f'dry-run-{ticket}.json')
        require(operator.observation_sha(proof)==plan['expectedObservationSha256'] and
          dry.get('mode')=='dry-run' and dry.get('applied') is False and dry.get('financialWrites') is False and
          dry.get('zeevWrites') is False and dry.get('lambdaInvoked') is False and
          dry.get('root')==operator.root_key(plan) and dry.get('manifest',{}).get('observationSha256')==plan['expectedObservationSha256'],'APPROVED_DRY_RUN_OR_PROOF_INVALID')
        plans[ticket]=plan
    return plans

def reconcile(plan,apply=False):
    backend=operator.AwsBackend(observer.create_observer(plan),plan,apply)
    return operator.reconcile(backend,plan,apply=apply,authorized=apply)

def execute(config,ctx):
    config=validate_config(config);OUT.mkdir(exist_ok=False)
    results=[];files={};plans=None
    if config['mode']!='prepare':plans=approved_plans(config,ctx)
    for ticket in config['tickets']:
        try:
            if config['mode']=='prepare':
                target=TARGETS[ticket]
                plan,proof=observer.prepare_plan(AUDIT_PATH,target['company'],ticket,target['action'],target.get('idMov'),copy.deepcopy(target.get('historicalIdentity')),bool(target.get('alternativeOriginalClosure')))
                validate_target(plan,ticket)
                for kind,value in (('plan',plan),('proof',proof)):
                    path=OUT/f'{kind}-{ticket}.json';write_json(path,value);files[path.name]=file_sha(path)
                result=reconcile(plan)
                path=OUT/f'dry-run-{ticket}.json';write_json(path,result);files[path.name]=file_sha(path)
                require(result.get('mode')=='dry-run' and result.get('applied') is False,'PREPARE_MUST_BE_READ_ONLY')
            else:
                result=reconcile(plans[ticket],apply=config['mode']=='apply')
                write_json(OUT/f'{config["mode"]}-{ticket}.json',result)
                require(config['mode']!='apply' or result.get('applied') is True,'APPLY_NOT_CONFIRMED_DO_NOT_RETRY')
            row={'ticket':ticket,'ok':True,'mode':config['mode'],'applied':result['applied'],'outcome':result.get('outcome','DRY_RUN_VALIDATED')}
        except Exception as error:
            row={'ticket':ticket,'ok':False,'mode':config['mode'],'automaticRetry':False,'gate':str(error) if isinstance(error,operator.GateError) else 'READ_OR_EXECUTION_FAILED','errorType':type(error).__name__}
            write_json(OUT/f'failure-{ticket}.json',row)
        results.append(row);print(json.dumps(row),flush=True)
        if not row['ok'] and config['mode']=='apply':break
    ok=len(results)==len(config['tickets']) and all(row['ok'] for row in results)
    summary={'version':1,'mode':config['mode'],'workflow':ctx,'results':results,'allSucceeded':ok,'financialWrites':False,'zeevWrites':False,'lambdaInvoked':False}
    write_json(OUT/'summary.json',summary)
    if config['mode']=='prepare':
        prepared=[row['ticket'] for row in results if row['ok']]
        files={name:digest for name,digest in files.items() if any(name==f'{kind}-{ticket}.json' for ticket in prepared for kind in ('plan','proof','dry-run'))}
        manifest={'version':1,'mode':'prepare','workflow':ctx,'requestedTickets':config['tickets'],'allPrepared':ok,
          'preparedTickets':prepared,
          'codeSha256':code_hashes(),'audit':{'runId':AUDIT_RUN,'file':AUDIT_PATH.as_posix(),'sha256':file_sha(AUDIT_PATH)},
          'files':files,'financialWrites':False,'zeevWrites':False,'lambdaInvoked':False}
        write_json(OUT/'manifest.json',manifest)
        print(json.dumps({'allPrepared':ok,'preparedTickets':prepared,'runId':ctx['runId'],'manifestSha256':file_sha(OUT/'manifest.json'),'automaticApply':False}),flush=True)
        return 0 if prepared else 2
    return 0 if ok else 2

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--emit-workflow-config',action='store_true');args=parser.parse_args()
    ctx=context();config=validate_config(read_json(CONFIG))
    if args.emit_workflow_config:
        with open(os.environ['GITHUB_OUTPUT'],'a',encoding='utf-8') as output:
            output.write('mode='+config['mode']+'\napproved_run='+config['approvedPlanRunId']+'\n')
        return 0
    return execute(config,ctx)

if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'status':'STOPPED_NO_AUTOMATIC_RETRY','errorType':type(error).__name__,
          'gate':str(error) if isinstance(error,operator.GateError) else 'LOCAL_READ_OR_EXECUTION_FAILURE'}));raise SystemExit(2)
