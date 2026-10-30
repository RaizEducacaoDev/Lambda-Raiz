"""Read-only recent CREATING failures; export only identifiers and diagnostics."""
import datetime,json,pathlib,re,subprocess
FUNCTION='lambda-raiz-prod-solicitacaoDePagamento';outdir=pathlib.Path('.idpgto-recurrence');outdir.mkdir(exist_ok=True)
def aws(*args):
 r=subprocess.run(['aws',*args,'--output','json'],capture_output=True,text=True)
 if r.returncode:
  m=re.search(r'An error occurred \(([^)]+)\)',r.stderr)
  raise RuntimeError('AWS read failed: '+(m.group(1) if m else 'CLI_ERROR'))
 return json.loads(r.stdout or '{}')
assert aws('sts','get-caller-identity')['Account']=='757843862365'
cfg=aws('lambda','get-function-configuration','--function-name',FUNCTION)
start=int((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=30)).timestamp()*1000)
events=aws('logs','filter-log-events','--log-group-name','/aws/lambda/'+FUNCTION,'--start-time',str(start),
 '--filter-pattern','"[RM-IDPGTO]" "CREATING"').get('events',[])
uuid=r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
def numeric(message,name):
 m=re.search(r'\b'+name+r'[\'\"]?\s*:\s*[\'\"]?([1-9]\d*)\b',message)
 return int(m.group(1)) if m else None
tickets=set();requests=set();all_events=[]
for event in events[:20]:
 message=event.get('message','');ticket=numeric(message,'ticket')
 if ticket:tickets.add(ticket)
 rid=re.search(uuid,message,re.I)
 if not rid:continue
 requests.add(rid.group());ts=event['timestamp']
 nearby=aws('logs','get-log-events','--log-group-name','/aws/lambda/'+FUNCTION,'--log-stream-name',event['logStreamName'],
  '--start-time',str(ts-60000),'--end-time',str(ts+5000),'--start-from-head').get('events',[])
 all_events.extend(e for e in nearby if rid.group() in e.get('message',''))
safe=[];seen=set()
for event in sorted(all_events,key=lambda e:e['timestamp']):
 message=event.get('message','');key=(event['timestamp'],message)
 if key in seen:continue
 seen.add(key);rid=re.search(uuid,message,re.I)
 row={'timestamp':event['timestamp'],'requestId':rid.group() if rid else None}
 if '[RM-DIAG]' in message:
  row['kind']='diagnostic'
  try:
   d=json.loads(message.split('[RM-DIAG]',1)[1].strip())
   row['data']={k:v for k,v in d.items() if k in ['ticket','coligada','filial','codTmv','etapa','evento','resultado','duracaoMs','idMov','errorType','errorCode']}
  except ValueError:row['parseable']=False
 elif '[RM-IDPGTO]' in message or '[RM-ERRO]' in message:
  row['kind']='payment_error';row['ticket']=numeric(message,'ticket')
  for field in ['state','pg','status','errorType','errorCode','category','length']:
   m=re.search(r'\b'+field+r'[\'\"]?\s*:\s*[\'\"]?([A-Za-z0-9_-]+)',message)
   if m:row[field]=m.group(1)
  row['nonKeyResult']='Retorno de criação sem chave confirmada' in message
 elif 'REPORT RequestId:' in message:
  row['kind']='report'
  m=re.search(r'\bDuration:\s*([\d.]+)',message)
  if m:row['durationMs']=float(m.group(1))
 elif 'START RequestId:' in message:
  row['kind']='start';m=re.search(r'Version:\s*(\S+)',message)
  if m:row['version']=m.group(1)
 elif 'END RequestId:' in message:row['kind']='end'
 else:continue
 safe.append(row)
out={'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'businessWrites':False,
 'function':{k:cfg.get(k) for k in ['FunctionName','CodeSha256','RevisionId','LastUpdateStatus','Timeout','Runtime','LastModified']},
 'windowStartMs':start,'candidateTickets':sorted(tickets),'matchedFailureEvents':len(events),'requestIds':sorted(requests),'events':safe}
stage=cfg.get('Environment',{}).get('Variables',{}).get('STAGE','dev')
table=cfg.get('Environment',{}).get('Variables',{}).get('PAGAMENTO_IDPGTO_TABLE')
assert table=='lambda-raiz-prod-pagamento-idpgto'
targets={(str(e['data']['coligada']),str(e['data']['ticket'])) for e in safe if e.get('kind')=='diagnostic'
 and str(e.get('data',{}).get('coligada','')).isdigit() and str(e.get('data',{}).get('ticket','')).isdigit()}
out['reservations']=[]
for company,ticket in sorted(targets):
 key=f'{stage}#PG#{company}#{ticket}'
 item=aws('dynamodb','get-item','--table-name',table,'--consistent-read','--key',json.dumps({'pk':{'S':key}})).get('Item',{})
 out['reservations'].append({'key':key,'exists':bool(item),'record':{k:next(iter(v.values())) for k,v in item.items()
  if k in ['pk','digest','owner','lockUntil','state','pg']}})
(outdir/'recurrence-readback.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps(out,ensure_ascii=False,indent=2))
