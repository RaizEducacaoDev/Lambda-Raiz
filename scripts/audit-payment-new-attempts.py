"""Read-only correlation of new attempts observed during the backlog audit.

Uses the reviewed event allowlist: no raw logs, credentials or request bodies.
No Lambda invocation, workflow action, financial or control-state mutation.
"""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
a=module('new_attempts_audit_base',ROOT/'scripts/audit-payment-conflict-20261103-0609.py')
r=module('new_attempts_readback_base',ROOT/'scripts/read-payment-backlog-final.py')
CASES=((1,225136),(1,227599),(2,226026),(2,227993),(2,228237),(8,229064),(8,229070))
START=dt.datetime(2026,11,4,20,37,55,tzinfo=dt.timezone.utc)
OUT=Path('.payment-new-attempts-readonly')

def require(ok,code):
    if not ok:raise a.AuditError(code)

def safe_events(events,request=None,ticket=None):
    rows=[]
    for event in events:
        row=a.sanitize(event)
        if row is None:continue
        if request is not None and row.get('requestId')!=request:continue
        if ticket is not None and str(row.get('ticket'))!=str(ticket):continue
        rows.append(row)
    return sorted(rows,key=lambda value:value['timestamp'])

def main():
    require(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1' and
      os.environ.get('GITHUB_REPOSITORY')=='RaizEducacaoDev/Lambda-Raiz' and
      os.environ.get('GITHUB_REF')=='refs/heads/fix/idpgto-vinculo-obrigatorio','WORKFLOW_CONTEXT_INVALID')
    OUT.mkdir(exist_ok=False);deadline=time.monotonic()+600
    reader=r.Reader();print(json.dumps({'stage':'runtime_read'}),flush=True);runtime=reader.pin()
    end=dt.datetime.now(dt.timezone.utc);start_ms=int(START.timestamp()*1000);end_ms=int(end.timestamp()*1000)
    require(0<end_ms-start_ms<4*3600000,'LOG_WINDOW_OUTSIDE_REVIEWED_DAY')
    result={'version':1,'observedUtc':end.isoformat(),'runtimeStart':runtime,
      'startUtc':START.isoformat(),'financialWrites':False,'configurationWrites':False,
      'dynamoWrites':False,'lambdaInvoked':False,'rawLogsRetained':False,'cases':[]}
    for company,ticket in CASES:
        print(json.dumps({'stage':'ticket_root_and_log_read','ticket':ticket}),flush=True)
        before=reader.get(company,ticket)
        events,coverage=a.read_log_window('"'+str(ticket)+'"',start_ms,end_ms,deadline)
        safe=safe_events(events,ticket=ticket)
        ids=sorted({x['requestId'] for x in safe if re.fullmatch(a.UUID,str(x.get('requestId','')))})
        require(len(ids)<=30,'REQUEST_CONTEXT_BOUND_REACHED')
        requests=[]
        for request in ids:
            times=[x['timestamp'] for x in safe if x.get('requestId')==request]
            lo=max(start_ms,min(times)-40000);hi=min(end_ms,max(times)+40000)
            context,complete=a.read_log_window('"'+request+'"',lo,hi,deadline)
            requests.append({'requestId':request,'coverage':complete,'events':safe_events(context,request=request)})
        after=reader.get(company,ticket)
        result['cases'].append({'company':company,'ticket':ticket,'before':r.root_summary(before,company,ticket),
          'after':r.root_summary(after,company,ticket),'rootChangedDuringRead':before!=after,
          'coverage':coverage,'ticketEvents':safe,'requests':requests})
        (OUT/'readback.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'ticket':ticket,'requestCount':len(requests),'coverageComplete':coverage['complete']}),flush=True)
    result['runtimeEnd']=reader.pin();result['completedUtc']=dt.datetime.now(dt.timezone.utc).isoformat()
    result['coverageComplete']=all(x['coverage']['complete'] and all(v['coverage']['complete'] for v in x['requests']) for x in result['cases'])
    (OUT/'readback.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    require(result['coverageComplete'],'LOG_COVERAGE_INCOMPLETE')
    print(json.dumps({'coverageComplete':True,'cases':len(result['cases']),'writes':False}))

def self_test():
    a.self_test()
    secret='PRIVATE_SENTINEL_DO_NOT_EXPORT'
    request='ace759fd-51ab-4cd5-84fe-a76752e6623e'
    events=[{'timestamp':1,'message':request+'\t[RM-IDPGTO] Integração pendente '+json.dumps({'ticket':225136,'status':503,'state':'CREATING','raw':secret})},
      {'timestamp':2,'message':request+'\t[RM-IDPGTO] Integração pendente '+json.dumps({'ticket':999999,'status':503,'raw':secret})},
      {'timestamp':3,'message':request+'\t[RM-INFO] Campos recebidos: '+secret}]
    actual=safe_events(events,ticket=225136)
    assert len(actual)==1 and actual[0]['ticket']==225136 and secret not in json.dumps(actual)
    assert safe_events(events,request='00000000-0000-0000-0000-000000000000')==[]
    assert len(CASES)==len(set(CASES))==7
    assert all(operation in {'get-caller-identity','get-function-configuration','get-item','filter-log-events'} for _,operation in a.AWS_READS)
    print(json.dumps({'newAttemptAuditSelfTest':'passed','awsRequests':0}))

if __name__=='__main__':
    try:
        if '--self-test' in sys.argv:self_test()
        else:main()
    except Exception as error:
        print(json.dumps({'state':'READ_ONLY_STOPPED','code':str(error) if isinstance(error,(a.AuditError,r.AuditError)) else 'READ_OR_VALIDATION_FAILED','exceptionClass':type(error).__name__,'writes':False}));sys.exit(2)
