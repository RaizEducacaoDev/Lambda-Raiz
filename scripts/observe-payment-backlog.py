"""Fresh read-only adapter for reconcile-payment-backlog.py; no financial invocations.

The archived Zeev template is a reconstruction, never labelled a captured HTTP
request. Raw form data, bank fields, credentials and SOAP XML remain in memory.
Only normalized identity, values, dates, record IDs and fingerprints are emitted.
"""
import argparse
import base64
import copy
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
m=module('backlog_operator',ROOT/'scripts/reconcile-payment-backlog.py')
a=module('backlog_audit_parser',ROOT/'scripts/audit-payment-conflict-20261103-0609.py')
HOST='https://raizeducacao160286.rm.cloudtotvs.com.br:8051'
ZEEV='https://raizeducacao.zeev.it'
TEMPLATE=ROOT/'scripts/payment-backlog-template.txt'
CONTRACTS={'RAIZ.PG.RETRY':'pagamento-retomada.sql','RAIZ.PG.DOC2':'pagamento-documento-v2.sql',
           'RAIZ.PG.FISC':'pagamento-natureza-fiscal.sql','RAIZ.PG.CENSO':'pagamento-censo-operacional.sql',
           'RAIZ.PG.WINDOW':'pagamento-janela-criacao.sql'}
EXTRA=['idPagamento','codcolpgto','formaDePagamento','novaFormaDePagamento','codigoPagamento','codigoTipoChavePIX','chavePIX','qtdParcelas','idDoLancamento']
NODE=r"""
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const load=require('./tests/load-ts.cjs');
const m=load(path.resolve('src/functions/rm/post/pagamentoIdentidade.ts'));
const d=load(path.resolve('src/functions/rm/post/pagamentoDocumento.ts'));
const f=load(path.resolve('src/functions/rm/post/pagamentoFiscal.ts'));
const x=JSON.parse(fs.readFileSync(0,'utf8'));let out;
try {
 const key=m.identidadePagamento(x.payload),alias=m.identidadePagamento(x.form);
 if(JSON.stringify(key)!==JSON.stringify(alias))throw Error('alias');
 const plans=m.planosPagamento(x.payload,key),type=m.codigoMovimento(x.payload);
 const automaticItems=['1.2.09','1.2.10','1.2.11','1.2.12','1.2.08','1.2.17'].includes(type);
 if(!automaticItems&&(!Array.isArray(x.payload.itens)||!x.payload.itens.length||x.payload.itens.some(i=>!/^\d+$/.test(i.codigoDoItem||'')||!i.codigoDaNatureza)))throw Error('items');
 if(x.form.qtdParcelas && (!/^[1-9]\d*$/.test(x.form.qtdParcelas)||Number(x.form.qtdParcelas)!==plans.length))throw Error('installments');
 const context={codColigada:key.codColPgto,codFilial:x.form.codigoDaFilial2,codColCfo:key.codColCfo,codCfo:key.codCfo};
 const documentKey=d.prepararDocumento(x.payload,{...context,codTmv:type});if(!documentKey)throw Error('document contract');
 const fiscalKey=type==='1.2.03'?f.prepararContextoFiscal(x.payload,context):undefined;
 out={valid:true,key,type,documentKey,fiscalKey:fiscalKey||null,
   digest:m.hashIntencao(m.intencaoPagamento(x.payload,key,plans,type)),
   issueDate:m.dataCanonica(x.payload.dataDeEmissao),entryDate:x.payload.dataDeEntrada===''?'':m.dataCanonica(x.payload.dataDeEntrada),total:m.valorCanonico(x.payload.valorTotal),
   plans:plans.map(p=>({dueDate:p.vencimento,amount:p.valor,bankCompany:key.codColPgto,bankId:String(key.idPgto)}))};
 if(x.bank){
  m.validarCadastro(x.bank,key,{...x.payload,...x.form},plans);
  if(x.action==='ADOPT_EXISTING')d.validarDocumentoExistente(x.document,documentKey,String(x.idMov),String(x.ticket));
  else d.validarDocumento(x.document,documentKey);
  if(fiscalKey)f.validarContextoFiscal(x.fiscal,fiscalKey);
  out.validation={payload:true,bank:true,document:true,fiscal:true};
 }
} catch(e){out={valid:false,code:typeof e.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(e.code)?e.code:'CURRENT_PAYLOAD_VALIDATION_FAILED'};}
process.stdout.write(JSON.stringify(out));
"""

def normalized_sql(value):return value.replace('\r\n','\n').replace('\r','\n').strip()
def template_sha():return hashlib.sha256(TEMPLATE.read_text(encoding='utf-8-sig').encode()).hexdigest()
def native_date(value):
    text=str(value or '')[:10]
    m.require(re.fullmatch(r'\d{4}-\d{2}-\d{2}',text),'NATIVE_DATE_MISSING')
    dt.date.fromisoformat(text);return text
def native_money(value):
    text=str(value)
    if ',' in text:text=text.replace('.','').replace(',','.')
    return m.money(text)
def optional_id(value):
    return None if value in (None,'','0',0) else m.identifier(value)
def xml_dataset(raw):
    m.require(isinstance(raw,(bytes,str)) and b'<!DOCTYPE' not in (raw.encode() if isinstance(raw,str) else raw).upper() and b'<!ENTITY' not in (raw.encode() if isinstance(raw,str) else raw).upper(),'UNSAFE_XML')
    return ET.fromstring(raw)
def records(dataset,name):
    result=[]
    for element in dataset.findall(name):
        row={}
        for field in element:
            m.require(field.tag not in row and not list(field),'AMBIGUOUS_NATIVE_RECORD')
            row[field.tag]=field.text or ''
        result.append(row)
    return result
def unique(dataset,name):
    values=records(dataset,name);m.require(len(values)==1,'NATIVE_RECORD_NOT_UNIQUE');return values[0]

def render(data,template):
    fields={}
    for field in data.get('formFields',[]):
        name=field.get('name');row=int(field.get('row') or 1)
        m.require(isinstance(name,str) and row>0,'ZEEV_FIELD_SHAPE')
        value=str(field.get('value') or '')
        m.require(row not in fields.setdefault(name,{}),'DUPLICATE_ZEEV_FIELD')
        fields[name][row]=value
    def value(name,row=1):return fields.get(name,{}).get(row,fields.get(name,{}).get(1,''))
    def plain(text,row):return re.sub(r'\{Form\.(\w+)\}',lambda match:json.dumps(value(match[1],row),ensure_ascii=False)[1:-1],text)
    def loop(match):return ','.join(plain(match[2],row) for row in sorted(fields.get(match[1],{1:''})))
    result=re.sub(r'\{Form\.Loop\.(\w+)\}(.*?)\{/Form\.Loop\.\1\}',loop,template,flags=re.S)
    result=plain(result,1).replace('{Instance.Id}',str(data['id'])).replace('{Instance.StartDateTime}',str(data.get('startDateTime') or '')).replace('{Instance.LinkReport}','')
    result=re.sub(r'\{DataSource\.[^}]+\}','',result)
    m.require(not re.search(r'\{(?:Form|Instance|DataSource)\.',result),'UNRESOLVED_TEMPLATE_TOKEN')
    return json.loads(result),{name:value(name) for name in fields}

def census_rows(rows,parameters):
    m.require(isinstance(rows,list) and 0<len(rows)<1001,'INDEPENDENT_CENSUS_TRUNCATED')
    moves=[];launches=[];counts=None
    for row in rows:
        expected={'OBS_VERSION':1,'REQUEST_COMPANY':int(parameters['CODCOLIGADA']),
          'REQUEST_SUPPLIER_COMPANY':int(parameters['CODCOLCFO']),'REQUEST_SUPPLIER':parameters['CODCFO'],
          'REQUEST_TICKET':parameters['TICKET'],'REQUEST_NUMBER':parameters['NUMERO']}
        m.require(all(row.get(k)==v for k,v in expected.items()),'CENSUS_PARAMETER_ECHO_MISMATCH')
        m.require(native_date(row.get('REQUEST_ISSUE'))==parameters['EMISSAO'] and
          str(row.get('REQUEST_START','')).replace(' ','T')[:19]==parameters['INICIO'] and
          str(row.get('REQUEST_END','')).replace(' ','T')[:19]==parameters['FIM'],'CENSUS_DATE_ECHO_MISMATCH')
        total=(row.get('TOTAL_MOVEMENTS'),row.get('TOTAL_LAUNCHES'))
        m.require(all(type(x) is int and x>=0 for x in total) and (counts is None or counts==total),'CENSUS_TOTALS_INVALID')
        counts=total
        if row.get('ROW_KIND')=='MOV':moves.append(row)
        elif row.get('ROW_KIND')=='LAN':launches.append(row)
        else:m.require(total==(0,0) and len(rows)==1 and not row.get('IDMOV') and not row.get('IDLAN'),'CENSUS_EMPTY_SENTINEL_INVALID')
    m.require(counts==(len(moves),len(launches)),'CENSUS_COUNT_MISMATCH')
    m.require(len({(r['CODCOLIGADA'],r['IDMOV']) for r in moves})==len(moves) and len({(r['CODCOLIGADA'],r['IDLAN']) for r in launches})==len(launches),'CENSUS_DUPLICATE_IDS')
    return moves,launches

def movement(row,ticket,independent=False):
    return {'company':str(row['CODCOLIGADA']),'branch':str(row['CODFILIAL']),'supplierCompany':str(row['CODCOLCFO']),
      'supplier':row['CODCFO'],'movementType':row['CODTMV'],'number':row['DOCUMENTO'] if independent else row['NUMEROMOV'],
      'series':row['SERIE'],'documentType':row['CODTDO'],'issueDate':native_date(row['DATAEMISSAO']),
      'entryDate':native_date(row['DATASAIDA']),'total':native_money(row['VALORLIQUIDO']),
      'idMov':m.identifier(row['IDMOV']),'ticket':str(ticket),'status':row['STATUS'],
      'gross':native_money(row['VALORBRUTO']),'net':native_money(row['VALORLIQUIDO'])}
def launch(row,ticket,boleto_count,independent=False):
    return {'company':str(row['CODCOLIGADA']),'branch':str(row['CODFILIAL']),'supplierCompany':str(row['CODCOLCFO']),
      'supplier':row['CODCFO'],'issueDate':native_date(row['DATAEMISSAO']),'idMov':m.identifier(row['IDMOV']),
      'idLan':m.identifier(row['IDLAN']),'ticket':str(ticket),'dueDate':native_date(row['DATAVENCIMENTO']),
      'amount':native_money(row['VALOR'] if independent else row['VALORORIGINAL']),
      'status':int(row['STATUS'] if independent else row['STATUSLAN']),'paid':native_money(row['VALORBAIXADO']),
      'pendingPayment':int(row['BAIXAPENDENTE']),'boletoCount':int(boleto_count),'boletoId':optional_id(row.get('IDBOLETO')),
      'bankId':optional_id(row.get('IDPGTO')),'bankCompany':optional_id(row.get('CODCOLPGTO'))}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise m.GateError('HTTP_REDIRECT_REJECTED')

class Observer:
    def __init__(self,plan):
        self.plan=plan;self.deadline=time.monotonic()+180
        self.opener=urllib.request.build_opener(NoRedirect())
        self.template=TEMPLATE.read_text(encoding='utf-8-sig')
        m.require(template_sha()==plan['templateSha256'],'TEMPLATE_CHANGED')
        path=Path(plan['auditFile'])
        m.require(hashlib.sha256(path.read_bytes()).hexdigest()==plan['auditSha256'],'AUDIT_SOURCE_CHANGED')
        self.audit=json.loads(path.read_text(encoding='utf-8-sig'))
        m.require(self.audit.get('coverageComplete') is True,'AUDIT_COVERAGE_INCOMPLETE')
        cases=[x for x in self.audit['tickets'] if x['company']==plan['company'] and x['ticket']==plan['ticket']]
        m.require(len(cases)==1 and cases[0]['root']==plan['expectedRoot'] and not cases[0]['unknownAttributes'],'AUDIT_ROOT_MISMATCH')
        self.case=cases[0]
        m.require(len(self.case['originalRequestCandidates'])==1 and not self.case['laterDispatchRequestIds'],'ORIGINAL_REQUEST_AMBIGUOUS')
        self.request=self.case['originalRequestCandidates'][0]
        m.require(all(x['requestId']==self.request for x in self.case['allDispatches']),'LATER_OR_OTHER_DISPATCH_PRESENT')
        originals=[x for x in self.audit['originalRequests'] if x['requestId']==self.request]
        m.require(len(originals)==1 and originals[0]['coverage']['complete'],'ORIGINAL_AUDIT_MISSING')
        self.original=originals[0]
        self.audit_end=int(dt.datetime.fromisoformat(self.audit['observedUtc']).timestamp()*1000)
        original_start=min(e['timestamp'] for e in self.original['events'])
        for pattern in ('"[RM-DIAG]" "SaveRecord"','"transport_call_started"'):
            spans=sorted((w['startMs'],w['endMs']) for w in self.audit['logWindows'] if w['pattern']==pattern and w['coverage']['complete'])
            m.require(spans and spans[0][0]<=original_start and spans[-1][1]>=self.audit_end and all(spans[i][1]==spans[i+1][0] for i in range(len(spans)-1)),'AUDIT_WINDOW_GAP')

    def aws(self,*args):return a.aws(*args,deadline=self.deadline)

    def config(self):
        m.require(self.aws('sts','get-caller-identity')['Account']==m.ACCOUNT,'AWS_ACCOUNT_MISMATCH')
        cfg=self.aws('lambda','get-function-configuration','--function-name',m.FUNCTION)
        env=cfg.get('Environment',{}).get('Variables',{})
        runtime={'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId']}
        m.require(runtime==self.plan['expectedRuntime'] and cfg.get('State')=='Active' and cfg.get('LastUpdateStatus')=='Successful','RUNTIME_CHANGED')
        m.require(env.get('STAGE')=='prod' and env.get('PAGAMENTO_IDPGTO_TABLE')==m.TABLE and env.get('RM_PROD','').rstrip('/')==HOST.replace(':8051','') and env.get('ZEEV_PROD','').rstrip('/')==ZEEV,'RUNTIME_ENVIRONMENT_MISMATCH')
        import os
        token=os.environ.get('RECONCILE_ZEEV_TOKEN')
        m.require(token and env.get('USERNAME_TOTVS') and env.get('PASSWORD_TOTVS'),'READ_CREDENTIALS_MISSING')
        self.rm_auth='Basic '+base64.b64encode((env['USERNAME_TOTVS']+':'+env['PASSWORD_TOTVS']).encode()).decode()
        self.zeev_token=token;self.rm_user=env['USERNAME_TOTVS']
        return runtime

    def http(self,url,stage,data=None,headers=None):
        m.require(stage in ('ZEEV','RM_QUERY','RM_READRECORD'),'HTTP_STAGE_NOT_ALLOWED')
        if stage=='ZEEV':m.require(url.startswith(ZEEV+'/api/2/instances/'+str(self.plan['ticket'])+'?') and data is None,'ZEEV_ROUTE_NOT_ALLOWED')
        elif stage=='RM_QUERY':m.require(url.startswith(HOST+'/api/framework/v1/consultaSQLServer/RealizaConsulta/') and data is None,'RM_QUERY_NOT_ALLOWED')
        else:m.require(url==HOST+'/wsDataServer/IwsDataServer' and b'<ReadRecord ' in data and b'SaveRecord' not in data,'RM_WRITE_FORBIDDEN')
        try:
            with self.opener.open(urllib.request.Request(url,data=data,headers=headers or {}),timeout=15) as response:raw=response.read(8000001)
        except urllib.error.HTTPError as error:raise m.GateError(f'HTTP_{stage}_{error.code}') from None
        except (urllib.error.URLError,TimeoutError):raise m.GateError('HTTP_'+stage+'_NETWORK_FAILURE') from None
        m.require(len(raw)<=8000000,'HTTP_RESPONSE_TOO_LARGE');return raw

    def read_record(self,server,key,company):
        m.require(server in ('GlbConsSQLData','FinDadosPgtoDataBR','MovMovimentoTBCData','FinLanDataBR'),'DATASERVER_NOT_ALLOWLISTED')
        envelope=ET.Element('{http://schemas.xmlsoap.org/soap/envelope/}Envelope');body=ET.SubElement(envelope,'{http://schemas.xmlsoap.org/soap/envelope/}Body');op=ET.SubElement(body,'ReadRecord',xmlns='http://www.totvs.com/')
        system='G' if server=='GlbConsSQLData' else 'T' if server=='MovMovimentoTBCData' else 'F'
        for name,value in {'DataServerName':server,'PrimaryKey':key,'Contexto':f'CODCOLIGADA={company};CODSISTEMA={system};CODUSUARIO={self.rm_user}'}.items():ET.SubElement(op,name).text=value
        raw=self.http(HOST+'/wsDataServer/IwsDataServer','RM_READRECORD',ET.tostring(envelope),
          {'Authorization':self.rm_auth,'Content-Type':'text/xml;charset=UTF-8','SOAPAction':'http://www.totvs.com/IwsDataServer/ReadRecord'})
        result=xml_dataset(raw).find('.//{http://www.totvs.com/}ReadRecordResult')
        m.require(result is not None and result.text,'NATIVE_READ_RESULT_MISSING');return xml_dataset(result.text)

    def query(self,code,params):
        m.require(code in CONTRACTS and all(re.fullmatch(r'[A-Za-z0-9._~:\-]+',str(v)) for v in params.values()),'QUERY_PARAMETERS_NOT_ALLOWED')
        url=HOST+f'/api/framework/v1/consultaSQLServer/RealizaConsulta/{code}/0/T?'+urllib.parse.urlencode({'parameters':';'.join(f'{k}={v}' for k,v in params.items())})
        return json.loads(self.http(url,'RM_QUERY',headers={'Authorization':self.rm_auth,'Accept':'application/json'}))

    def contracts(self):
        for code,filename in CONTRACTS.items():
            if code=='RAIZ.PG.WINDOW' and self.plan.get('alternativeOriginalClosure') is None:continue
            row=unique(self.read_record('GlbConsSQLData','0;T;'+code,0),'GConsSql')
            m.require(normalized_sql(row.get('SENTENCA',''))==normalized_sql((ROOT/'sql'/filename).read_text(encoding='utf-8-sig')),'NATIVE_QUERY_CONTRACT_CHANGED')

    def node(self,payload):
        result=subprocess.run(['node','-e',NODE],cwd=ROOT,input=json.dumps(payload,ensure_ascii=False),text=True,capture_output=True,encoding='utf-8',timeout=25)
        m.require(result.returncode==0,'OFFLINE_VALIDATOR_PROCESS_FAILED')
        out=json.loads(result.stdout)
        m.require(out.get('valid') is True,out.get('code','CURRENT_PAYLOAD_VALIDATION_FAILED'))
        return out

    def zeev_snapshot(self,names):
        # IIS rejects long query strings. Bound the encoded URL, and confirm a
        # second complete sweep so merged table rows cannot silently mix edits.
        base=ZEEV+f'/api/2/instances/{self.plan["ticket"]}?'
        def url(batch):
            return base+urllib.parse.urlencode([*[('formFieldNames',name) for name in batch],
              ('useCache','false'),('showPendingInstanceTasks','true')])
        batches=[];batch=[]
        for name in sorted(set(names)):
            m.require(isinstance(name,str) and re.fullmatch(r'\w+',name),'ZEEV_FIELD_NAME_INVALID')
            if batch and len(url(batch+[name]))>1400:batches.append(batch);batch=[]
            batch.append(name);m.require(len(url(batch))<=1400,'ZEEV_FIELD_NAME_TOO_LONG')
        if batch:batches.append(batch)
        m.require(bool(batches),'ZEEV_FIELD_NAMES_MISSING')
        started=m.utc();header=None;first=None
        for _ in range(2):
            fields={}
            for batch in batches:
                data=json.loads(self.http(url(batch),'ZEEV',headers={'Authorization':'Bearer '+self.zeev_token,'Accept':'application/json'}))
                m.require(data.get('id')==self.plan['ticket'] and data.get('flow',{}).get('id')==299 and
                  data.get('active') is True and isinstance(data.get('instanceTasks'),list),'ZEEV_TICKET_NOT_ACTIVE')
                current={k:copy.deepcopy(v) for k,v in data.items() if k!='formFields'}
                current['instanceTasks']=sorted(current['instanceTasks'],key=lambda task:m.sha(task))
                m.require(header is None or current==header,'ZEEV_HEADER_OR_TASKS_CHANGED_DURING_READ')
                header=current
                m.require(isinstance(data.get('formFields'),list),'ZEEV_FIELDS_MISSING')
                for field in data['formFields']:
                    m.require(isinstance(field,dict) and field.get('name') in batch,'ZEEV_UNREQUESTED_FIELD')
                    row=field.get('row') or 1
                    m.require(type(row) is int and row>0,'ZEEV_FIELD_ROW_INVALID')
                    key=(field['name'],row)
                    m.require(key not in fields,'DUPLICATE_ZEEV_FIELD')
                    fields[key]={'name':field['name'],'row':row,'value':field.get('value')}
            m.require(first is None or fields==first,'ZEEV_FIELDS_CHANGED_DURING_READ')
            first=fields
        return {**header,'formFields':[first[key] for key in sorted(first)]},started

    def closure(self):
        starts=[e['timestamp'] for e in self.original['events'] if e['kind']=='lambda_start']
        ends=[e['timestamp'] for e in self.original['events'] if e['kind']=='lambda_end']
        reports=[e['timestamp'] for e in self.original['events'] if e['kind']=='lambda_report']
        m.require(len(starts)==len(ends)==len(reports)==1,'ORIGINAL_TERMINATION_MISSING')
        raw,coverage=a.read_log_window('"'+self.request+'"',starts[0]-1000,reports[0]+1000,self.deadline)
        selected=[x for e in raw if (x:=a.sanitize(e)) is not None and x.get('requestId')==self.request and x['kind'] in ('lambda_start','lambda_end','lambda_report')]
        m.require(coverage['complete'] and [x['timestamp'] for x in selected if x['kind']=='lambda_start']==starts and [x['timestamp'] for x in selected if x['kind']=='lambda_end']==ends and [x['timestamp'] for x in selected if x['kind']=='lambda_report']==reports,'ORIGINAL_CLOSURE_NOT_REOBSERVED')
        now=int(time.time()*1000);m.require(0<=now-self.audit_end<=3*86400000,'BASELINE_AUDIT_TOO_OLD')
        later=[]
        for pattern in ('"'+str(self.plan['ticket'])+'" "SaveRecord"','"'+str(self.plan['ticket'])+'" "transport_call_started"'):
            events,scope=a.read_log_window(pattern,max(starts[0],self.audit_end-60000),now,self.deadline)
            m.require(scope['complete'],'INCREMENTAL_LOG_COVERAGE_INCOMPLETE')
            for event in events:
                row=a.sanitize(event)
                if row and row.get('ticket')==self.plan['ticket'] and ((row.get('etapa')=='SaveRecord' and row.get('evento')=='inicio') or row.get('event')=='transport_call_started'):
                    m.require(row.get('requestId')==self.request and row['timestamp']<=ends[0],'LATER_NATIVE_DISPATCH_FOUND')
        source=m.sha({'auditSha256':self.plan['auditSha256'],'requestId':self.request,'termination':selected,'later':later})
        result={'observedUtc':m.utc(),'originalRequestId':self.request,'logSourceSha256':source,
          'originalRootSha256':m.sha(self.plan['expectedRoot']),'originalStartMs':starts[0],'originalEndMs':ends[0],'originalReportMs':reports[0],
          'endSeen':True,'reportSeen':True,'coverageComplete':True,'laterDispatches':0}
        if self.plan.get('alternativeOriginalClosure') is not None:
            live=[x for event in raw if (x:=a.sanitize(event)) is not None]
            fixed=set()
            for event in raw:
                message,_=a.unwrap(event)
                for code,literal in [('RM_RETURN_WITHOUT_EXPECTED_KEY','Criação RM de resultado incerto; consultar movimento do ticket'),
                                     ('CREATION_UNCERTAIN','Criação RM incerta; requer reconciliação')]:
                    if literal in message:fixed.add(code)
            result['originalOutcome']=m.WINDOW.original_evidence(self.original,live,sorted(fixed),m)
            m.WINDOW.validate_original(self.plan,result,result['originalOutcome'],m)
        return result

    def observe(self,plan):
        self.deadline=time.monotonic()+180
        runtime=self.config();self.contracts();closed=self.closure()
        names=sorted(set(re.findall(r'\{Form\.(\w+)\}',self.template)+EXTRA))
        data,z_time=self.zeev_snapshot(names)
        payload,form=render(data,self.template);first=self.node({'payload':payload,'form':form})
        key=first['key'];m.require(key['codColPgto']==str(plan['company']) and form.get('codigoDaColigada2')==str(plan['company']),'ZEEV_COMPANY_CHANGED')
        bankrow=unique(self.read_record('FinDadosPgtoDataBR',f"{key['codColPgto']};{key['codColCfo']};{key['codCfo']};{key['idPgto']}",plan['company']),'FDadosPgto')
        doc_key=first['documentKey'];doc=self.query('RAIZ.PG.DOC2',{'CODCOLIGADA':doc_key['codColigada'],'CODFILIAL':doc_key['codFilial'],'CODCOLCFO':doc_key['codColCfo'],'CODCFO':doc_key['codCfo'],'CODTMV':doc_key['codTmv'],'NUMERO':doc_key['numero'],'SERIE':doc_key['serie'] or '~'})
        fiscal=None
        if first['fiscalKey']:
            fk=first['fiscalKey'];fiscal=self.query('RAIZ.PG.FISC',{'CODCOLIGADA':fk['codColigada'],'CODFILIAL':fk['codFilial'],'CODCOLCFO':fk['codColCfo'],'CODCFO':fk['codCfo'],'IDNAT':fk['idNat']})
        checked=self.node({'payload':payload,'form':form,'bank':bankrow,'document':doc,'fiscal':fiscal,'action':plan['action'],'idMov':plan.get('idMov'),'ticket':plan['ticket']})
        null_document=plan.get('alternativeOriginalClosure') is not None and doc[0].get('DOC_VERSION')==2 and doc[0].get('HAS_MOVEMENT_EXTENSION')==1 and doc[0].get('DOCUMENT_TYPE_IS_NULL')==1
        expected=m.identity({'company':plan['company'],'branch':form['codigoDaFilial2'],'supplierCompany':key['codColCfo'],'supplier':key['codCfo'],
          'movementType':checked['type'],'number':doc[0]['EFFECTIVE_NUMBER'],'series':doc[0]['EFFECTIVE_SERIES'],'documentType':doc[0].get('EFFECTIVE_DOCUMENT_TYPE'),
          'issueDate':checked['issueDate'],'entryDate':checked['entryDate'],'total':checked['total']},allow_omitted_entry=True,allow_null_document=null_document)
        selected_bank=m.bank({'company':key['codColPgto'],'supplierCompany':key['codColCfo'],'supplier':key['codCfo'],'id':key['idPgto'],'paymentCode':bankrow['FORMAPAGAMENTO']})
        params={'CODCOLIGADA':str(plan['company']),'CODCOLCFO':key['codColCfo'],'CODCFO':key['codCfo'],'TICKET':str(plan['ticket']),
          'NUMERO':expected['number'],'EMISSAO':expected['issueDate'],
          'INICIO':dt.datetime.fromtimestamp(closed['originalStartMs']/1000-3*3600-120,dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S'),
          'FIM':dt.datetime.fromtimestamp(closed['originalReportMs']/1000+120,dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')}
        sql_mov,sql_lan=census_rows(self.query('RAIZ.PG.CENSO',params),params)
        lookup_ids={m.sha(expected)}
        if plan.get('historicalIdentity') is not None:
            old=m.identity(plan['historicalIdentity'],allow_omitted_entry=True);lookup_ids.add(m.sha(old))
            old_params={**params,'CODCOLCFO':old['supplierCompany'],'CODCFO':old['supplier'],'NUMERO':old['number'],'EMISSAO':old['issueDate']}
            old_mov,old_lan=census_rows(self.query('RAIZ.PG.CENSO',old_params),old_params)
            sql_mov=list({(r['CODCOLIGADA'],r['IDMOV']):r for r in sql_mov+old_mov}.values())
            sql_lan=list({(r['CODCOLIGADA'],r['IDLAN']):r for r in sql_lan+old_lan}.values())
        sql_time=m.utc()
        alternative=None
        if plan.get('alternativeOriginalClosure') is not None:
            alternative,sql_mov,sql_lan=m.WINDOW.collect(self,plan,closed,sql_mov,sql_lan,m,unique,records)
        retry=self.query('RAIZ.PG.RETRY',{'CODCOLIGADA':str(plan['company']),'TICKET':str(plan['ticket'])})
        m.require(isinstance(retry,list) and retry,'NATIVE_CENSUS_MISSING')
        for row in retry:
            m.require(row.get('RETOMADA_VERSION')==1 and row.get('REQUEST_COMPANY')==plan['company'] and row.get('REQUEST_TICKET')==str(plan['ticket']) and row.get('TOTAL_MOVEMENTS')==len(sql_mov) and row.get('TOTAL_LAUNCHES')==len(sql_lan),'NATIVE_INDEPENDENT_CENSUS_DIFFERS')
        retry_mov=[r for r in retry if r.get('ROW_KIND')=='MOV'];retry_lan=[r for r in retry if r.get('ROW_KIND')=='LAN']
        m.require(len(retry_mov)==len(sql_mov) and len(retry_lan)==len(sql_lan),'NATIVE_CENSUS_COUNT_MISMATCH')
        m.require({(r['CODCOLIGADA'],r['IDMOV']) for r in retry_mov}=={(r['CODCOLIGADA'],r['IDMOV']) for r in sql_mov} and
          {(r['CODCOLIGADA'],r['IDLAN']) for r in retry_lan}=={(r['CODCOLIGADA'],r['IDLAN']) for r in sql_lan},'NATIVE_CENSUS_IDS_MISMATCH')
        native_mov=[];native_lan=[];owned={}
        for row in retry_mov:
            dataset=self.read_record('MovMovimentoTBCData',f"{row['CODCOLIGADA']};{row['IDMOV']}",row['CODCOLIGADA'])
            record=unique(dataset,'TMOV');compl=unique(dataset,'TMOVCOMPL')
            m.require(compl.get('CODCOLIGADA')==str(row['CODCOLIGADA']) and compl.get('IDMOV')==str(row['IDMOV']) and compl.get('TICKET')==str(plan['ticket']),'MOVEMENT_NOT_OWNED')
            owned[(row['CODCOLIGADA'],row['IDMOV'])]=compl['TICKET'];native_mov.append(movement(record,compl['TICKET']))
        for row in retry_lan:
            record=unique(self.read_record('FinLanDataBR',f"{row['CODCOLIGADA']};{row['IDLAN']}",row['CODCOLIGADA']),'FLAN')
            parent=(int(record['CODCOLIGADA']),int(record['IDMOV']));m.require(parent in owned,'ORPHAN_NATIVE_LAUNCH')
            native_lan.append(launch(record,owned[parent],row['BOLETO_COUNT']))
        candidates=[{'company':r['CODCOLIGADA'],'idMov':r['IDMOV'],'ticket':int(r['TICKET']) if r.get('TICKET') else None} for r in doc if r.get('IDMOV') is not None]
        document={**{k:expected[k] for k in m.DOCUMENT},'configured':True}
        common={'company':plan['company'],'ticket':plan['ticket'],'complete':True,'committedRead':True,'lookupModes':sorted(m.LOOKUPS),
          'lookupIdentities':sorted(lookup_ids),'document':document,'documentCandidates':candidates}
        result={'observedUtc':m.utc(),'runtime':runtime,'identity':expected,'bank':{**selected_bank,'active':bankrow['ATIVO']=='1'},'plans':checked['plans'],
          'zeev':{'observedUtc':z_time,'active':True,'flowId':299,'ticket':plan['ticket'],'company':plan['company'],'currentDigest':checked['digest'],'entryDateOmitted':checked['entryDate']=='',
            'workflowSha256':m.sha({k:v for k,v in data.items() if k!='formFields'}),
            'identity':dict(expected),'bank':dict(selected_bank),'plans':copy.deepcopy(checked['plans']),'validation':checked['validation']},
          'closure':closed,'native':{**copy.deepcopy(common),'observedUtc':m.utc(),'movements':native_mov,'launches':native_lan},
          'independent':{**copy.deepcopy(common),'observedUtc':sql_time,'movements':[movement(r,r.get('TICKET'),True) for r in sql_mov],
            'launches':[launch(r,r.get('TICKET'),r['BOLETO_COUNT'],True) for r in sql_lan]},
          'reconstruction':{'templateSha256':template_sha(),'capturedHttp':False},
          'validationCodeSha256':m.sha({str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted((ROOT/'src/functions/rm/post').glob('pagamento*.ts'))}),
          'bankDetailsSha256':m.sha(bankrow)}
        m.require(self.config()==runtime,'RUNTIME_CHANGED_DURING_OBSERVATION')
        if alternative is not None:result['alternativeOriginalClosure']=alternative
        if null_document:result['documentNullProof']={'version':2,'hasMovementExtension':1,'documentTypeIsNull':1,'rowSourceSha256':m.sha(doc)}
        result['sourceReadbackSha256']=m.observation_sha(result)
        return result

def create_observer(plan):return Observer(plan)

def prepare_plan(audit_path,company,ticket,action,id_mov=None,historical=None,alternative=False):
    audit=json.loads(audit_path.read_text(encoding='utf-8-sig'))
    case=next((r for r in audit['tickets'] if r['company']==company and r['ticket']==ticket),None)
    m.require(case is not None,'TICKET_ABSENT_FROM_AUDIT')
    cfg=a.aws('lambda','get-function-configuration','--function-name',m.FUNCTION,deadline=time.monotonic()+30)
    plan={'version':1,'action':action,'company':company,'ticket':ticket,'expectedRoot':case['root'],
      'expectedRuntime':{'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId']},'currentDigest':case['root']['digest']['S'],
      'expectedObservationSha256':'0'*64,'auditFile':str(audit_path),'auditSha256':hashlib.sha256(audit_path.read_bytes()).hexdigest(),
      'templateSha256':template_sha(),'observerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    if id_mov is not None:plan['idMov']=id_mov
    if historical is not None:plan['historicalIdentity']=historical
    if alternative:plan['alternativeOriginalClosure']=m.WINDOW.policy(company,ticket,m)
    m.root_key(plan)
    actual=a.aws('dynamodb','get-item','--table-name',m.TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':m.root_key(plan)}}),deadline=time.monotonic()+30).get('Item',{})
    m.require(actual==case['root'],'ROOT_CHANGED_SINCE_AUDIT')
    proof=Observer(plan).observe(plan)
    plan['currentDigest']=proof['zeev']['currentDigest'];plan['expectedObservationSha256']=proof['sourceReadbackSha256']
    m.validate_observation(plan,proof)
    return plan,proof

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-plan',action='store_true',required=True)
    parser.add_argument('--audit',type=Path,required=True);parser.add_argument('--company',type=int,required=True);parser.add_argument('--ticket',type=int,required=True)
    parser.add_argument('--action',choices=['RESERVE_NEW','ADOPT_EXISTING'],required=True);parser.add_argument('--id-mov',type=int)
    parser.add_argument('--historical-identity',type=Path);parser.add_argument('--output-plan',type=Path,required=True);parser.add_argument('--output-proof',type=Path,required=True)
    parser.add_argument('--alternative-original-window',action='store_true')
    args=parser.parse_args();historical=json.loads(args.historical_identity.read_text(encoding='utf-8-sig')) if args.historical_identity else None
    plan,proof=prepare_plan(args.audit,args.company,args.ticket,args.action,args.id_mov,historical,args.alternative_original_window)
    args.output_plan.write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8');args.output_proof.write_text(json.dumps(proof,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'ticket':args.ticket,'prepared':True,'businessWrites':False,'digestMatchesLegacy':plan['currentDigest']==plan['expectedRoot']['digest']['S']}))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'READ_ONLY_OBSERVER_STOPPED','errorType':type(error).__name__,
          'gate':str(error) if isinstance(error,m.GateError) else 'READ_OR_NORMALIZATION_FAILED'}));raise SystemExit(2)
