"""Fixed ticket audit: AWS reads only. Never invoke Lambda or modify data/code."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import re
import time

spec=importlib.util.spec_from_file_location('readonly',Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
a.PK='prod#PG#11#226530'
a.AWS_READS=a.AWS_READS|{('dynamodb','scan')}
OUT=Path('.226530-readonly');OUT.mkdir(exist_ok=True)
deadline=time.monotonic()+180
assert a.aws('sts','get-caller-identity',deadline=deadline)['Account']==a.ACCOUNT
cfg=a.aws('lambda','get-function-configuration','--function-name',a.FUNCTION,deadline=deadline)
assert cfg.get('Environment',{}).get('Variables',{}).get('STAGE')=='prod'
assert cfg.get('Environment',{}).get('Variables',{}).get('PAGAMENTO_IDPGTO_TABLE')==a.TABLE
end=dt.datetime.now(dt.timezone.utc); start=dt.datetime(2026,11,5,18,50,tzinfo=dt.timezone.utc)
assert start<end<start+dt.timedelta(hours=12)
events,coverage=a.read_log_window('"226530"',int(start.timestamp()*1000),int(end.timestamp()*1000),deadline)
requests={}
for event in events:
    _,request=a.unwrap(event)
    if request:requests.setdefault(request,[]).append(event['timestamp'])
assert len(requests)<=12,'Narrow the log window'
extra={'[RM-IDPGTO] Operação existente confirmada':'existing_confirmed',
       '[RM-IDPGTO] Retomada confirmada':'retry_confirmed',
       '[RM-IDPGTO] Rejeição encerrada para correção no formulário':'rejection_closed'}
def project(event):
    row=a.sanitize(event); message,request=a.unwrap(event)
    if row is None:
        for marker,kind in extra.items():
            if marker in message:
                row={'timestamp':event['timestamp'],'utc':dt.datetime.fromtimestamp(event['timestamp']/1000,dt.timezone.utc).isoformat(),
                     'requestId':request,'kind':kind,**a.safe_fields(message.split(marker,1)[1])};break
    return row
result={'ticket':226530,'company':11,'observedUtc':end.isoformat(),'windowStartUtc':start.isoformat(),
        'readOnly':True,'lambdaInvoked':False,'awsWrites':False,'ticketCoverage':coverage,
        'function':{k:cfg.get(k) for k in ['FunctionName','CodeSha256','RevisionId','LastModified','State','LastUpdateStatus']},'requests':[]}
for request,timestamps in sorted(requests.items(),key=lambda item:min(item[1])):
    full,cov=a.read_log_window('"'+request+'"',min(timestamps)-30000,max(timestamps)+30000,deadline)
    rows=[row for event in full if (row:=project(event)) is not None]
    result['requests'].append({'requestId':request,'coverage':cov,'events':rows,
        'creationDispatchSeen':any(r.get('event')=='transport_call_started' for r in rows),
        'bankConfirmationSeen':any(r.get('kind') in ['bank_confirmed','existing_confirmed'] for r in rows)})
item=a.aws('dynamodb','get-item','--table-name',a.TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':a.PK}}),deadline=deadline).get('Item',{})
result['reservation']=a.safe_reservation(item)
# Scan only the exact ticket prefix in this dedicated operation-control table.
# Project the allowlisted evidence, not raw responses/XML or bank account data.
evidence=[]; last=None; complete=False
for _ in range(30):
    args=['dynamodb','scan','--table-name',a.TABLE,'--consistent-read','--limit','250','--no-paginate',
          '--filter-expression','begins_with(#pk,:prefix)','--projection-expression','#pk,evidence',
          '--expression-attribute-names',json.dumps({'#pk':'pk'}),'--expression-attribute-values',json.dumps({':prefix':{'S':a.PK+'#EVIDENCE#'}})]
    if last:args+=['--exclusive-start-key',json.dumps(last)]
    page=a.aws(*args,deadline=deadline)
    for row in page.get('Items',[]):
        assert row.get('pk',{}).get('S','').startswith(a.PK+'#EVIDENCE#')
        obj=row.get('evidence',{}).get('M',{})
        safe={}
        for key in ['version','phase','xmlSha256','movementType','company','branch','ticket','supplierCompany','supplier','paymentId','paymentCompany','number','series','documentType','issueDate','entryDate','total']:
            val=obj.get(key,{})
            if 'S' in val:safe[key]=val['S']
            elif 'N' in val:safe[key]=val['N']
        diagnostic=obj.get('diagnostic',{}).get('M',{})
        if diagnostic:
            d={}
            for key in ['category','reasonCode','reasonSource','responseSha256','length','lineCount']:
                val=diagnostic.get(key,{})
                if 'S' in val:d[key]=val['S']
                elif 'N' in val:d[key]=int(val['N'])
            for key in ['mentionedFields','nativeErrorTypes']:d[key]=[v['S'] for v in diagnostic.get(key,{}).get('L',[]) if 'S' in v]
            safe['diagnostic']=d
        evidence.append(safe)
    last=page.get('LastEvaluatedKey')
    if not last:complete=True;break
result['evidence']=evidence;result['evidenceCoverageComplete']=complete
result['coverageComplete']=coverage['complete'] and all(r['coverage']['complete'] for r in result['requests'])
(OUT/'readback.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k not in ['evidence']},ensure_ascii=False,indent=2))
assert result['coverageComplete'] and complete,'Incomplete read coverage'
