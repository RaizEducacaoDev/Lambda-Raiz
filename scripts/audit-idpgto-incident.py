"""Read-only correlation of a pending payment and sanitized Lambda logs."""
import datetime,json,pathlib,re,subprocess
FUNCTION='lambda-raiz-prod-solicitacaoDePagamento';TABLE='lambda-raiz-prod-pagamento-idpgto'
TICKET='228130';COMPANY='31';IDLAN='470'
outdir=pathlib.Path('.idpgto-incident');outdir.mkdir(exist_ok=True)
def aws(*args):
    r=subprocess.run(['aws',*args,'--output','json'],capture_output=True,text=True)
    if r.returncode:
        m=re.search(r'An error occurred \(([^)]+)\)',r.stderr)
        raise RuntimeError(f'AWS {args[0]}/{args[1]} failed: {m.group(1) if m else "CLI_ERROR"}')
    return json.loads(r.stdout or '{}')
assert aws('sts','get-caller-identity')['Account']=='757843862365'
cfg=aws('lambda','get-function-configuration','--function-name',FUNCTION)
assert cfg['FunctionName']==FUNCTION
stage=cfg.get('Environment',{}).get('Variables',{}).get('STAGE','dev')
assert cfg.get('Environment',{}).get('Variables',{}).get('PAGAMENTO_IDPGTO_TABLE')==TABLE
out={'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ticket':int(TICKET),'company':int(COMPANY),
     'function':{k:cfg.get(k) for k in ['FunctionName','CodeSha256','RevisionId','LastUpdateStatus','Timeout','Runtime']},
     'businessWrites':False,'reservations':[]}
for suffix in ['',f'#FLAN#{IDLAN}']:
    key=f'{stage}#PG#{COMPANY}#{TICKET}{suffix}'
    item=aws('dynamodb','get-item','--table-name',TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':key}})).get('Item')
    safe={k:next(iter(v.values())) for k,v in (item or {}).items() if k in ['pk','digest','owner','lockUntil','state','pg']}
    out['reservations'].append({'key':key,'exists':bool(item),'record':safe})
start=int((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=2)).timestamp()*1000)
matching=aws('logs','filter-log-events','--log-group-name','/aws/lambda/'+FUNCTION,'--start-time',str(start),
    '--filter-pattern',f'"{TICKET}"').get('events',[])
uuid=r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
request_ids=set();streams={}
for event in matching:
    request_ids.update(re.findall(uuid,event.get('message',''),re.I))
    stream=event['logStreamName'];streams.setdefault(stream,[]).append(event['timestamp'])
events={e.get('eventId',str(e['timestamp'])):e for e in matching}
for stream,times in streams.items():
    more=aws('logs','get-log-events','--log-group-name','/aws/lambda/'+FUNCTION,'--log-stream-name',stream,
        '--start-time',str(min(times)-10000),'--end-time',str(max(times)+35000),'--start-from-head')
    for event in more.get('events',[]):
        if any(rid in event.get('message','') for rid in request_ids):
            events[str(event['timestamp'])+event.get('message','')[:110]]=event
safe_events=[];seen=set()
known=['socket hang up','ECONNRESET','ETIMEDOUT','ECONNABORTED','AbortError','CanceledError','TimeoutError',
 'Criação RM de resultado incerto','Criação não confirmada','ConditionalCheckFailedException','SOAP RM inválido',
 'Resultado SOAP RM ausente','Tempo insuficiente','Cannot read properties','Request failed with status code']
for event in sorted(events.values(),key=lambda e:e['timestamp']):
    message=event.get('message','');signature=(event['timestamp'],message)
    if signature in seen:continue
    seen.add(signature)
    rid=next((v for v in re.findall(uuid,message,re.I) if v in request_ids),None)
    safe={'timestamp':event['timestamp'],'requestId':rid}
    if '[RM-DIAG]' in message:
        safe['category']='diagnostic'
        try:
            data=json.loads(message.split('[RM-DIAG]',1)[1].strip())
            safe['diagnostic']={k:v for k,v in data.items() if k in ['ticket','coligada','filial','codTmv','etapa','evento','resultado','duracaoMs','idMov','codigo']}
        except ValueError:safe['parseable']=False
    elif '[RM-ERRO]' in message or '[RM-IDPGTO]' in message:
        safe['category']='bank_protocol' if '[RM-IDPGTO]' in message else 'core_error'
        safe['knownCauses']=[v for v in known if v in message]
        match=re.search(r'timeout of (\d+)ms exceeded',message)
        if match:safe['timeoutMs']=int(match.group(1))
        for name in ['state','pg','status','errorType']:
            match=re.search(r'\b'+name+r'[\'\"]?\s*:\s*[\'\"]?([A-Za-z0-9_-]+)',message)
            if match:safe[name]=match.group(1)
    elif 'REPORT RequestId:' in message:
        safe['category']='lambda_report'
        for name,pattern in [('durationMs',r'Duration:\s*([\d.]+)\s*ms'),('billedDurationMs',r'Billed Duration:\s*([\d.]+)\s*ms'),('maxMemoryMb',r'Max Memory Used:\s*(\d+)\s*MB')]:
            match=re.search(pattern,message)
            if match:safe[name]=float(match.group(1))
    elif '[RM-INFO]' in message:safe['category']='core_info'
    elif 'START RequestId:' in message:safe['category']='lambda_start'
    elif 'END RequestId:' in message:safe['category']='lambda_end'
    else:safe['category']='other_related_event'
    safe_events.append(safe)
out['matchingEvents']=len(matching);out['requestIds']=sorted(request_ids);out['events']=safe_events
(outdir/'incident-readback.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps(out,ensure_ascii=False,indent=2))
