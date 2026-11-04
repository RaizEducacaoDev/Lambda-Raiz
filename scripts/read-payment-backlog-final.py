"""Pinned final audit. Read only: no Invoke, PutItem, UpdateItem or SaveRecord.

Raw RM records and Lambda credentials remain in memory. Export only scoped
financial identifiers, amounts/dates/status and fixed control classifications.
The paginated scan is not an atomic snapshot; every discovered root is reread.
"""
import argparse
import base64
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ACCOUNT = '757843862365'
REGION = 'sa-east-1'
FUNCTION = 'lambda-raiz-prod-solicitacaoDePagamento'
TABLE = 'lambda-raiz-prod-pagamento-idpgto'
HOST = 'https://raizeducacao160286.rm.cloudtotvs.com.br:8051'
PIN = {'codeSha256': 'ECffjgl6BpvRQrtHh3+O++D7/SAvTGAe8r9XTJqJIKE=',
       'revisionId': '29524d8b-327d-4389-a7ed-cab0b04aae2e'}
CASES = ((1,214960),(1,225136),(1,225374),(1,228367),(2,225573),(2,226025),(2,228793),
 (5,223287),(5,224647),(5,228007),(6,225868),(8,226348),(8,226698),(8,226756),(8,228103),
 (8,228158),(8,228198),(8,228275),(9,226455),(9,227147),(10,225233),(10,226345),(10,226356),
 (11,226530),(11,226927),(11,228310),(11,228417),(12,227585),(12,227991),(17,228287),
 (18,213291),(18,226925),(18,227386),(18,227440),(18,227449),(18,227574),(18,228634),(25,226610),(26,223885))
# ticket -> company, movement, launch, expected IDPGTO, expected CODCOLPGTO
BANK_TARGETS = {228007:(5,165611,634500,1,5),227386:(18,407685,2191110,7,18),
 226610:(25,42677,79094,5,25),228103:(8,565011,870364,24,8),228158:(8,565012,870365,24,8),
 228198:(8,565013,870366,24,8),228275:(8,565014,870367,24,8),228793:(2,278473,751379,7,2),
 226925:(18,407691,2193388,2,18)}
STATES = {'RESERVED','CREATING','CREATED','UPDATING','COMPLETE'}
READS = {('sts','get-caller-identity'),('lambda','get-function-configuration'),
         ('dynamodb','get-item'),('dynamodb','scan')}
ATTRS = ('pk','state','pg','protocolVersion','lockUntil','recuperadaCriacaoIncerta','reconciliationEvidenceKey')
NAMES = {f'#a{i}':name for i,name in enumerate(ATTRS)}
PROJECTION = ','.join(NAMES)


class AuditError(Exception): pass


def require(ok, code):
    if not ok: raise AuditError(code)


def utc(): return dt.datetime.now(dt.timezone.utc).isoformat()
def packed(value): return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def fingerprint(value): return hashlib.sha256(packed(value).encode()).hexdigest()
def root_key(company,ticket): return f'prod#PG#{company}#{ticket}'


def integer(value, zero=False, optional=False):
    if optional and value in (None,'',0,'0'): return None
    require(not isinstance(value,bool) and isinstance(value,(str,int)) and
            re.fullmatch(r'0|[1-9]\d{0,15}' if zero else r'[1-9]\d{0,15}',str(value)), 'INVALID_NUMERIC_IDENTIFIER')
    return int(value)


def decimal(value):
    require(isinstance(value,(str,int)) and not isinstance(value,bool),'INVALID_AMOUNT')
    text=str(value)
    if ',' in text: text=text.replace('.','').replace(',','.')
    require(re.fullmatch(r'-?\d{1,15}(?:\.\d{1,6})?',text),'INVALID_AMOUNT')
    try:
        result=Decimal(text)
        require(result.is_finite(),'INVALID_AMOUNT')
        return format(result.normalize(),'f') if result else '0'
    except InvalidOperation: raise AuditError('INVALID_AMOUNT') from None


def date(value):
    if value in (None,''): return None
    require(isinstance(value,str),'INVALID_DATE')
    text=value.split('T')[0].split(' ')[0]
    try: return dt.date.fromisoformat(text).isoformat()
    except ValueError: raise AuditError('INVALID_DATE') from None


def root_summary(item, company, ticket):
    if not item: return {'exists':False,'state':'ABSENT','classification':'ROOT_ABSENT'}
    require(item.get('pk')=={'S':root_key(company,ticket)},'ROOT_IDENTITY_MISMATCH')
    require(set(item)<=set(ATTRS),'UNPROJECTED_ROOT_ATTRIBUTES')
    state=item.get('state',{}).get('S')
    require(state is None or state in STATES,'UNKNOWN_ROOT_STATE')
    pg=integer(item.get('pg',{}).get('S'),optional=True)
    protocol=integer(item.get('protocolVersion',{}).get('N'),optional=True)
    lock=integer(item.get('lockUntil',{}).get('N'),optional=True)
    active=lock is not None and lock>int(time.time()*1000)
    classification=('COMPLETE' if state=='COMPLETE' else 'LEASE_ACTIVE' if active else
      'RESERVED_V2_WITHOUT_MOVEMENT' if state=='RESERVED' and protocol==2 and pg is None else
      'EXISTING_MOVEMENT_PENDING' if pg is not None else
      'CREATION_UNCERTAIN' if state=='CREATING' else
      'LEGACY_RESERVATION_PENDING' if state=='RESERVED' else 'CONTROL_REVIEW_REQUIRED')
    recovered=item.get('recuperadaCriacaoIncerta')
    require(recovered is None or type(recovered.get('BOOL')) is bool,'INVALID_RECOVERY_FLAG')
    return {'exists':True,'state':state or 'UNSPECIFIED','protocolVersion':protocol,'idMov':pg,
      'leaseActive':active,'hasReconciliationEvidence':'reconciliationEvidenceKey' in item,
      'recoveredCreation':recovered.get('BOOL',False) if recovered else False,'classification':classification}


def retry_summary(rows, company, ticket):
    require(isinstance(rows,list) and 0<len(rows)<=10000,'RETRY_RESPONSE_INVALID_OR_TOO_LARGE')
    movements=[];launches=[];totals=None
    for row in rows:
        require(row.get('RETOMADA_VERSION')==1 and row.get('REQUEST_COMPANY')==company and
                row.get('REQUEST_TICKET')==str(ticket),'RETRY_SCOPE_MISMATCH')
        count=(row.get('TOTAL_MOVEMENTS'),row.get('TOTAL_LAUNCHES'))
        require(all(type(n) is int and n>=0 for n in count) and (totals is None or totals==count),'RETRY_TOTALS_INVALID')
        totals=count;kind=row.get('ROW_KIND')
        if kind=='EMPTY':
            require(len(rows)==1 and totals==(0,0) and row.get('IDMOV') is None and row.get('IDLAN') is None,'RETRY_EMPTY_INVALID')
            continue
        require(kind in ('MOV','LAN'),'RETRY_KIND_INVALID')
        record={'company':integer(row.get('CODCOLIGADA')),'idMov':integer(row.get('IDMOV'))}
        if kind=='LAN':
            record.update(idLan=integer(row.get('IDLAN')),boletoCount=integer(row.get('BOLETO_COUNT'),zero=True))
            launches.append(record)
        else: movements.append(record)
    require(totals==(len(movements),len(launches)),'RETRY_TRUNCATED')
    mk={(r['company'],r['idMov']) for r in movements};lk={(r['company'],r['idLan']) for r in launches}
    require(len(mk)==len(movements) and len(lk)==len(launches),'RETRY_DUPLICATE_IDS')
    require(all((r['company'],r['idMov']) in mk for r in launches),'RETRY_ORPHAN_LAUNCH')
    return {'movementCount':len(movements),'launchCount':len(launches),
      'movements':sorted(movements,key=lambda r:(r['company'],r['idMov'])),
      'launches':sorted(launches,key=lambda r:(r['company'],r['idLan'])),
      'foreignCompanyFound':any(r['company']!=company for r in movements),
      'zeroDoesNotProveRollback':True}


def bank_summary(row,ticket):
    company,mov,lan,bank,bankcol=BANK_TARGETS[ticket]
    require(tuple(integer(row.get(k)) for k in ('CODCOLIGADA','IDMOV','IDLAN'))==(company,mov,lan),'FINLAN_EXACT_TARGET_MISMATCH')
    result={'company':company,'idMov':mov,'idLan':lan,
      'idPgto':integer(row.get('IDPGTO'),optional=True),'bankCompany':integer(row.get('CODCOLPGTO'),optional=True),
      'status':integer(row.get('STATUSLAN'),zero=True),'originalAmount':decimal(row.get('VALORORIGINAL')),
      'paidAmount':decimal(row.get('VALORBAIXADO')),'pendingPayment':integer(row.get('BAIXAPENDENTE'),zero=True),
      'boletoId':integer(row.get('IDBOLETO'),optional=True),
      'dates':{key:date(row.get(key)) for key in ('DATAEMISSAO','DATAVENCIMENTO','DATABAIXA','DATAPREVBAIXA')}}
    result['expectedBank']={'idPgto':bank,'bankCompany':bankcol}
    result['bankMatchesExpected']=(result['idPgto'],result['bankCompany'])==(bank,bankcol)
    return result


def control_assessment(control,native):
    movements=native['movements'];launches=native['launches'];pg=control.get('idMov')
    if native['foreignCompanyFound']: return 'FOREIGN_COMPANY_EFFECT_REQUIRES_REVIEW'
    if len(movements)>1: return 'MULTIPLE_MOVEMENTS_REQUIRE_REVIEW'
    if not control['exists']: return 'RM_EFFECT_WITHOUT_ROOT' if movements or launches else 'ROOT_ABSENT_NO_TICKET_EFFECT'
    if pg is not None and not any(row['idMov']==pg for row in movements): return 'ROOT_MOVEMENT_NOT_FOUND_BY_TICKET'
    if control['state']=='COMPLETE': return 'COMPLETE_WITH_NATIVE_CHAIN' if pg is not None and len(movements)==1 and launches else 'COMPLETE_WITHOUT_FULL_NATIVE_CHAIN'
    if movements: return 'EXISTING_NATIVE_CHAIN_PENDING'
    if control['state']=='CREATING': return 'UNCERTAIN_CREATION_ZERO_IS_NOT_ROLLBACK'
    if control['state']=='RESERVED' and control.get('protocolVersion')==2 and pg is None: return 'RESERVED_FOR_NORMAL_SUBMISSION'
    return 'CONTROL_REVIEW_REQUIRED'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): raise AuditError('HTTP_REDIRECT_REJECTED')


class Reader:
    def __init__(self): self.deadline=time.monotonic()+1200;self.auth=None;self.user=None

    def aws(self,service,operation,payload):
        require((service,operation) in READS,'AWS_OPERATION_FORBIDDEN')
        if service=='lambda': require(payload=={'FunctionName':FUNCTION},'AWS_FUNCTION_NOT_ALLOWLISTED')
        if service=='dynamodb':
            require(payload.get('TableName')==TABLE and payload.get('ConsistentRead') is True and
              payload.get('ProjectionExpression')==PROJECTION and payload.get('ExpressionAttributeNames')==NAMES,'AWS_READ_SCOPE_INVALID')
        remaining=self.deadline-time.monotonic();require(remaining>2,'AUDIT_TIME_BUDGET_EXHAUSTED')
        try:
            process=subprocess.run(['aws',service,operation,'--region',REGION,'--cli-input-json',json.dumps(payload),
              '--no-paginate','--output','json','--no-cli-pager','--cli-connect-timeout','5','--cli-read-timeout','20'],
              capture_output=True,text=True,timeout=min(30,remaining),
              env={**os.environ,'AWS_MAX_ATTEMPTS':'1','AWS_RETRY_MODE':'standard','AWS_PAGER':''})
        except subprocess.TimeoutExpired: raise AuditError('AWS_READ_TIMEOUT') from None
        require(process.returncode==0,'AWS_READ_FAILED')
        try: return json.loads(process.stdout or '{}')
        except ValueError: raise AuditError('AWS_READ_INVALID_JSON') from None

    def pin(self):
        require(self.aws('sts','get-caller-identity',{}).get('Account')==ACCOUNT,'AWS_ACCOUNT_MISMATCH')
        cfg=self.aws('lambda','get-function-configuration',{'FunctionName':FUNCTION})
        runtime={'codeSha256':cfg.get('CodeSha256'),'revisionId':cfg.get('RevisionId')}
        require(runtime==PIN and cfg.get('State')=='Active' and cfg.get('LastUpdateStatus')=='Successful','ACTIVE_RUNTIME_PIN_MISMATCH')
        env=cfg.get('Environment',{}).get('Variables',{})
        require(env.get('STAGE')=='prod' and env.get('PAGAMENTO_IDPGTO_TABLE')==TABLE and
          env.get('RM_PROD','').rstrip('/')==HOST.replace(':8051',''),'RUNTIME_ENVIRONMENT_MISMATCH')
        require(bool(env.get('USERNAME_TOTVS')) and bool(env.get('PASSWORD_TOTVS')),'RM_CREDENTIALS_MISSING')
        self.user=env['USERNAME_TOTVS']
        self.auth='Basic '+base64.b64encode((self.user+':'+env['PASSWORD_TOTVS']).encode()).decode()
        return runtime

    def get(self,company,ticket):
        integer(company);integer(ticket)
        return self.aws('dynamodb','get-item',{'TableName':TABLE,'ConsistentRead':True,
          'Key':{'pk':{'S':root_key(company,ticket)}},'ProjectionExpression':PROJECTION,
          'ExpressionAttributeNames':NAMES}).get('Item',{})

    def inventory(self):
        items={};seen=set();cursor=None;scanned=0;ignored=0
        for page in range(1,5001):
            payload={'TableName':TABLE,'ConsistentRead':True,'Limit':500,'ProjectionExpression':PROJECTION,
              'ExpressionAttributeNames':NAMES,'FilterExpression':'begins_with(#a0, :prefix) AND (attribute_not_exists(#a1) OR #a1 <> :complete)',
              'ExpressionAttributeValues':{':prefix':{'S':'prod#PG#'},':complete':{'S':'COMPLETE'}}}
            if cursor: payload['ExclusiveStartKey']=cursor
            result=self.aws('dynamodb','scan',payload)
            require(isinstance(result.get('Items'),list),'SCAN_ITEMS_MISSING')
            count=result.get('ScannedCount');require(type(count) is int and count>=0,'SCAN_COUNT_INVALID');scanned+=count
            require(scanned<=1000000,'SCAN_SAFETY_BOUND_REACHED')
            for item in result['Items']:
                match=re.fullmatch(r'prod#PG#([1-9]\d{0,15})#([1-9]\d{0,15})',item.get('pk',{}).get('S',''))
                if not match: ignored+=1;continue
                key=tuple(map(int,match.groups()));require(key not in items,'SCAN_DUPLICATE_ROOT')
                items[key]=item
            cursor=result.get('LastEvaluatedKey')
            if not cursor: return items,{'complete':True,'pages':page,'scannedItems':scanned,'ignoredNonRootControlItems':ignored,'atomicSnapshot':False}
            signature=fingerprint(cursor);require(signature not in seen,'SCAN_CURSOR_REPEATED');seen.add(signature)
        raise AuditError('SCAN_PAGE_LIMIT')

    def http(self,url,data=None,action=None):
        require(self.auth is not None,'RM_NOT_INITIALIZED')
        allowed_get=url.startswith(HOST+'/api/framework/v1/consultaSQLServer/RealizaConsulta/RAIZ.PG.RETRY/0/T?')
        allowed_post=url==HOST+'/wsDataServer/IwsDataServer' and isinstance(data,bytes) and b'<ReadRecord ' in data and b'SaveRecord' not in data
        require((data is None and allowed_get) or allowed_post,'RM_ROUTE_NOT_READ_ONLY')
        headers={'Authorization':self.auth,'Accept':'application/json' if data is None else 'text/xml'}
        if data is not None: headers.update({'Content-Type':'text/xml;charset=UTF-8','SOAPAction':action})
        try:
            with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(url,data=data,headers=headers),timeout=20) as response:
                raw=response.read(8000001)
        except urllib.error.HTTPError as error: raise AuditError('RM_HTTP_'+str(error.code)) from None
        except (urllib.error.URLError,TimeoutError): raise AuditError('RM_READ_NETWORK_FAILURE') from None
        require(len(raw)<=8000000,'RM_RESPONSE_TOO_LARGE');return raw

    def read_record(self,server,key,company):
        require(server in ('FinLanDataBR','GlbConsSQLData'),'DATASERVER_NOT_ALLOWLISTED')
        if server=='GlbConsSQLData': require(key=='0;T;RAIZ.PG.RETRY' and company==0,'QUERY_CONTRACT_SCOPE_INVALID')
        else: require((company,key) in {(c,f'{c};{lan}') for c,_,lan,_,_ in BANK_TARGETS.values()},'FINLAN_NOT_ALLOWLISTED')
        envelope=ET.Element('{http://schemas.xmlsoap.org/soap/envelope/}Envelope');body=ET.SubElement(envelope,'{http://schemas.xmlsoap.org/soap/envelope/}Body')
        operation=ET.SubElement(body,'ReadRecord',xmlns='http://www.totvs.com/')
        for name,value in {'DataServerName':server,'PrimaryKey':key,'Contexto':f'CODCOLIGADA={company};CODSISTEMA={"G" if server=="GlbConsSQLData" else "F"};CODUSUARIO={self.user}'}.items():
            ET.SubElement(operation,name).text=value
        raw=self.http(HOST+'/wsDataServer/IwsDataServer',ET.tostring(envelope),'http://www.totvs.com/IwsDataServer/ReadRecord')
        require(b'<!DOCTYPE' not in raw.upper() and b'<!ENTITY' not in raw.upper(),'XML_DECLARATION_REJECTED')
        result=ET.fromstring(raw).find('.//{http://www.totvs.com/}ReadRecordResult')
        require(result is not None and result.text,'NATIVE_READ_RESULT_MISSING')
        require('<!DOCTYPE' not in result.text.upper() and '<!ENTITY' not in result.text.upper(),'XML_DECLARATION_REJECTED')
        dataset=ET.fromstring(result.text);tag='FLAN' if server=='FinLanDataBR' else 'GConsSql'
        rows=[{child.tag:child.text or '' for child in node} for node in dataset.iter(tag)]
        require(len(rows)==1,'NATIVE_RECORD_NOT_UNIQUE');return rows[0]

    def contract(self):
        record=self.read_record('GlbConsSQLData','0;T;RAIZ.PG.RETRY',0)
        normalize=lambda s:s.replace('\r\n','\n').replace('\r','\n').strip()
        expected=normalize((ROOT/'sql/pagamento-retomada.sql').read_text(encoding='utf-8-sig'))
        require(normalize(record.get('SENTENCA',''))==expected,'RETRY_CONTRACT_CHANGED')
        return hashlib.sha256(expected.encode()).hexdigest()

    def retry(self,company,ticket):
        require((company,ticket) in CASES,'RETRY_TICKET_NOT_ALLOWLISTED')
        parameters=f'CODCOLIGADA={company};TICKET={ticket}'
        url=HOST+'/api/framework/v1/consultaSQLServer/RealizaConsulta/RAIZ.PG.RETRY/0/T?'+urllib.parse.urlencode({'parameters':parameters})
        return retry_summary(json.loads(self.http(url)),company,ticket)


def safe_error(error): return str(error) if isinstance(error,AuditError) else 'READ_OR_VALIDATION_FAILED'


def execute(reader,baseline):
    require(baseline.get('coverageComplete') is True,'BASELINE_INCOMPLETE')
    cases=baseline.get('tickets',[])
    require(len(cases)==39 and {(x.get('company'),x.get('ticket')) for x in cases}==set(CASES),'BASELINE_SCOPE_MISMATCH')
    original={(x['company'],x['ticket']):{k:v for k,v in x.get('root',{}).items() if k in ATTRS} for x in cases}
    result={'version':1,'startedUtc':utc(),'runtimeStart':reader.pin(),'financialWrites':False,'configurationWrites':False,
      'dynamoWrites':False,'zeevWrites':False,'lambdaInvoked':False,'historicalRollbackProven':False,
      'baselineRunId':'41892943724','requestedRootCount':39,'requestedBankCount':9,
      'rootComparisonScope':'projected_control_fields_only','bankTargetSource':'fixed_reviewed_repair_targets',
      'currentZeevIntentionRevalidated':False,'roots':[],'bankLaunches':[]}
    result['nativeRetryContractSha256']=reader.contract()

    def read_case(case):
        company,ticket=case;out={'company':company,'ticket':ticket,'observedStartUtc':utc()}
        try:
            before=reader.get(company,ticket);out['before']=root_summary(before,company,ticket)
            out['native']=reader.retry(company,ticket)
            after=reader.get(company,ticket);out['after']=root_summary(after,company,ticket)
            out['rootChangedDuringRead']=before!=after
            out['controlAssessment']=control_assessment(out['after'],out['native'])
            old=root_summary(original[case],company,ticket)
            out['baseline']={k:old.get(k) for k in ('exists','state','protocolVersion','idMov')}
            out['changedFromBaseline']=any(old.get(k)!=out['after'].get(k) for k in ('exists','state','protocolVersion','idMov'))
            out['readComplete']=True
        except Exception as error: out.update(readComplete=False,gate=safe_error(error))
        out['observedEndUtc']=utc();return out

    with ThreadPoolExecutor(max_workers=3) as pool: result['roots']=list(pool.map(read_case,CASES))
    for ticket,(company,mov,lan,_,_) in BANK_TARGETS.items():
        row={'ticket':ticket,'company':company,'idMov':mov,'idLan':lan,'observedStartUtc':utc()}
        try:
            before=bank_summary(reader.read_record('FinLanDataBR',f'{company};{lan}',company),ticket)
            native=reader.retry(company,ticket)
            after=bank_summary(reader.read_record('FinLanDataBR',f'{company};{lan}',company),ticket)
            owned=(native.get('movements')==[{'company':company,'idMov':mov}] and
              len(native.get('launches',[]))==1 and
              all(native['launches'][0].get(k)==v for k,v in {'company':company,'idMov':mov,'idLan':lan}.items()))
            row.update(before=before,after=after,native=native,stable=before==after,exactOwnedChain=owned,
              verified=before==after and owned and after['bankMatchesExpected'],readComplete=True)
        except Exception as error: row.update(readComplete=False,verified=False,gate=safe_error(error))
        row['observedEndUtc']=utc();result['bankLaunches'].append(row)
    inventory,coverage=reader.inventory();result['inventoryCoverage']=coverage
    discovered=[]
    for (company,ticket),scanned in sorted(inventory.items()):
        if (company,ticket) in CASES: continue
        row={'company':company,'ticket':ticket,'observedUtc':utc()}
        try:
            current=reader.get(company,ticket);row.update(root=root_summary(current,company,ticket),
              changedSinceScan=current!=scanned,readComplete=True)
        except Exception as error: row.update(readComplete=False,gate=safe_error(error))
        discovered.append(row)
    result['newOutsideBaseline']=discovered
    result['inventoryCoverage'].update(nonCompleteRootCandidates=len(inventory),outsideBaselineCandidates=len(discovered))
    result['runtimeEnd']=reader.pin();result['completedUtc']=utc()
    result['allReadsComplete']=all(row['readComplete'] for row in result['roots']+result['bankLaunches']+discovered)
    result['allNineExpectedBankLinksVerified']=all(row['verified'] for row in result['bankLaunches'])
    result['rootClassifications']=dict(Counter(row.get('after',{}).get('classification','READ_FAILED') for row in result['roots']))
    result['newRootClassifications']=dict(Counter(row.get('root',{}).get('classification','READ_FAILED') for row in discovered))
    result['concurrentRootChanges']=sum(row.get('rootChangedDuringRead',False) for row in result['roots'])
    return result


def self_test():
    import unittest
    class Tests(unittest.TestCase):
        def test_read_operation_allowlist(self):
            for pair in [('lambda','invoke'),('dynamodb','put-item'),('dynamodb','update-item'),('lambda','update-function-code')]:
                with self.assertRaises(AuditError): Reader().aws(*pair,{})
        def test_root_does_not_export_secrets(self):
            row={'pk':{'S':'prod#PG#5#228007'},'state':{'S':'CREATED'},'pg':{'S':'165611'},'protocolVersion':{'N':'2'}}
            safe=root_summary(row,5,228007)
            self.assertEqual(safe['idMov'],165611);self.assertNotIn('owner',safe);self.assertNotIn('digest',safe)
            row['owner']={'S':'secret'}
            with self.assertRaises(AuditError): root_summary(row,5,228007)
        def test_retry_scope_and_truncation(self):
            row={'RETOMADA_VERSION':1,'REQUEST_COMPANY':5,'REQUEST_TICKET':'228007','TOTAL_MOVEMENTS':0,'TOTAL_LAUNCHES':0,'ROW_KIND':'EMPTY'}
            self.assertEqual(retry_summary([row],5,228007)['movementCount'],0)
            for mutation in ({'TOTAL_MOVEMENTS':1},{'REQUEST_COMPANY':18},{'ROW_KIND':'UNKNOWN'}):
                with self.assertRaises(AuditError): retry_summary([{**row,**mutation}],5,228007)
        def test_bank_whitelist_and_values(self):
            row={'CODCOLIGADA':'5','IDMOV':'165611','IDLAN':'634500','IDPGTO':'1','CODCOLPGTO':'5','STATUSLAN':'0',
                 'VALORORIGINAL':'1.234,56','VALORBAIXADO':'0,00','BAIXAPENDENTE':'0','CONTA':'sensitive','CODCFO':'personal'}
            safe=bank_summary(row,228007)
            self.assertTrue(safe['bankMatchesExpected']);self.assertEqual(safe['originalAmount'],'1234.56')
            self.assertNotIn('sensitive',packed(safe));self.assertNotIn('personal',packed(safe))
            with self.assertRaises(AuditError): bank_summary({**row,'IDLAN':'99'},228007)
        def test_scan_paginates_and_ignores_control_records(self):
            class Fake(Reader):
                def __init__(self): self.calls=[]
                def aws(self,service,operation,payload):
                    self.calls.append(payload)
                    if len(self.calls)==1:
                        return {'Items':[{'pk':{'S':'prod#PG#1#999999'},'state':{'S':'CREATING'}}],
                          'ScannedCount':2,'LastEvaluatedKey':{'pk':{'S':'cursor'}}}
                    return {'Items':[{'pk':{'S':'prod#PG#1#999999#ADJUDICATION#hidden'}}],'ScannedCount':1}
            reader=Fake();items,coverage=reader.inventory()
            self.assertEqual(set(items),{(1,999999)});self.assertEqual(coverage['pages'],2)
            self.assertEqual(coverage['ignoredNonRootControlItems'],1);self.assertIn('ExclusiveStartKey',reader.calls[1])
        def test_runtime_drift_fails_without_export(self):
            class Fake(Reader):
                def aws(self,service,operation,payload):
                    return {'Account':ACCOUNT} if service=='sts' else {'CodeSha256':'changed','Environment':{'Variables':{'PASSWORD_TOTVS':'secret'}}}
            with self.assertRaisesRegex(AuditError,'PIN_MISMATCH'): Fake().pin()
        def test_zero_never_proves_creating_rollback(self):
            self.assertEqual(control_assessment({'exists':True,'state':'CREATING','idMov':None},
              {'movements':[],'launches':[],'foreignCompanyFound':False}),'UNCERTAIN_CREATION_ZERO_IS_NOT_ROLLBACK')
        def test_complete_audit_rechecks_all_fixed_targets_and_new_inventory(self):
            class Fake:
                def __init__(self): self.pins=0;self.finlan_reads=0;self.gets=[]
                def pin(self): self.pins+=1;return dict(PIN)
                def contract(self): return 'a'*64
                def get(self,c,t):
                    self.gets.append((c,t))
                    return {'pk':{'S':root_key(c,t)},'state':{'S':'CREATING'}}
                def retry(self,c,t):
                    target=BANK_TARGETS.get(t)
                    return {'movements':([{'company':c,'idMov':target[1]}] if target else []),
                      'launches':([{'company':c,'idMov':target[1],'idLan':target[2],'boletoCount':0}] if target else []),
                      'foreignCompanyFound':False}
                def read_record(self,server,key,company):
                    self.finlan_reads+=1
                    c,m,l,b,bc=next(row for row in BANK_TARGETS.values() if key==f'{row[0]};{row[2]}')
                    return {'CODCOLIGADA':c,'IDMOV':m,'IDLAN':l,'IDPGTO':b,'CODCOLPGTO':bc,'STATUSLAN':0,
                      'VALORORIGINAL':'100.00','VALORBAIXADO':'0','BAIXAPENDENTE':0,'CONTA':'never export this'}
                def inventory(self): return {(1,999999):self.get(1,999999)},{'complete':True,'pages':1,'atomicSnapshot':False}
            baseline={'coverageComplete':True,'tickets':[{'company':c,'ticket':t,'root':{}} for c,t in CASES]}
            reader=Fake();output=execute(reader,baseline)
            self.assertEqual(reader.pins,2);self.assertEqual(reader.finlan_reads,18)
            self.assertEqual(len(output['roots']),39);self.assertEqual(len(output['bankLaunches']),9)
            self.assertEqual(len(output['newOutsideBaseline']),1)
            self.assertTrue(output['allReadsComplete']);self.assertTrue(output['allNineExpectedBankLinksVerified'])
            self.assertNotIn('never export this',packed(output))
    return 0 if unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests)).wasSuccessful() else 2


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',type=Path,default=Path('.payment-bulk-readonly/readback.json'))
    parser.add_argument('--output-dir',type=Path,default=Path('.payment-backlog-final-readonly'))
    parser.add_argument('--self-test',action='store_true');args=parser.parse_args()
    if args.self_test: return self_test()
    args.output_dir.mkdir(exist_ok=False)
    try:
        baseline_bytes=args.baseline.read_bytes();baseline=json.loads(baseline_bytes.decode('utf-8-sig'))
        result=execute(Reader(),baseline);result['baselineSha256']=hashlib.sha256(baseline_bytes).hexdigest()
        result['status']='READBACK_COMPLETE' if result['allReadsComplete'] else 'READBACK_INCOMPLETE'
    except Exception as error:
        result={'version':1,'status':'STOPPED_READ_ONLY','gate':safe_error(error),'observedUtc':utc(),
          'financialWrites':False,'dynamoWrites':False,'configurationWrites':False,'zeevWrites':False,'lambdaInvoked':False}
    (args.output_dir/'readback.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps({key:result[key] for key in ('status','gate','allReadsComplete','allNineExpectedBankLinksVerified','rootClassifications','newRootClassifications') if key in result}))
    return 0 if result.get('allReadsComplete') is True else 2


if __name__=='__main__': raise SystemExit(main())
