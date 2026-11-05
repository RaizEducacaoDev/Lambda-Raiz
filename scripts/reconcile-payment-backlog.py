"""Fixed-scope legacy reservation recovery; default dry-run, no RM or Zeev writes.

An independently reviewed observer supplies fresh, normalized read-only evidence.
The observer must query both native RM and an independent committed census, not
load an old JSON snapshot. See the fixtures in test_payment_backlog_recovery.py
for the exact proof schema. This module never invokes a financial Lambda,
approves a task, creates a financial record or marks an operation COMPLETE.
"""
import argparse
from collections import Counter
import datetime as dt
from decimal import Decimal, InvalidOperation
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import types
import uuid

_window_spec=importlib.util.spec_from_file_location('payment_backlog_window',Path(__file__).with_name('payment_backlog_window.py'))
WINDOW=importlib.util.module_from_spec(_window_spec);_window_spec.loader.exec_module(WINDOW)

ACCOUNT = '757843862365'
REGION = 'sa-east-1'
FUNCTION = 'lambda-raiz-prod-solicitacaoDePagamento'
TABLE = 'lambda-raiz-prod-pagamento-idpgto'
CASES = frozenset({(1,214960),(1,225136),(1,225374),(1,228367),(2,225573),(2,226025),(2,228793),
 (5,223287),(5,224647),(5,228007),(6,225868),(8,226348),(8,226698),(8,226756),(8,228103),
 (8,228158),(8,228198),(8,228275),(9,226455),(9,227147),(10,225233),(10,226345),(10,226356),
 (11,226530),(11,226927),(11,228310),(11,228417),(12,227585),(12,227991),(17,228287),
 (18,213291),(18,226925),(18,227386),(18,227440),(18,227449),(18,227574),(18,228634),(25,226610),(26,223885)})
IDENTITY = ('company','branch','supplierCompany','supplier','movementType','number','series','documentType','issueDate','entryDate','total')
DOCUMENT = IDENTITY[:8]
BANK = ('company','supplierCompany','supplier','id','paymentCode')
CRITICAL = ('pg','protocolVersion','recuperadaCriacaoIncerta','reconciliationEvidenceKey')
LOOKUPS = {'ticket','supplier_document','supplier_issue_date'}
HEX = r'[a-f0-9]{64}'
UUID = r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'

class GateError(RuntimeError):
    pass

def window_api():return types.SimpleNamespace(**globals())

def require(value, code):
    if not value:
        raise GateError(code)

def canon(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)

def sha(value):
    return hashlib.sha256(canon(value).encode()).hexdigest()

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def observation_content(value):
    """Exclude observation clocks and the self-hash, never business or event times."""
    if isinstance(value, dict):
        return {k: observation_content(v) for k,v in value.items() if k not in ('observedUtc','sourceReadbackSha256')}
    if isinstance(value, list):
        return [observation_content(v) for v in value]
    return value

def observation_sha(value):
    return sha(observation_content(value))

def fresh(value):
    try:
        stamp = dt.datetime.fromisoformat(value.replace('Z','+00:00'))
        age = (dt.datetime.now(dt.timezone.utc)-stamp).total_seconds()
        require(stamp.tzinfo is not None and -2 <= age <= 60, 'EVIDENCE_NOT_FRESH')
    except (ValueError, TypeError, AttributeError):
        raise GateError('INVALID_EVIDENCE_TIME') from None

def identifier(value, zero=False):
    require(not isinstance(value,bool) and isinstance(value,(str,int)), 'INVALID_IDENTIFIER')
    text = str(value)
    require(re.fullmatch(r'0|[1-9]\d*' if zero else r'[1-9]\d*',text), 'INVALID_IDENTIFIER')
    return text

def money(value):
    require(isinstance(value,(str,int)) and not isinstance(value,bool), 'INVALID_MONEY_TYPE')
    try:
        amount=Decimal(str(value))
        require(amount.is_finite() and amount>=0 and amount==amount.quantize(Decimal('.01')), 'INVALID_MONEY')
        return format(amount.quantize(Decimal('.01')),'f')
    except (InvalidOperation,ValueError):
        raise GateError('INVALID_MONEY') from None

def identity(value, allow_omitted_entry=False, allow_null_document=False):
    require(isinstance(value,dict) and all(k in value for k in IDENTITY), 'INCOMPLETE_IDENTITY')
    proven_null=allow_null_document and value.get('documentType') is None
    require(all(isinstance(value[k],str) for k in ('supplier','movementType','number','series','documentType','issueDate','entryDate') if k!='documentType' or not proven_null), 'INVALID_IDENTITY_TEXT')
    result={k:str(value[k]) for k in IDENTITY}
    if proven_null:result['documentType']=None
    for k in ('company','branch','supplierCompany'):
        result[k]=identifier(value[k],zero=k=='supplierCompany')
    require(re.fullmatch(r'\d{1,20}',result['supplier']) and re.fullmatch(r'1\.2\.\d{2}',result['movementType']), 'INVALID_SUPPLIER_OR_TYPE')
    for k in ('number','series','documentType'):
        if k=='documentType' and proven_null:continue
        require(re.fullmatch(r'[A-Za-z0-9.-]{1,35}',result[k]), 'INVALID_DOCUMENT_IDENTITY')
    for k in ('issueDate','entryDate'):
        if k=='entryDate' and allow_omitted_entry and value[k]=='':
            continue
        require(re.fullmatch(r'\d{4}-\d{2}-\d{2}',result[k]), 'INVALID_IDENTITY_DATE')
        try: dt.date.fromisoformat(result[k])
        except ValueError: raise GateError('INVALID_IDENTITY_DATE') from None
    result['total']=money(value['total'])
    require(Decimal(result['total'])>0,'NONPOSITIVE_TOTAL')
    return result

def bank(value):
    require(isinstance(value,dict) and all(k in value for k in BANK),'INCOMPLETE_BANK_IDENTITY')
    result={k:str(value[k]) for k in BANK}
    for k in ('company','supplierCompany','id'):
        result[k]=identifier(value[k],zero=k=='supplierCompany')
    require(re.fullmatch(r'\d{1,20}',result['supplier']) and re.fullmatch(r'[A-Z0-9]{1,4}',result['paymentCode']), 'INVALID_BANK_IDENTITY')
    return result

def plans(value, selected_bank):
    require(isinstance(value,list) and 0<len(value)<=120, 'INVALID_INSTALLMENTS')
    result=[]
    for row in value:
        require(isinstance(row,dict) and set(row)=={'dueDate','amount','bankCompany','bankId'}, 'INVALID_INSTALLMENT_SHAPE')
        due=row['dueDate']
        require(isinstance(due,str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}',due),'INVALID_DUE_DATE')
        try: dt.date.fromisoformat(due)
        except ValueError: raise GateError('INVALID_DUE_DATE') from None
        amount=money(row['amount'])
        require(Decimal(amount)>0,'NONPOSITIVE_INSTALLMENT')
        require(identifier(row['bankCompany'])==selected_bank['company'] and identifier(row['bankId'])==selected_bank['id'],'INSTALLMENT_BANK_MISMATCH')
        result.append((due,amount))
    return Counter(result)

def root_key(plan):
    require(type(plan.get('company')) is int and type(plan.get('ticket')) is int and (plan['company'],plan['ticket']) in CASES,'ROOT_NOT_ALLOWLISTED')
    return f"prod#PG#{plan['company']}#{plan['ticket']}"

def validate_plan(plan):
    pk=root_key(plan)
    require(type(plan.get('version')) is int and plan['version']==1 and plan.get('action') in ('RESERVE_NEW','ADOPT_EXISTING'),'INVALID_PLAN')
    require(re.fullmatch(HEX,plan.get('currentDigest','')) and re.fullmatch(HEX,plan.get('expectedObservationSha256','')),'INVALID_PLAN_HASH')
    runtime=plan.get('expectedRuntime',{})
    require(re.fullmatch(r'[A-Za-z0-9+/]{43}=',runtime.get('codeSha256','')) and re.fullmatch(UUID,runtime.get('revisionId','')),'INVALID_RUNTIME_PIN')
    before=plan.get('expectedRoot')
    require(isinstance(before,dict) and before.get('pk')=={'S':pk},'INVALID_ROOT_SNAPSHOT')
    require(before.get('state',{}).get('S') in ('CREATING','CREATED','RESERVED'),'UNSUPPORTED_ROOT_STATE')
    require(re.fullmatch(HEX,before.get('digest',{}).get('S','')) and re.fullmatch(UUID,before.get('owner',{}).get('S','')),'INVALID_ROOT_IDENTITY')
    lock=before.get('lockUntil',{}).get('N','')
    require(re.fullmatch(r'\d{13}',lock) and int(lock)<int(time.time()*1000),'ROOT_LEASE_NOT_EXPIRED')
    require(all(k not in before for k in CRITICAL if k!='pg'),'ROOT_ALREADY_RECOVERED_OR_NEW_PROTOCOL')
    if plan['action']=='RESERVE_NEW':
        require(before['state']['S'] in ('CREATING','RESERVED') and 'pg' not in before,'ROOT_HAS_POSSIBLE_EFFECT')
        if plan.get('alternativeOriginalClosure') is not None:
            WINDOW.validate_policy(plan,window_api())
        elif plan['currentDigest']!=before['digest']['S']:
            require(identity(plan.get('historicalIdentity'),allow_omitted_entry=True)['company']==str(plan['company']),'HISTORICAL_COMPANY_MISMATCH')
    else:
        require(plan.get('alternativeOriginalClosure') is None,'ALTERNATIVE_POLICY_CANNOT_ADOPT')
        require(before['state']['S'] in ('CREATING','CREATED'),'ROOT_NOT_ADOPTABLE')
        identifier(plan.get('idMov'))
        if 'pg' in before:
            require(before['pg']=={'S':str(plan['idMov'])},'ROOT_MOVEMENT_MISMATCH')
    return pk,before

def validate_observation(plan, proof):
    pk,before=validate_plan(plan)
    require(isinstance(proof,dict),'OBSERVATION_MISSING')
    fresh(proof.get('observedUtc'))
    signature=observation_sha(proof)
    require(proof.get('sourceReadbackSha256')==signature==plan['expectedObservationSha256'],'OBSERVATION_CONTENT_CHANGED')
    require(proof.get('runtime')==plan['expectedRuntime'],'RUNTIME_CHANGED')
    null_proof=proof.get('documentNullProof')
    if null_proof is not None:
        require(isinstance(null_proof,dict) and set(null_proof)=={'version','hasMovementExtension','documentTypeIsNull','rowSourceSha256'} and
          all(type(null_proof.get(k)) is int for k in ('version','hasMovementExtension','documentTypeIsNull')) and
          plan.get('alternativeOriginalClosure') is not None and null_proof.get('version')==2 and
          null_proof.get('hasMovementExtension')==1 and null_proof.get('documentTypeIsNull')==1 and
          re.fullmatch(HEX,null_proof.get('rowSourceSha256','')),'NULL_DOCUMENT_NOT_PROVEN')
    expected=identity(proof.get('identity'),allow_omitted_entry=True,allow_null_document=null_proof is not None)
    selected_bank=bank(proof.get('bank'))
    require(proof['bank'].get('active') is True,'BANK_INACTIVE')
    require(expected['company']==str(plan['company'])==selected_bank['company'] and all(selected_bank[k]==expected[k] for k in ('supplierCompany','supplier')),'BANK_DESTINATION_MISMATCH')
    planned=plans(proof.get('plans'),selected_bank)
    require(sum(Decimal(amount)*count for (_,amount),count in planned.items())==Decimal(expected['total']),'INSTALLMENT_TOTAL_MISMATCH')
    z=proof.get('zeev',{})
    fresh(z.get('observedUtc'))
    require(z.get('active') is True and z.get('flowId')==299 and z.get('ticket')==plan['ticket'] and z.get('company')==plan['company'],'ZEEV_CONTEXT_MISMATCH')
    require(z.get('currentDigest')==plan['currentDigest'] and identity(z.get('identity'),allow_omitted_entry=True,allow_null_document=null_proof is not None)==expected and bank(z.get('bank'))==selected_bank and plans(z.get('plans'),selected_bank)==planned,'ZEEV_INTENTION_MISMATCH')
    require(expected['entryDate']!='' or z.get('entryDateOmitted') is True,'ENTRY_DATE_OMISSION_NOT_EXPLICIT')
    require(z.get('validation')=={'payload':True,'bank':True,'document':True,'fiscal':True},'CURRENT_INTENTION_NOT_VALIDATED')
    closure=proof.get('closure',{})
    fresh(closure.get('observedUtc'))
    require(re.fullmatch(UUID,closure.get('originalRequestId','')) and re.fullmatch(HEX,closure.get('logSourceSha256','')),'CLOSURE_SOURCE_MISSING')
    require(closure.get('originalRootSha256')==sha(before) and closure.get('endSeen') is True and closure.get('reportSeen') is True and closure.get('coverageComplete') is True and type(closure.get('laterDispatches')) is int and closure['laterDispatches']==0,'ORIGINAL_CLOSURE_NOT_PROVEN')
    start,end,report=(closure.get(k) for k in ('originalStartMs','originalEndMs','originalReportMs'))
    require(all(type(x) is int for x in (start,end,report)) and int(before['lockUntil']['N'])-300000<=start<=int(before['lockUntil']['N']) and start<=end<=report<int(time.time()*1000),'INVALID_ORIGINAL_TIMELINE')
    if plan.get('alternativeOriginalClosure') is not None:
        WINDOW.validate(plan,proof.get('alternativeOriginalClosure',{}),closure,window_api())
    else:require(proof.get('alternativeOriginalClosure') is None,'UNEXPECTED_ALTERNATIVE_PROOF')
    required_lookups={sha(expected)}
    if plan.get('historicalIdentity') is not None:
        required_lookups.add(sha(identity(plan['historicalIdentity'],allow_omitted_entry=True)))
    normalized=[]
    for name in ('native','independent'):
        census=proof.get(name,{})
        fresh(census.get('observedUtc'))
        require(census.get('complete') is True and census.get('committedRead') is True and set(census.get('lookupModes',[]))==LOOKUPS,'CENSUS_INCOMPLETE')
        require(set(census.get('lookupIdentities',[]))==required_lookups and census.get('ticket')==plan['ticket'] and census.get('company')==plan['company'],'CENSUS_SCOPE_MISMATCH')
        require(all(isinstance(census.get(k),list) for k in ('movements','launches','documentCandidates')),'CENSUS_RECORDS_MISSING')
        document=census.get('document',{})
        require(document.get('configured') is True and {k:None if k=='documentType' and null_proof is not None and document.get(k) is None else str(document.get(k,'')) for k in DOCUMENT}=={k:expected[k] for k in DOCUMENT},'DOCUMENT_PREFLIGHT_MISMATCH')
        movements,launches,candidates=census['movements'],census['launches'],census['documentCandidates']
        if plan['action']=='RESERVE_NEW':
            require(not movements and not launches and not candidates,'PERSISTED_EFFECT_OR_DOCUMENT_CANDIDATE')
            continue
        pg=str(plan['idMov'])
        require(len(movements)==1 and len(launches)==sum(planned.values()) and len(candidates)==1,'AMBIGUOUS_NATIVE_EFFECT')
        movement=movements[0]
        actual_identity=identity(movement)
        require(all(actual_identity[k]==expected[k] for k in IDENTITY if k!='entryDate' or expected[k]!='') and identifier(movement.get('idMov'))==pg and str(movement.get('ticket'))==str(plan['ticket']) and movement.get('status') in ('A','F'),'MOVEMENT_IDENTITY_OR_STATUS_MISMATCH')
        require(money(movement.get('gross'))==money(movement.get('net'))==expected['total'],'MOVEMENT_TOTAL_OR_RETENTION_MISMATCH')
        require(candidates[0]=={'company':plan['company'],'idMov':int(pg),'ticket':plan['ticket']},'DOCUMENT_NOT_OWNED_BY_TICKET')
        ids=set();actual=[];normalized_launches=[]
        for launch in launches:
            lan=identifier(launch.get('idLan'))
            require(lan not in ids,'DUPLICATE_LAUNCH_IN_CENSUS');ids.add(lan)
            require(all(str(launch.get(k))==expected[k] for k in ('company','branch','supplierCompany','supplier','issueDate')) and str(launch.get('ticket'))==str(plan['ticket']) and identifier(launch.get('idMov'))==pg,'LAUNCH_IDENTITY_MISMATCH')
            require(all(type(launch.get(k)) is int and launch[k]==0 for k in ('status','pendingPayment','boletoCount')) and money(launch.get('paid'))=='0.00' and launch.get('boletoId') is None,'LAUNCH_ALREADY_USED')
            bank_id,bank_company=launch.get('bankId'),launch.get('bankCompany')
            require((bank_id is None and bank_company is None) or (identifier(bank_id)==selected_bank['id'] and identifier(bank_company)==selected_bank['company']),'EXISTING_BANK_MISMATCH')
            amount=money(launch.get('amount'));actual.append((launch.get('dueDate'),amount))
            normalized_launches.append({**launch,'idLan':lan,'amount':amount,'paid':'0.00'})
        require(Counter(actual)==planned,'INSTALLMENT_MAPPING_MISMATCH')
        normalized.append({'movement':movement,'launches':sorted(normalized_launches,key=lambda x:int(x['idLan']))})
    if plan['action']=='ADOPT_EXISTING':
        require(normalized[0]==normalized[1],'INDEPENDENT_NATIVE_READS_DISAGREE')
    return signature

def cas_request(plan, evidence_key, owner, now_ms):
    pk,before=validate_plan(plan)
    names,values,conditions={},{},[]
    for i,(name,value) in enumerate(sorted(before.items())):
        names[f'#old{i}']=name;values[f':old{i}']=value;conditions.append(f'#old{i} = :old{i}')
    for name in CRITICAL:
        if name not in before:conditions.append(f'attribute_not_exists({name})')
    names.update({'#state':'state','#owner':'owner'})
    values.update({':state':{'S':'RESERVED' if plan['action']=='RESERVE_NEW' else 'CREATED'},':owner':{'S':owner},
        ':digest':{'S':plan['currentDigest']},':until':{'N':str(now_ms-1)},':protocol':{'N':'2'},
        ':evidence':{'S':evidence_key},':now':{'N':str(now_ms)}})
    expression='SET #state = :state, #owner = :owner, digest = :digest, lockUntil = :until, protocolVersion = :protocol, reconciliationEvidenceKey = :evidence'
    if plan['action']=='ADOPT_EXISTING':
        expression+=', pg = :pg, recuperadaCriacaoIncerta = :recovered'
        values.update({':pg':{'S':str(plan['idMov'])},':recovered':{'BOOL':True}})
    return {'TableName':TABLE,'Key':{'pk':{'S':pk}},'UpdateExpression':expression,
        'ConditionExpression':' AND '.join(conditions+['lockUntil < :now']),
        'ExpressionAttributeNames':names,'ExpressionAttributeValues':values,'ReturnValues':'ALL_NEW'}

def reconcile(backend, plan, *, apply=False, authorized=False):
    require(not apply or authorized,'EXPLICIT_RECOVERY_AUTHORIZATION_REQUIRED')
    pk,before=validate_plan(plan)
    require(backend.bootstrap()==plan['expectedRuntime'],'RUNTIME_CHANGED')
    require(backend.get(pk)==before,'ROOT_CHANGED')
    initial=backend.observe(plan);validate_observation(plan,initial)
    manifest={'version':1,'action':plan['action'],'company':plan['company'],'ticket':plan['ticket'],
        'originalSnapshot':before,'originalSnapshotSha256':sha(before),'currentDigest':plan['currentDigest'],
        'idMov':plan.get('idMov'),'proof':initial,'observationSha256':observation_sha(initial),
        'financialWrites':False,'historicalRollbackProven':False,'authorizedRecovery':authorized}
    evidence_key=pk+'#ADJUDICATION#'+sha(manifest)
    out={'observedUtc':utc(),'mode':'apply' if apply else 'dry-run','applied':False,'root':pk,
        'evidenceKey':evidence_key,'manifest':manifest,'financialWrites':False,'zeevWrites':False,'lambdaInvoked':False}
    if not apply:return out
    archive={'pk':{'S':evidence_key},'manifestJson':{'S':canon(manifest)},'manifestSha256':{'S':sha(manifest)}}
    require(len(canon(archive).encode())<=350000,'ARCHIVE_TOO_LARGE')
    try:backend.archive(archive)
    except Exception:
        require(backend.get(evidence_key)==archive,'IMMUTABLE_ARCHIVE_NOT_CONFIRMED')
    require(backend.get(evidence_key)==archive,'IMMUTABLE_ARCHIVE_NOT_CONFIRMED')
    final=backend.observe(plan);validate_observation(plan,final)
    require(observation_sha(final)==observation_sha(initial),'OBSERVATION_CHANGED_AFTER_ARCHIVE')
    require(backend.bootstrap()==plan['expectedRuntime'],'RUNTIME_CHANGED_AFTER_ARCHIVE')
    require(backend.get(pk)==before,'ROOT_CHANGED_AFTER_ARCHIVE')
    validate_observation(plan,final)
    now_ms=int(time.time()*1000);owner=str(uuid.uuid4())
    request=cas_request(plan,evidence_key,owner,now_ms)
    expected={**before,'state':{'S':'RESERVED' if plan['action']=='RESERVE_NEW' else 'CREATED'},
        'owner':{'S':owner},'digest':{'S':plan['currentDigest']},'lockUntil':{'N':str(now_ms-1)},
        'protocolVersion':{'N':'2'},'reconciliationEvidenceKey':{'S':evidence_key}}
    if plan['action']=='ADOPT_EXISTING':expected.update(pg={'S':str(plan['idMov'])},recuperadaCriacaoIncerta={'BOOL':True})
    lost=False
    try:backend.update(request)
    except Exception:lost=True
    after=backend.get(pk)
    out.update(after=after,acknowledgementLost=lost)
    if after==expected:out.update(applied=True,outcome='NEW_ATTEMPT_RESERVED' if plan['action']=='RESERVE_NEW' else 'EXISTING_MOVEMENT_ADOPTED')
    elif after==before:out['outcome']='NOT_APPLIED_NO_RETRY'
    elif after.get('reconciliationEvidenceKey')=={'S':evidence_key}:out['outcome']='CONCURRENT_PROGRESS_DO_NOT_RETRY'
    else:out['outcome']='CONCURRENT_OR_UNKNOWN_STATE_DO_NOT_RETRY'
    return out

class AwsBackend:
    """AWS mutation allowlist; the injected observer performs read-only business queries."""
    def __init__(self, observer, plan, apply=False):
        self.observer,self.plan,self.apply=observer,plan,apply
        self.pk=root_key(plan)

    def aws(self,service,operation,payload):
        reads={('sts','get-caller-identity'),('lambda','get-function-configuration'),('dynamodb','get-item')}
        writes={('dynamodb','put-item'),('dynamodb','update-item')}
        require((service,operation) in reads or self.apply and (service,operation) in writes,'AWS_OPERATION_FORBIDDEN')
        if service=='dynamodb':
            require(payload.get('TableName')==TABLE,'AWS_TABLE_MISMATCH')
            key=payload.get('Item',{}).get('pk',{}).get('S') if operation=='put-item' else payload.get('Key',{}).get('pk',{}).get('S')
            require(key==self.pk or isinstance(key,str) and key.startswith(self.pk+'#ADJUDICATION#') and re.fullmatch(HEX,key.split('#')[-1]),'AWS_KEY_MISMATCH')
            if operation=='put-item':require(key!=self.pk and payload.get('ConditionExpression')=='attribute_not_exists(pk)','ARCHIVE_OVERWRITE_FORBIDDEN')
            if operation=='update-item':require(key==self.pk and payload.get('ConditionExpression') and payload.get('UpdateExpression','').startswith('SET '),'ROOT_UPDATE_NOT_CONDITIONAL')
        if service=='lambda':require(payload.get('FunctionName')==FUNCTION,'AWS_FUNCTION_MISMATCH')
        env={**os.environ,'AWS_MAX_ATTEMPTS':'1','AWS_RETRY_MODE':'standard','AWS_PAGER':''}
        with tempfile.TemporaryDirectory(prefix='payment-recovery-') as directory:
            path=Path(directory)/'request.json';path.write_text(json.dumps(payload),encoding='utf-8')
            result=subprocess.run(['aws',service,operation,'--region',REGION,'--cli-input-json','file://'+str(path),
                '--output','json','--no-cli-pager','--cli-connect-timeout','5','--cli-read-timeout','15'],
                capture_output=True,text=True,timeout=25,env=env)
        require(result.returncode==0,'AWS_CALL_FAILED_NO_RETRY')
        return json.loads(result.stdout or '{}')

    def bootstrap(self):
        require(self.aws('sts','get-caller-identity',{}).get('Account')==ACCOUNT,'AWS_ACCOUNT_MISMATCH')
        cfg=self.aws('lambda','get-function-configuration',{'FunctionName':FUNCTION})
        require(cfg.get('State')=='Active' and cfg.get('LastUpdateStatus')=='Successful' and cfg.get('Environment',{}).get('Variables',{}).get('PAGAMENTO_IDPGTO_TABLE')==TABLE,'RUNTIME_NOT_READY')
        return {'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId']}

    def observe(self,plan):return self.observer.observe(plan)
    def get(self,key):return self.aws('dynamodb','get-item',{'TableName':TABLE,'ConsistentRead':True,'Key':{'pk':{'S':key}}}).get('Item',{})
    def archive(self,item):return self.aws('dynamodb','put-item',{'TableName':TABLE,'Item':item,'ConditionExpression':'attribute_not_exists(pk)'})
    def update(self,request):return self.aws('dynamodb','update-item',request)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan',type=Path,required=True)
    parser.add_argument('--observer-module',type=Path,required=True)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--authorized-backlog-recovery',action='store_true')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    require(not args.apply or args.authorized_backlog_recovery,'EXPLICIT_RECOVERY_AUTHORIZATION_REQUIRED')
    plan=json.loads(args.plan.read_text(encoding='utf-8-sig'));validate_plan(plan)
    require(hashlib.sha256(args.observer_module.read_bytes()).hexdigest()==plan.get('observerSha256'),'OBSERVER_CODE_NOT_REVIEWED')
    spec=importlib.util.spec_from_file_location('payment_recovery_observer',args.observer_module)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    observer=module.create_observer(plan)
    result=reconcile(AwsBackend(observer,plan,args.apply),plan,apply=args.apply,authorized=args.authorized_backlog_recovery)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'root':result['root'],'mode':result['mode'],'applied':result['applied'],'outcome':result.get('outcome','READ_ONLY_PLAN'),'financialWrites':False}))
    return 0 if not args.apply or result['applied'] else 2

if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'status':'STOPPED_NO_AUTOMATIC_RETRY','errorType':type(error).__name__,
            'gate':str(error) if isinstance(error,GateError) else 'LOCAL_READ_OR_VALIDATION_FAILURE'}))
        raise SystemExit(2)
