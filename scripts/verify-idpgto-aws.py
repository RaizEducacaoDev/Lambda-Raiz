"""Independent readback of deployed code, durable checkpoints and HTTP route."""
import datetime,json,pathlib,re,subprocess,urllib.request,urllib.error

FUNCTION='lambda-raiz-prod-solicitacaoDePagamento'
TABLE='lambda-raiz-prod-pagamento-idpgto'
EXPECTED_ACCOUNT='757843862365'
out=pathlib.Path('.idpgto-readback');out.mkdir(exist_ok=True)
def aws(*args):
    r=subprocess.run(['aws',*args,'--output','json'],capture_output=True,text=True)
    if r.returncode:
        m=re.search(r'An error occurred \(([^)]+)\)',r.stderr)
        raise RuntimeError(f'AWS {args[0]}/{args[1]}: {m.group(1) if m else "CLI_ERROR"}')
    return json.loads(r.stdout or '{}')
assert aws('sts','get-caller-identity')['Account']==EXPECTED_ACCOUNT
cfg=aws('lambda','get-function-configuration','--function-name',FUNCTION)
assert cfg['CodeSha256']=='9Du9JUQuUp2gOgh4Kx45+7W3pWFgZIYWHn0W87A+HCE='
assert cfg['State']=='Active' and cfg['LastUpdateStatus']=='Successful'
assert cfg['Environment']['Variables']['PAGAMENTO_IDPGTO_TABLE']==TABLE
proof={'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'function':FUNCTION,
    'activeCodeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'lastUpdateStatus':cfg['LastUpdateStatus']}
proof['table']=aws('dynamodb','describe-table','--table-name',TABLE)['Table']['TableStatus']
proof['ttl']=aws('dynamodb','describe-time-to-live','--table-name',TABLE)['TimeToLiveDescription']['TimeToLiveStatus']
assert proof['table']=='ACTIVE' and proof['ttl']=='DISABLED'
proof['pitr']=aws('dynamodb','describe-continuous-backups','--table-name',TABLE)['ContinuousBackupsDescription']['PointInTimeRecoveryDescription']['PointInTimeRecoveryStatus']
assert proof['pitr']=='ENABLED'
stage=cfg['Environment']['Variables'].get('STAGE','dev')
proof['checkpoints']=[]
for suffix in ['', '#FLAN#467']:
    row=aws('dynamodb','get-item','--table-name',TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':f'{stage}#PG#31#227324{suffix}'}}))['Item']
    assert row['state']['S']=='COMPLETE' and row['pg']['S']=='452'
    proof['checkpoints'].append({'scope':'FLAN467' if suffix else 'ticket227324','state':row['state']['S'],'idMov':row['pg']['S']})

policy=json.loads(aws('lambda','get-policy','--function-name',FUNCTION)['Policy'])
api_ids=set(re.findall(r':execute-api:sa-east-1:'+EXPECTED_ACCOUNT+r':([a-z0-9]+)/',json.dumps(policy)))
proof['httpRoutes']=[]
for api in sorted(api_ids):
    resources=aws('apigateway','get-resources','--rest-api-id',api).get('items',[])
    for resource in resources:
        if resource.get('path')!='/solicitacaoDePagamento':continue
        integration=aws('apigateway','get-integration','--rest-api-id',api,'--resource-id',resource['id'],'--http-method','POST')
        target=integration.get('uri','')
        assert f':function:{FUNCTION}/invocations' in target,'Route targets a different function/version'
        stages=aws('apigateway','get-stages','--rest-api-id',api).get('item',[])
        assert any(s['stageName']=='prod' for s in stages)
        url=f'https://{api}.execute-api.sa-east-1.amazonaws.com/prod/solicitacaoDePagamento'
        event={'tipoDaSolicitacao':'PG','ticketRaiz':'999999990002','codigoDaColigada2':'31',
            'codigoDaFilial2':'1','codigoDoFornecedor':'0000173261'}
        request=urllib.request.Request(url,data=json.dumps(event).encode(),headers={'Content-Type':'application/json'})
        try:
            response=urllib.request.urlopen(request,timeout=30);status=response.status;body=json.loads(response.read())
        except urllib.error.HTTPError as exc:
            status=exc.code;body=json.loads(exc.read())
        assert status==422 and body.get('code')=='IDPGTO_NAO_CONFIRMADO','HTTP route did not enforce IDPGTO guard'
        proof['httpRoutes'].append({'api':api,'path':'/prod/solicitacaoDePagamento','targetUnqualified':True,
            'invalidPaymentHttpStatus':status,'errorCode':body['code']})
assert proof['httpRoutes'],'No payment HTTP route independently verified'
(out/'aws-final-readback.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof,indent=2))
