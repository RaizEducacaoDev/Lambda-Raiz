"""Read-only fixed-scope discovery and complete dispatch census for the approved backlog."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import base64
import datetime as dt
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import time
import urllib.request
import zipfile

spec=importlib.util.spec_from_file_location('audit_base',Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
a.AWS_READS=a.AWS_READS|{('lambda','get-function')}
CASES=[(1,214960),(1,225136),(1,225374),(1,228367),(2,225573),(2,226025),(2,228793),(5,223287),(5,224647),(5,228007),
 (6,225868),(8,226348),(8,226698),(8,226756),(8,228103),(8,228158),(8,228198),(8,228275),(9,226455),(9,227147),
 (10,225233),(10,226345),(10,226356),(11,226530),(11,226927),(11,228310),(11,228417),(12,227585),(12,227991),
 (17,228287),(18,213291),(18,226925),(18,227386),(18,227440),(18,227449),(18,227574),(18,228634),(25,226610),(26,223885)]
OUT=Path('.payment-bulk-readonly');OUT.mkdir(exist_ok=True)
deadline=time.monotonic()+780
def aws(*args):return a.aws(*args,deadline=deadline)
assert aws('sts','get-caller-identity')['Account']==a.ACCOUNT
cfg=aws('lambda','get-function-configuration','--function-name',a.FUNCTION)
assert cfg['Environment']['Variables']['PAGAMENTO_IDPGTO_TABLE']==a.TABLE and cfg['Environment']['Variables']['STAGE']=='prod'
now=dt.datetime.now(dt.timezone.utc);end=int(now.timestamp()*1000)
out={'observedUtc':now.isoformat(),'businessWrites':False,'configurationWrites':False,
 'function':{k:cfg.get(k) for k in ['FunctionName','CodeSha256','RevisionId','LastModified','State','LastUpdateStatus']},'tickets':[],'logWindows':[]}
allowed={'pk','digest','owner','state','pg','lockUntil','protocolVersion','recuperadaCriacaoIncerta','reconciliationEvidenceKey'}
for company,ticket in CASES:
 key=f'prod#PG#{company}#{ticket}'
 item=aws('dynamodb','get-item','--table-name',a.TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':key}})).get('Item',{})
 out['tickets'].append({'company':company,'ticket':ticket,'root':{k:v for k,v in item.items() if k in allowed},
   'unknownAttributes':sorted(set(item)-allowed),'exists':bool(item)})
start=min(int(x['root']['lockUntil']['N']) for x in out['tickets'] if x['root'].get('lockUntil'))-300000
assert 0<end-start<20*86400000
ticket_set={t for _,t in CASES}
jobs=[]
day=dt.datetime.fromtimestamp(start/1000,dt.timezone.utc).replace(hour=0,minute=0,second=0,microsecond=0)
while int(day.timestamp()*1000)<end:
 lo=max(start,int(day.timestamp()*1000));hi=min(end,int((day+dt.timedelta(days=1)).timestamp()*1000))
 for pattern in ['"[RM-DIAG]" "SaveRecord"','"transport_call_started"']:
  jobs.append((pattern,lo,hi))
 day+=dt.timedelta(days=1)
def window(job):
 pattern,lo,hi=job
 events,coverage=a.read_log_window(pattern,lo,hi,deadline)
 safe=[row for e in events if (row:=a.sanitize(e)) is not None and row.get('ticket') in ticket_set]
 return {'pattern':pattern,'startMs':lo,'endMs':hi,'coverage':coverage,'events':safe}
with ThreadPoolExecutor(max_workers=3) as pool:
 for future in as_completed([pool.submit(window,j) for j in jobs]):
  out['logWindows'].append(future.result())
  (OUT/'readback.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
  print(json.dumps({'completedLogWindows':len(out['logWindows']),'total':len(jobs)}),flush=True)
all_events=[e for w in out['logWindows'] for e in w['events']]
requests={}
for case in out['tickets']:
 lease=int(case['root'].get('lockUntil',{}).get('N','0'))
 events=[e for e in all_events if e.get('ticket')==case['ticket']]
 dispatch=[e for e in events if (e.get('kind')=='legacy_diagnostic' and e.get('etapa')=='SaveRecord' and e.get('evento')=='inicio') or e.get('event')=='transport_call_started']
 case['allDispatches']=dispatch
 original={e['requestId'] for e in dispatch if lease-300000<=e['timestamp']<=lease+1000 and e.get('requestId')}
 case['originalRequestCandidates']=sorted(original)
 for request in original:
  times=[e['timestamp'] for e in dispatch if e['requestId']==request]
  requests[request]=(min(times)-120000,min(max(times)+120000,end))
 case['laterDispatchRequestIds']=sorted({e['requestId'] for e in dispatch if e['timestamp']>lease and e.get('requestId')})
def context(args):
 request,(lo,hi)=args
 events,coverage=a.read_log_window('"'+request+'"',lo,hi,deadline)
 safe=[row for e in events if (row:=a.sanitize(e)) is not None]
 fixed=[]
 for event in events:
  message,_=a.unwrap(event)
  for code,literal in [('RM_RETURN_WITHOUT_EXPECTED_KEY','Criação RM de resultado incerto; consultar movimento do ticket'),
                       ('CREATION_UNCERTAIN','Criação RM incerta; requer reconciliação')]:
   if literal in message:fixed.append(code)
 return {'requestId':request,'coverage':coverage,'events':safe,'fixedCodeIndicators':sorted(set(fixed))}
out['originalRequests']=[]
with ThreadPoolExecutor(max_workers=3) as pool:
 for future in as_completed([pool.submit(context,item) for item in requests.items()]):out['originalRequests'].append(future.result())
out['coverageComplete']=all(w['coverage']['complete'] for w in out['logWindows']+out['originalRequests'])
out['completedUtc']=dt.datetime.now(dt.timezone.utc).isoformat()
(OUT/'readback.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
active=aws('lambda','get-function','--function-name',a.FUNCTION)
assert active['Configuration']['CodeSha256']==cfg['CodeSha256'] and active['Configuration']['RevisionId']==cfg['RevisionId']
with urllib.request.urlopen(active['Code']['Location'],timeout=25) as response:blob=response.read(30000001)
assert len(blob)<=30000000 and base64.b64encode(hashlib.sha256(blob).digest()).decode()==cfg['CodeSha256']
with zipfile.ZipFile(io.BytesIO(blob)) as package:
 for name in package.namelist():
  body=package.read(name)
  assert all(not value or value.encode() not in body for value in [cfg['Environment']['Variables'].get('PASSWORD_TOTVS'),cfg['Environment']['Variables'].get('TOKEN_ZEEV')])
(OUT/'active-before.zip').write_bytes(blob)
print(json.dumps({'coverageComplete':out['coverageComplete'],'tickets':len(out['tickets']),'originalRequests':len(out['originalRequests']),'codeSha256':cfg['CodeSha256']}))
assert out['coverageComplete']
