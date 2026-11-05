"""Fixed production incident audit. AWS reads only; no invocation or business write.

CloudWatch is projected through the existing allowlist sanitizer. Runtime code is
transferred encrypted to the local incident key; configuration and secrets are
never serialized. This script has no mutation mode.
"""
import base64, collections, datetime as dt, hashlib, importlib.util, io, json, os
from pathlib import Path
import re, subprocess, time, urllib.request, urllib.parse, zipfile
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

FUNCTION='lambda-raiz-prod-solicitacaoDePagamento'
TABLE='lambda-raiz-prod-pagamento-idpgto'
ACCOUNT='757843862365';REGION='sa-east-1'
OUT=Path('.incident-payment-readonly');OUT.mkdir(exist_ok=False)
DEADLINE=time.monotonic()+600
READS={('sts','get-caller-identity'),('lambda','get-function'),('lambda','get-policy'),
       ('dynamodb','scan'),('apigateway','get-resources'),('apigateway','get-integration')}
KNOWN='YL4vIKotm0GuMQC1sMC8ellzldxJgi7tu9rT9m8EO2Q='
ENTRY='src/functions/rm/post/solicitacaoDePagamento.js'

def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def sha(x):return hashlib.sha256(x).hexdigest()
def sha64(x):return base64.b64encode(hashlib.sha256(x).digest()).decode()
def save(n,d):
    (OUT/n).write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf-8')
def read(service,operation,*args):
    assert (service,operation) in READS,'Read operation outside allowlist'
    assert time.monotonic()<DEADLINE,'Audit deadline exceeded'
    p=subprocess.run(['aws',service,operation,*args,'--region',REGION,'--output','json','--no-cli-pager',
        '--cli-connect-timeout','5','--cli-read-timeout','20'],capture_output=True,timeout=35)
    if p.returncode:raise RuntimeError('READ_UNAVAILABLE_'+service+'_'+operation)
    return json.loads(p.stdout)
def safe_cfg(c):
    return {k:c.get(k) for k in ['FunctionName','FunctionArn','CodeSha256','RevisionId','LastModified','Handler',
        'Runtime','Architectures','Timeout','MemorySize','State','LastUpdateStatus']}

def main():
    assert read('sts','get-caller-identity')['Account']==ACCOUNT
    active=read('lambda','get-function','--function-name',FUNCTION);cfg=active['Configuration']
    assert cfg['FunctionArn']==f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:{FUNCTION}'
    assert cfg.get('State')=='Active' and cfg.get('LastUpdateStatus')=='Successful'
    env=cfg.get('Environment',{}).get('Variables',{})
    assert env.get('STAGE')=='prod' and env.get('PAGAMENTO_IDPGTO_TABLE')==TABLE
    url=urllib.parse.urlparse(active['Code']['Location'])
    assert url.scheme=='https' and url.hostname.endswith('.amazonaws.com')
    with urllib.request.urlopen(active['Code']['Location'],timeout=35) as r:blob=r.read(64*1024*1024+1)
    assert len(blob)<=64*1024*1024 and sha64(blob)==cfg['CodeSha256']
    markers=['Integração bancária não confirmada; consultar o estado antes de reenviar',
        'IDPGTO e CODCOLPGTO são obrigatórios antes de criar o movimento',
        'Identificador bancário ou de destino ausente/inválido',
        'Ticket reservado com dados diferentes; reconciliar antes de prosseguir',
        'Criação RM incerta; requer reconciliação, nunca nova criação automática',
        'Aliases/chave bancária divergem do fornecedor ou destino']
    files=[];found=[];entry=None
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        normalized={}
        for info in z.infolist():
            if info.is_dir():continue
            n=info.filename.replace('\\','/');assert n not in normalized
            body=z.read(info);normalized[n]=body
            for key,value in env.items():
                if re.search('PASSWORD|TOKEN|SECRET|ACCESS_KEY',key,re.I) and len(value)>7:
                    assert value.encode() not in body,'Secret literal detected in package; no code exported'
            files.append({'path':n,'bytes':len(body),'sha256':sha(body)})
            if n.endswith(('.js','.cjs')):found.append({'path':n,'messagesPresent':{m:m in body.decode('utf-8','replace') for m in markers}})
        entry=normalized.get(ENTRY);assert entry
    compiled=Path('.build/incident-source.cjs').read_bytes()
    meta={'observedUtc':now(),'function':safe_cfg(cfg),'matchesLastVerifiedPackage':cfg['CodeSha256']==KNOWN,
        'entryMatchesPinnedSourceBuild':entry==compiled,'sourceRef':'c21a97afcffa0ee0298677d7fa435e55a427c6be',
        'files':files,'runtimeMessages':found,'awsWrites':False,'lambdaInvoked':False,'environmentExported':False}
    save('runtime.json',meta)
    key=AESGCM.generate_key(bit_length=256);nonce=os.urandom(12)
    public=serialization.load_pem_public_key(Path('.github/payment-incident-public.pem').read_bytes())
    wrapped=public.encrypt(key,padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
    encrypted=AESGCM(key).encrypt(nonce,blob,b'payment-incident-readonly-20261105')
    (OUT/'active-package.aesgcm').write_bytes(encrypted)
    save('envelope.json',{'wrappedKey':base64.b64encode(wrapped).decode(),'nonce':base64.b64encode(nonce).decode(),
        'encryptedSha256':sha(encrypted),'originalPackageCodeSha256':cfg['CodeSha256']})
    # Only root metadata from the dedicated payment table, never business snapshots.
    roots=[];last=None;scanned=0
    for page in range(100):
        args=['--table-name',TABLE,'--projection-expression','#pk,#st,pg,digest,lockUntil,protocolVersion',
            '--expression-attribute-names',json.dumps({'#pk':'pk','#st':'state'}),'--limit','250','--consistent-read','--no-paginate']
        if last:args+=['--exclusive-start-key',json.dumps(last)]
        response=read('dynamodb','scan',*args);scanned+=response.get('ScannedCount',0)
        for row in response.get('Items',[]):
            pk=row.get('pk',{}).get('S','')
            match=re.fullmatch(r'prod#PG#([1-9]\d*)#([1-9]\d*)',pk)
            if not match:continue
            clean={'pk':pk,'company':int(match[1]),'ticket':int(match[2])}
            for name in ['state','pg','digest','lockUntil','protocolVersion']:
                value=row.get(name,{})
                scalar=value.get('S',value.get('N'))
                if scalar is not None:clean[name]=scalar
            roots.append(clean)
        last=response.get('LastEvaluatedKey')
        if not last:break
    save('roots.json',{'observedUtc':now(),'roots':roots,'scannedItems':scanned,'complete':not bool(last)})
    spec=importlib.util.spec_from_file_location('sanitizer',Path('scripts/audit-payment-conflict-20261103-0609.py'))
    a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
    end=int(dt.datetime.now(dt.timezone.utc).timestamp()*1000)
    start=int(dt.datetime(2026,10,29,12,tzinfo=dt.timezone.utc).timestamp()*1000)
    projected=[];coverage=[]
    for pattern in ['"[RM-IDPGTO]" "Integração pendente"','"[RM-IDPGTO]" "Vínculo financeiro confirmado"']:
        events,cov=a.read_log_window(pattern,start,end,DEADLINE)
        projected += [s for e in events if (s:=a.sanitize(e)) is not None]
        coverage.append({'pattern':pattern,**cov})
    # Exact ticket windows provide phase/reason information without a payment retry.
    for ticket in [226927,224483,228007,223038,226862]:
        events,cov=a.read_log_window('"'+str(ticket)+'"',max(start,end-3*86400000),end,DEADLINE)
        projected += [s for e in events if (s:=a.sanitize(e)) is not None]
        coverage.append({'ticket':ticket,**cov})
    unique={(e['timestamp'],e.get('requestId'),e.get('kind'),e.get('event')):e for e in projected}
    events=sorted(unique.values(),key=lambda e:e['timestamp'])
    save('events.json',{'observedUtc':now(),'windowStartMs':start,'windowEndMs':end,'coverage':coverage,'events':events})
    routes=[]
    try:
        policy=json.loads(read('lambda','get-policy','--function-name',FUNCTION)['Policy'])
        apis=sorted(set(re.findall(r':execute-api:'+REGION+':'+ACCOUNT+r':([a-z0-9]+)/',json.dumps(policy))))
        for api in apis[:5]:
            resources=read('apigateway','get-resources','--rest-api-id',api).get('items',[])
            for resource in resources:
                if resource.get('path')!='/solicitacaoDePagamento':continue
                target=read('apigateway','get-integration','--rest-api-id',api,'--resource-id',resource['id'],'--http-method','POST')
                uri=target.get('uri','');m=re.search(r'arn:aws:lambda:[^/]+:function:([^/]+)/invocations',uri)
                routes.append({'api':api,'path':resource['path'],'functionTarget':m.group(1) if m else None})
    except Exception as error:routes.append({'readUnavailable':type(error).__name__})
    save('routes.json',routes)
    final=read('lambda','get-function','--function-name',FUNCTION)['Configuration']
    assert final['CodeSha256']==cfg['CodeSha256'] and final['RevisionId']==cfg['RevisionId'],'Runtime changed during audit'
    pending=[e for e in events if e.get('kind')=='payment_pending']
    summary={'completedUtc':now(),'awsWrites':False,'lambdaInvoked':False,'runtimeUnchangedDuringAudit':True,
        'activeCodeSha256':cfg['CodeSha256'],'entryMatchesPinnedSourceBuild':entry==compiled,
        'pendingEvents':len(pending),'pendingDistinctTickets':len({e.get('ticket') for e in pending if e.get('ticket')}),
        'pendingByStatus':dict(collections.Counter(str(e.get('status')) for e in pending)),
        'rootCountsByState':dict(collections.Counter(r.get('state') for r in roots)),
        'logCoverageComplete':all(c.get('complete') for c in coverage)}
    save('summary.json',summary);print(json.dumps(summary))

if __name__=='__main__':
    try:main()
    except Exception as error:
        save('failure.json',{'observedUtc':now(),'errorType':type(error).__name__,'awsWrites':False,'lambdaInvoked':False})
        raise SystemExit('Read-only incident audit stopped; inspect sanitized evidence') from None
