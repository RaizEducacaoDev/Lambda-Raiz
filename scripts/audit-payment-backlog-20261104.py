"""Bounded read-only inventory of pending production payment roots and two named incidents."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import time

spec=importlib.util.spec_from_file_location('backlog_audit',Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
deadline=time.monotonic()+330
assert a.aws('sts','get-caller-identity',deadline=deadline)['Account']==a.ACCOUNT
cfg=a.aws('lambda','get-function-configuration','--function-name',a.FUNCTION,deadline=deadline)
assert cfg.get('Environment',{}).get('Variables',{}).get('PAGAMENTO_IDPGTO_TABLE')==a.TABLE
now=dt.datetime.now(dt.timezone.utc)
out={'observedUtc':now.isoformat(),'businessWrites':False,'configurationWrites':False,
     'function':{k:cfg.get(k) for k in ['FunctionName','CodeSha256','RevisionId','LastModified','State','LastUpdateStatus']},
     'namedTickets':[],'inventory':{'complete':False,'rows':[]}}
for ticket in [225374,225136]:
    a.TICKET=str(ticket);a.COMPANY='1';a.PK=f'prod#PG#1#{ticket}'
    item=a.aws('dynamodb','get-item','--table-name',a.TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':a.PK}}),deadline=deadline).get('Item',{})
    record=a.safe_reservation(item)
    record['protocolVersion']=int(item['protocolVersion']['N']) if 'N' in item.get('protocolVersion',{}) else None
    record['hasPgAttribute']='pg' in item
    case={'ticket':ticket,'reservation':record,'exists':bool(item),'windows':[]}
    spans=[('recent',int((now-dt.timedelta(days=1)).timestamp()*1000),int(now.timestamp()*1000))]
    if record.get('lockUntil'):
        lease=int(record['lockUntil'])
        spans.append(('originalLeaseWindow',lease-300000,min(lease+120000,int(now.timestamp()*1000))))
    requests={}
    for name,start,end in spans:
        events,coverage=a.read_log_window('"'+str(ticket)+'"',start,end,deadline)
        safe=[s for e in events if (s:=a.sanitize(e)) is not None]
        case['windows'].append({'name':name,'coverage':coverage,'events':safe})
        for row in safe:
            if row.get('requestId'):requests.setdefault(row['requestId'],[]).append(row['timestamp'])
    assert len(requests)<=25,'Too many requests; narrow audit'
    case['requests']=[]
    for request,times in requests.items():
        events,coverage=a.read_log_window('"'+request+'"',min(times)-120000,min(max(times)+120000,int(now.timestamp()*1000)),deadline)
        safe=[s for e in events if (s:=a.sanitize(e)) is not None]
        fixed=[]
        for event in events:
            message,_=a.unwrap(event)
            for code,literal in [('RM_RETURN_WITHOUT_EXPECTED_KEY','Criação RM de resultado incerto; consultar movimento do ticket'),
                                 ('NATIVE_REQUIRED_FIELD','Campo obrigatório'),('CREATION_UNCERTAIN','Criação RM incerta; requer reconciliação')]:
                if literal in message:fixed.append(code)
        case['requests'].append({'requestId':request,'coverage':coverage,'events':safe,'fixedCodeIndicators':sorted(set(fixed))})
    out['namedTickets'].append(case)

# Discovery only: no rights are added. Eventually consistent scan is not evidence
# for financial recovery. Every actionable candidate requires fresh consistent reads.
last=None;consumed=0
for page in range(1,51):
    if time.monotonic()>deadline-25:
        out['inventory']['stoppedReason']='TIME_BUDGET';break
    payload={'TableName':a.TABLE,'Limit':100,'ConsistentRead':False,
             'ProjectionExpression':'pk,#s,pg,protocolVersion,lockUntil',
             'FilterExpression':'begins_with(pk,:p) AND attribute_exists(#s) AND #s <> :complete',
             'ExpressionAttributeNames':{'#s':'state'},
             'ExpressionAttributeValues':{':p':{'S':'prod#PG#'},':complete':{'S':'COMPLETE'}},
             'ReturnConsumedCapacity':'TOTAL'}
    if last:payload['ExclusiveStartKey']=last
    result=subprocess.run(['aws','dynamodb','scan','--region',a.REGION,'--cli-input-json',json.dumps(payload),
                           '--output','json','--no-cli-pager','--no-paginate','--cli-connect-timeout','5','--cli-read-timeout','20'],
                          capture_output=True,text=True,timeout=25)
    if result.returncode:
        code=re.search(r'An error occurred \(([^)]+)\)',result.stderr)
        out['inventory']['stoppedReason']=code.group(1) if code and code.group(1) in ['AccessDeniedException','ValidationException','ResourceNotFoundException','ThrottlingException'] else 'READ_FAILED'
        break
    response=json.loads(result.stdout)
    consumed+=response.get('ConsumedCapacity',{}).get('CapacityUnits',0)
    for item in response.get('Items',[]):
        key=item.get('pk',{}).get('S','');match=re.fullmatch(r'prod#PG#([1-9]\d*)#([1-9]\d*)',key)
        if not match:continue
        state=item.get('state',{}).get('S')
        if state not in a.STATES:continue
        row={'company':int(match[1]),'ticket':int(match[2]),'state':state,
             'protocolVersion':int(item['protocolVersion']['N']) if 'N' in item.get('protocolVersion',{}) else None,
             'pg':item.get('pg',{}).get('S'),'lockUntil':item.get('lockUntil',{}).get('N')}
        out['inventory']['rows'].append(row)
    out['inventory']['pages']=page
    last=response.get('LastEvaluatedKey')
    if not last:out['inventory']['complete']=True;break
out['inventory']['readCapacityUnits']=consumed
out['inventory']['rows'].sort(key=lambda row:(row['state'],row['company'],row['ticket']))
directory=Path('.payment-backlog-audit');directory.mkdir(exist_ok=True)
(directory/'readback.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
print(json.dumps(out,indent=2))
assert all(w['coverage']['complete'] for case in out['namedTickets'] for w in case['windows']+case['requests']),'Named ticket log coverage incomplete'
