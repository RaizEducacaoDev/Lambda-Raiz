"""Read only: scoped Dynamo roots, active runtime and sanitized historical logs.
No Invoke, SaveRecord, IAM, configuration, table or workflow business mutation.
"""
import concurrent.futures, datetime as dt, hashlib, importlib.util, json, pathlib, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('safe_audit',ROOT/'scripts/audit-payment-conflict-20261103-0609.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
a.LABELS['[RM-IDPGTO] Operação existente confirmada']='existing_confirmed'
a.CHECKPOINTS.add('existing_payment_confirmed_readonly')
CASES=json.loads((ROOT/'scripts/audit-payment-66-cases.json').read_text())
OUT=pathlib.Path('.payment-66-audit');OUT.mkdir(exist_ok=True)
END=int(time.time()*1000);START=END-7*86400000
def sha(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def read_case(case):
 company,ticket=case;deadline=time.monotonic()+140
 def aws(*args):return a.aws(*args,deadline=deadline)
 out={'company':company,'ticket':ticket,'observedUtc':dt.datetime.now(dt.timezone.utc).isoformat()}
 try:
  raw=aws('dynamodb','get-item','--table-name',a.TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':f'prod#PG#{company}#{ticket}'}})).get('Item',{})
  out['root']={k:raw[k].get('S',raw[k].get('N',raw[k].get('BOOL'))) for k in ['pk','state','pg','digest','protocolVersion','lockUntil','recuperadaCriacaoIncerta'] if k in raw}
  out['root']['exists']=bool(raw);out['rootSha256']=sha(raw)
  if 'continuation' in raw:
   c=json.loads(raw['continuation']['S']);out['root']['hasOwnReceipt']=bool(c.get('receipt'));out['root']['hasBaseline']=bool(c.get('baseline'));out['root']['progress']=c.get('progress',{})
  events=[];token=None;complete=False;pages=0
  for _ in range(3):
   args=['logs','filter-log-events','--log-group-name',a.GROUP,'--start-time',str(START),'--end-time',str(END),'--filter-pattern',f'"{ticket}"','--limit','200','--no-paginate']
   if token:args+=['--next-token',token]
   response=aws(*args);pages+=1
   for ev in response.get('events',[]):
    safe=a.sanitize(ev)
    if safe:events.append(safe)
   new=response.get('nextToken')
   if not new:complete=True;break
   if new==token:break
   token=new
  events.sort(key=lambda e:e['timestamp'])
  out['logWindow']={'startMs':START,'endMs':END,'complete':complete,'pages':pages,'sanitizedEventsFound':len(events),'retainedLast':min(35,len(events))}
  out['events']=events[-35:];out['complete']=True
 except Exception as err:out['error']=type(err).__name__
 (OUT/f'ticket-{ticket}.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
 print(json.dumps({'ticket':ticket,'rootState':out.get('root',{}).get('state'),'events':len(out.get('events',[])),'error':out.get('error')}),flush=True)
 return out
if __name__=='__main__':
 assert len(CASES)==66 and len({t for c,t in CASES})==66
 deadline=time.monotonic()+30
 assert a.aws('sts','get-caller-identity',deadline=deadline)['Account']==a.ACCOUNT
 cfg=a.aws('lambda','get-function-configuration','--function-name',a.FUNCTION,deadline=deadline)
 env=cfg.get('Environment',{}).get('Variables',{})
 assert env.get('STAGE')=='prod' and env.get('PAGAMENTO_IDPGTO_TABLE')==a.TABLE
 runtime={'observedUtc':dt.datetime.now(dt.timezone.utc).isoformat(),'function':a.FUNCTION,'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'state':cfg['State'],'lastUpdateStatus':cfg['LastUpdateStatus'],'financialWrites':False,'zeevWrites':False,'dynamoWrites':False,'lambdaInvocations':0}
 (OUT/'runtime.json').write_text(json.dumps(runtime,indent=2),encoding='utf-8')
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:results=list(ex.map(read_case,CASES))
 assert all(x.get('complete') for x in results),'INCOMPLETE_READONLY_AUDIT'
