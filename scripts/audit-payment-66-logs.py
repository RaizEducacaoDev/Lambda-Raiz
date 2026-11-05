"""Read historical diagnostics with CloudWatch Logs Insights; no business writes."""
import datetime as dt,importlib.util,json,pathlib,re,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('safe_audit',ROOT/'scripts/audit-payment-conflict-20261103-0609.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
a.AWS_READS=a.AWS_READS|{('logs','start-query'),('logs','get-query-results'),('logs','stop-query')}
a.LABELS['[RM-IDPGTO] Operação existente confirmada']='existing_confirmed';a.CHECKPOINTS.add('existing_payment_confirmed_readonly')
CASES=json.loads((ROOT/'scripts/audit-payment-66-cases.json').read_text());TICKETS={int(t) for c,t in CASES}
OUT=pathlib.Path('.payment-66-logs');OUT.mkdir(exist_ok=True)
deadline=time.monotonic()+230
def aws(*args):return a.aws(*args,deadline=deadline)
assert aws('sts','get-caller-identity')['Account']==a.ACCOUNT
end=int(time.time());start=end-10*86400
query='fields @timestamp, @message | filter @message like /ticket/ and @message like /'+ '|'.join(map(str,sorted(TICKETS)))+'/ | sort @timestamp desc | limit 10000'
qid=aws('logs','start-query','--log-group-name',a.GROUP,'--start-time',str(start),'--end-time',str(end),'--query-string',query)['queryId']
try:
 for _ in range(35):
  response=aws('logs','get-query-results','--query-id',qid)
  if response['status'] not in ('Scheduled','Running'):break
  time.sleep(4)
 assert response['status']=='Complete','LOG_QUERY_INCOMPLETE'
 grouped={t:[] for t in TICKETS}
 for result in response['results']:
  fields={f['field']:f['value'] for f in result}
  stamp=dt.datetime.fromisoformat(fields['@timestamp'].replace('Z','+00:00'))
  if stamp.tzinfo is None:stamp=stamp.replace(tzinfo=dt.timezone.utc)
  event=a.sanitize({'timestamp':int(stamp.timestamp()*1000),'message':fields.get('@message','')})
  if event and event.get('ticket') in TICKETS:grouped[event['ticket']].append(event)
 for ticket,events in grouped.items():
  events.sort(key=lambda e:e['timestamp'])
  out={'ticket':ticket,'startEpoch':start,'endEpoch':end,'queryStatus':'Complete','atResultLimit':len(response['results'])==10000,'sanitizedCount':len(events),'events':events}
  (OUT/f'ticket-{ticket}.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
 print(json.dumps({'queryComplete':True,'resultCount':len(response['results']),'statistics':response.get('statistics'),'sanitizedTotal':sum(len(v) for v in grouped.values()),'businessWrites':False}))
finally:
 if time.monotonic()>deadline-20 or response.get('status') in ('Scheduled','Running'):
  aws('logs','stop-query','--query-id',qid)
