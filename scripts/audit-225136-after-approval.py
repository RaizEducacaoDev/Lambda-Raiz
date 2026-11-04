"""READ ONLY: correlate normal fiscal approval with existing movement 45370."""
import datetime as dt,importlib.util,json,re,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('audit',Path(__file__).with_name('audit-payment-conflict-20261103-0609.py'));a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
a.PK='prod#PG#1#225136'
deadline=time.monotonic()+180
assert a.aws('sts','get-caller-identity',deadline=deadline)['Account']==a.ACCOUNT
now=dt.datetime.now(dt.timezone.utc);start=dt.datetime(2026,11,4,21,36,tzinfo=dt.timezone.utc)
assert 0<(now-start).total_seconds()<7200,'Fixed approval window expired'
events,coverage=a.read_log_window('"225136"',int(start.timestamp()*1000),int(now.timestamp()*1000),deadline)
requests={}
def safe(e):
 row=a.sanitize(e)
 if row and row.get('kind')=='bank_confirmed':
  message,_=a.unwrap(e);match=re.search(r'\bidLans\s*:\s*\[\s*([\d\s,\'\"]+)\]',message)
  if match:row['idLans']=[int(v) for v in re.findall(r'\d+',match[1])]
 return row
for e in events:
 row=safe(e)
 if row and str(row.get('ticket',''))=='225136' and row.get('requestId'):requests.setdefault(row['requestId'],[]).append(e['timestamp'])
assert len(requests)<=15,'Narrow the approval audit'
out={'observedUtc':now.isoformat(),'readOnly':True,'ticket':225136,'windowStartUtc':start.isoformat(),'coverage':coverage,'requests':[]}
for request,times in requests.items():
 full,cov=a.read_log_window('"'+request+'"',min(times)-60000,max(times)+60000,deadline)
 rows=[r for e in full if (r:=safe(e))]
 out['requests'].append({'requestId':request,'coverage':cov,'events':rows,'creationDispatchSeen':any(r.get('event')=='transport_call_started' or r.get('etapa')=='SaveRecord' and r.get('evento')=='inicio' for r in rows)})
cfg=a.aws('lambda','get-function-configuration','--function-name',a.FUNCTION,deadline=deadline)
item=a.aws('dynamodb','get-item','--table-name',a.TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':a.PK}}),deadline=deadline).get('Item',{})
out['function']={k:cfg.get(k) for k in ['FunctionName','CodeSha256','RevisionId','LastModified','State','LastUpdateStatus']}
out['reservation']=a.safe_reservation(item)
out['coverageComplete']=coverage['complete'] and all(r['coverage']['complete'] for r in out['requests'])
directory=Path('.audit225136-after-approval');directory.mkdir(exist_ok=True)
(directory/'readback.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
print(json.dumps(out,indent=2))
assert out['coverageComplete'],'Incomplete log coverage'
