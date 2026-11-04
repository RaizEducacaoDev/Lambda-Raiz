"""One fixed, rejected service-payment probe; never deploys or writes business data.

Execution is CI-gated. The active bundle must first prove in an offline sandbox
that the exact input reaches the document read before every mutation. Native SQL
must still CAST the impossible branch to INT. Only REPORT numbers are exported.
"""
import base64,datetime as dt,hashlib,io,json,os,re,subprocess,tempfile,time
from pathlib import Path
import urllib.request,xml.etree.ElementTree as ET,zipfile

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.payment-runtime-timing'
FUNCTION='lambda-raiz-prod-solicitacaoDePagamento'
TABLE='lambda-raiz-prod-pagamento-idpgto'
ACCOUNT='757843862365';REGION='sa-east-1'
BASELINE='oHgRl53dlYR3Z/98HuB1GRelxAvWFUIKth0WHagkRnc='
REVISION='00ae2c0f-6801-4c07-8ff3-6b74497b2614'
CORE='cf802a6ef20cd6047e94e0ebdfe45da7ea923a36aafd103dada801cde6bb352e'
ENTRY='src/functions/rm/post/solicitacaoDePagamento.js'
CORE_ENTRY='src/functions/rm/post/solicitacaoDePagamento.core.cjs'
HOST='https://raizeducacao160286.rm.cloudtotvs.com.br:8051'
TICKET='999999990048';COMPANY='11';PK=f'prod#PG#{COMPANY}#{TICKET}'

class ProbeError(Exception):pass
def require(value,code):
 if not value:raise ProbeError(code)
def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def payload():
 return {'tipoDaSolicitacao':'PG','tipoDoPagamento':'NF','tipoDeItem':'Serviço',
  'codigoDaColigada2':COMPANY,'codigoDaFilial2':'2147483648','codigoDoFornecedor':'0000173261',
  'CODCOLCFO':'0','CODCOLPGTO':COMPANY,'idpgto':'2','ticketRaiz':TICKET,
  'numeroDaNF':'999999999','serie':'1','dataDeEmissao':'04/11/2026','dataDeEntrada':'04/11/2026',
  'dataDeVencimento':'30/11/2026','valorTotal':'1,00','tributos':[],
  'itens':[{'codigoDoItem':'837','qtdDoItem':'1','valorDoItem':'1,00','desconto':'0','coligadaDaNatureza':COMPANY,'codigoDaNatureza':'02.07.00016'}]}

NEGATIVE_PROOF=r"""
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const input=JSON.parse(fs.readFileSync(0,'utf8'));let network=0,mutations=0,saveRecords=0,creators=0,coreLoads=0,docs=0,banks=0,recons=0,reads=0;
console.info=console.warn=console.error=console.log=()=>{};
for(const name of ['node:http','node:https']){const api=require(name);for(const method of ['request','get'])api[method]=()=>{network++;throw Error('NETWORK_FORBIDDEN');};}
process.env.STAGE='prod';process.env.PAGAMENTO_IDPGTO_TABLE='synthetic-only';
const allowedReads=new Set(['consultar','concluida','movimentoConhecido']);
const repo=new Proxy({}, {get:(_,name)=>allowedReads.has(name)?async()=>{reads++;return undefined;}:async()=>{mutations++;throw Error('DYNAMO_MUTATION_FORBIDDEN');}});
const rm=new Proxy({
 readReacord:async(key,server)=>{if(key!=='11;0;0000173261;2'||server!=='FinDadosPgtoDataBR')throw Error('READ_SCOPE');banks++;return '<Root><FDadosPgto><CODCOLIGADA>11</CODCOLIGADA><CODCOLCFO>0</CODCOLCFO><CODCFO>0000173261</CODCFO><IDPGTO>2</IDPGTO><ATIVO>1</ATIVO><FORMAPAGAMENTO>Y</FORMAPAGAMENTO></FDadosPgto></Root>';},
 buscarMovimentosPorTicket:async(company,ticket,type)=>{if(company!=='11'||ticket!=='999999990048'||type!=='1.2.03')throw Error('RECON_SCOPE');recons++;return [];},
 consultarDocumento:async(key)=>{if(key.codFilial!=='2147483648'||key.codTmv!=='1.2.03')throw Error('DOCUMENT_SCOPE');docs++;throw Error('SQL_INT_OVERFLOW_SENTINEL');},
 saveRecord:async()=>{saveRecords++;throw Error('SAVE_RECORD_FORBIDDEN');}
},{get:(o,k)=>k in o?o[k]:async()=>{mutations++;throw Error('UNEXPECTED_RM_OPERATION');}});
let service;
if(input.bundle){
 if(!/async function executarPagamentoSeguro\(/.test(input.bundle))throw Error('ACTIVE_SERVICE_NOT_EXPOSABLE');
 const realRequire=require('node:module').createRequire(path.resolve('package.json'));
 const safeRequire=name=>{
  if(name.includes('solicitacaoDePagamento.core.cjs')){coreLoads++;throw Error('LEGACY_CORE_FORBIDDEN');}
  if(['child_process','node:child_process','worker_threads','node:worker_threads'].includes(name))throw Error('PROCESS_FORBIDDEN');
  return realRequire(name);
 };
 const sandbox={module:{exports:{}},exports:{},require:safeRequire,console,Buffer,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,AbortSignal,
  setTimeout,clearTimeout,setInterval,clearInterval,setImmediate,clearImmediate,
  process:{...process,env:{STAGE:'prod',PAGAMENTO_IDPGTO_TABLE:'synthetic-only'},emitWarning:()=>{}},
  __filename:path.resolve('synthetic-active-bundle.cjs'),__dirname:path.resolve('.'),fetch:()=>{network++;throw Error('FETCH_FORBIDDEN');}};
 vm.runInNewContext(input.bundle+'\nmodule.exports.__negativeService=executarPagamentoSeguro;',sandbox,{timeout:15000});
 service=sandbox.module.exports.__negativeService;
}else{
 const load=require('./tests/load-ts.cjs');service=load(path.resolve('src/functions/rm/post/solicitacaoDePagamentoSeguro.ts')).executarPagamentoSeguro;
}
(async()=>{
 const result=await service(input.fields,{getRemainingTimeInMillis:()=>30000},async()=>{creators++;throw Error('CREATION_FORBIDDEN');},{repositorio:repo,rm});
 const body=JSON.parse(result.body);
 if(result.statusCode!==503||body.PG!==undefined||docs!==1||banks!==1||recons!==1||mutations||saveRecords||creators||network||coreLoads)throw Error('NEGATIVE_FENCE_NOT_PROVEN');
 process.stdout.write(JSON.stringify({statusCode:result.statusCode,code:body.code,reachedDocument:true,bankReads:banks,reconReads:recons,dynamoReads:reads,dynamoMutationCalls:mutations,saveRecordCalls:saveRecords,creatorCalls:creators,legacyCoreLoads:coreLoads,networkCalls:network}));
})().catch(()=>process.exit(2));
"""

def offline_proof(fields,bundle=None):
 # AWS/RM credentials are deliberately removed from the proof subprocess.
 env={k:v for k,v in os.environ.items()if not any(word in k.upper()for word in('AWS','TOKEN','PASSWORD','SECRET','TOTVS'))}
 p=subprocess.run(['node','-e',NEGATIVE_PROOF],cwd=ROOT,input=json.dumps({'fields':fields,'bundle':bundle}),capture_output=True,text=True,encoding='utf-8',timeout=45,env=env)
 require(p.returncode==0,'OFFLINE_NEGATIVE_FENCE_FAILED');value=json.loads(p.stdout)
 require(value.get('statusCode')==503 and value.get('code')in('IDPGTO_NAO_CONFIRMADO','PRE_VALIDACAO_INDISPONIVEL'),'OFFLINE_REJECTION_CODE_CHANGED')
 require(value.get('reachedDocument')is True and all(value.get(k)==0 for k in('dynamoMutationCalls','saveRecordCalls','creatorCalls','legacyCoreLoads','networkCalls')),'OFFLINE_MUTATION_OBSERVED')
 return value

def static_fence():
 source=(ROOT/'src/functions/rm/post/solicitacaoDePagamentoSeguro.ts').read_text(encoding='utf-8')
 document=source.index('validarDocumento(await rm.consultarDocumento(documento), documento)')
 call=source.index('documentoCriacao = documentoCriacao || await validarNovaNota();')
 reserve=source.index('await repo.reservar(')
 require(document<call<reserve,'SOURCE_DOCUMENT_NOT_BEFORE_RESERVATION')
 f=payload();require(int(f['codigoDaFilial2'])==2147483648 and not any(k in f for k in('PG','idDoMovimento','movimentoExistente')),'PROBE_SCOPE_CHANGED')
 require(f['tipoDaSolicitacao']=='PG'and f['tipoDoPagamento']=='NF'and f['tipoDeItem']=='Serviço'and f['tributos']==[],'PROBE_KIND_CHANGED')
 return {'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'impossibleSqlIntBranch':True,'documentBeforeReservation':True}

def parse_report(log_result):
 require(isinstance(log_result,str),'LAMBDA_TAIL_MISSING')
 try:raw=base64.b64decode(log_result,validate=True).decode('utf-8',errors='replace')
 except Exception:raise ProbeError('LAMBDA_TAIL_INVALID')from None
 reports=[line for line in raw.splitlines()if re.match(r'^REPORT RequestId:\s*[A-Za-z0-9-]+\s',line)]
 require(len(reports)==1,'REPORT_NOT_UNIQUE')
 line=reports[0];result={}
 for label,key,unit in [('Duration','durationMs','ms'),('Billed Duration','billedDurationMs','ms'),('Memory Size','memorySizeMb','MB'),('Max Memory Used','maxMemoryUsedMb','MB')]:
  match=re.search(r'(?:^|\t|\s{2,})'+re.escape(label)+r':\s*(\d+(?:\.\d+)?)\s*'+unit+r'\b',line)
  require(match is not None,'REPORT_NUMERIC_FIELD_MISSING');result[key]=float(match.group(1))
 init=re.search(r'(?:^|\t|\s{2,})Init Duration:\s*(\d+(?:\.\d+)?)\s*ms\b',line)
 result['initDurationMs']=float(init.group(1))if init else None
 require(0<result['durationMs']<=120000 and 0<=result['maxMemoryUsedMb']<=result['memorySizeMb'],'REPORT_NUMBERS_OUT_OF_RANGE')
 return result

def safe_response(meta,response):
 require(meta.get('StatusCode')==200 and not meta.get('FunctionError'),'LAMBDA_INVOKE_ERROR')
 require(isinstance(response,dict)and response.get('statusCode')in(503,422),'UNEXPECTED_RUNTIME_STATUS')
 body=json.loads(response.get('body','{}'));require(isinstance(body,dict),'INVALID_RUNTIME_BODY')
 require(not any(k in body for k in('PG','LF','idLans','idDoMovimento','IDLAN')),'UNEXPECTED_FINANCIAL_IDENTIFIER')
 expected={503:{'IDPGTO_NAO_CONFIRMADO','PRE_VALIDACAO_INDISPONIVEL'},422:{'IDPGTO_NAO_CONFIRMADO','DADOS_PAGAMENTO_INVALIDOS','NUMERO_DOCUMENTO_INVALIDO','SERIE_DOCUMENTO_INVALIDA'}}
 require(body.get('code')in expected[response['statusCode']],'UNEXPECTED_RUNTIME_CODE')
 return {'statusCode':response['statusCode'],'code':body['code'],'financialIdentifierReturned':False}

def pinned(cfg):
 require(cfg.get('FunctionName')==FUNCTION and cfg.get('CodeSha256')==BASELINE and cfg.get('RevisionId')==REVISION,'ACTIVE_FUNCTION_DRIFT')
 require(cfg.get('State')=='Active'and cfg.get('LastUpdateStatus')=='Successful','ACTIVE_FUNCTION_NOT_STABLE')
 env=cfg.get('Environment',{}).get('Variables',{})
 require(env.get('STAGE')=='prod'and env.get('PAGAMENTO_IDPGTO_TABLE')==TABLE and env.get('RM_PROD','').rstrip('/')==HOST.replace(':8051',''),'ACTIVE_FUNCTION_ENVIRONMENT_MISMATCH')
 return {'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'timeoutSeconds':cfg['Timeout'],'memorySizeMb':cfg['MemorySize']}

class Client:
 def aws(self,service,operation,*args):
  require((service,operation)in{('sts','get-caller-identity'),('lambda','get-function-configuration'),('lambda','get-function'),('dynamodb','get-item'),('lambda','invoke')},'AWS_OPERATION_FORBIDDEN')
  command=['aws',service,operation,*args,'--region',REGION,'--output','json','--no-cli-pager','--cli-connect-timeout','5','--cli-read-timeout','50']
  try:p=subprocess.run(command,capture_output=True,text=True,timeout=70,env={**os.environ,'AWS_MAX_ATTEMPTS':'1','AWS_RETRY_MODE':'standard','AWS_PAGER':''})
  except subprocess.TimeoutExpired:raise ProbeError('AWS_CALL_TIMEOUT_NO_RETRY')from None
  require(p.returncode==0,'AWS_CALL_FAILED_NO_RETRY');return json.loads(p.stdout or'{}')
 def config(self):return self.aws('lambda','get-function-configuration','--function-name',FUNCTION)
 def root(self):return self.aws('dynamodb','get-item','--table-name',TABLE,'--consistent-read','--key',json.dumps({'pk':{'S':PK}})).get('Item')
 def active_bundle(self):
  result=self.aws('lambda','get-function','--function-name',FUNCTION);pinned(result['Configuration'])
  with urllib.request.urlopen(result['Code']['Location'],timeout=25)as response:blob=response.read(80_000_001)
  require(len(blob)<=80_000_000 and base64.b64encode(hashlib.sha256(blob).digest()).decode()==BASELINE,'ACTIVE_PACKAGE_HASH_MISMATCH')
  with zipfile.ZipFile(io.BytesIO(blob))as package:
   entries={}
   for item in package.infolist():
    name=item.filename.replace('\\','/');require(name not in entries and not name.startswith('/')and'..'not in name.split('/'),'UNSAFE_ACTIVE_PACKAGE')
    entries[name]=item
   entry=package.read(entries[ENTRY]);core=package.read(entries[CORE_ENTRY])
  require(hashlib.sha256(core).hexdigest()==CORE,'ORIGINAL_CORE_HASH_CHANGED')
  code=entry.decode('utf-8');queries=set(re.findall(r'RealizaConsulta/(RAIZ\.PG\.DOC2?)/0/T',code))
  require(len(queries)==1,'ACTIVE_DOCUMENT_QUERY_AMBIGUOUS')
  return code,next(iter(queries))
 def native_fence(self,cfg,query):
  filename='pagamento-documento-v2.sql'if query=='RAIZ.PG.DOC2'else'pagamento-documento.sql'
  expected=(ROOT/'sql'/filename).read_text(encoding='utf-8-sig').replace('\r\n','\n').strip()
  require(re.search(r'CAST\s*\(\s*:CODFILIAL\s+AS\s+INT\s*\)',expected,re.I),'NATIVE_SQL_INT_FENCE_MISSING')
  env=cfg['Environment']['Variables'];require(env.get('USERNAME_TOTVS')and env.get('PASSWORD_TOTVS'),'RM_READ_CREDENTIALS_MISSING')
  auth='Basic '+base64.b64encode((env['USERNAME_TOTVS']+':'+env['PASSWORD_TOTVS']).encode()).decode()
  envelope=ET.Element('{http://schemas.xmlsoap.org/soap/envelope/}Envelope');body=ET.SubElement(envelope,'{http://schemas.xmlsoap.org/soap/envelope/}Body');op=ET.SubElement(body,'ReadRecord',xmlns='http://www.totvs.com/')
  for k,v in {'DataServerName':'GlbConsSQLData','PrimaryKey':'0;T;'+query,'Contexto':f"CODCOLIGADA=0;CODSISTEMA=G;CODUSUARIO={env['USERNAME_TOTVS']}"}.items():ET.SubElement(op,k).text=v
  request=urllib.request.Request(HOST+'/wsDataServer/IwsDataServer',data=ET.tostring(envelope),headers={'Authorization':auth,'Content-Type':'text/xml;charset=UTF-8','SOAPAction':'http://www.totvs.com/IwsDataServer/ReadRecord'})
  with urllib.request.urlopen(request,timeout=20)as response:raw=response.read(2_000_001)
  require(len(raw)<=2_000_000 and b'<!DOCTYPE'not in raw and b'<!ENTITY'not in raw,'UNSAFE_NATIVE_CONTRACT_RESPONSE')
  answer=ET.fromstring(raw).find('.//{http://www.totvs.com/}ReadRecordResult');require(answer is not None and answer.text,'NATIVE_CONTRACT_RESULT_MISSING')
  rows=ET.fromstring(answer.text).findall('GConsSql');require(len(rows)==1,'NATIVE_CONTRACT_NOT_UNIQUE')
  actual=rows[0].findtext('SENTENCA','').replace('\r\n','\n').strip();require(actual==expected,'NATIVE_DOCUMENT_CONTRACT_DRIFT')
  return {'query':query,'sqlSha256':hashlib.sha256(actual.encode()).hexdigest(),'intBranchCastConfirmed':True}
 def invoke(self):
  with tempfile.TemporaryDirectory()as tmp:
   request=Path(tmp)/'synthetic-request.json';reply=Path(tmp)/'lambda-reply.json'
   request.write_text(json.dumps({'body':json.dumps(payload(),ensure_ascii=False)},ensure_ascii=False),encoding='utf-8')
   meta=self.aws('lambda','invoke','--function-name',FUNCTION,'--invocation-type','RequestResponse','--log-type','Tail','--payload','fileb://'+str(request),str(reply))
   require(reply.stat().st_size<=1_000_000,'INVOKE_RESPONSE_TOO_LARGE')
   response=json.loads(reply.read_text(encoding='utf-8'));return meta,response

def run_guarded(client,evidence,save):
 for index in range(3):
  before=pinned(client.config());require(client.root()is None,'SYNTHETIC_ROOT_ALREADY_EXISTS')
  record={'iteration':index+1,'observedUtc':now(),'rootAbsentBefore':True,'invokeAttempted':True}
  evidence['iterations'].append(record);save(evidence)
  started=time.perf_counter();error=None;meta=None;response=None
  try:meta,response=client.invoke()
  except Exception as exc:error=exc
  elapsed=round((time.perf_counter()-started)*1000,2)
  # Even a lost response is followed by the control reads; never repeat it.
  record['invokeWallMs']=elapsed
  try:
   absent=client.root()is None;record['rootAbsentAfter']=absent
   after=pinned(client.config());record['activeVersionUnchanged']=before==after
  except Exception as exc:
   record['postControlReadConfirmed']=False;save(evidence)
   raise ProbeError(str(exc)if isinstance(exc,ProbeError)else'POST_INVOKE_CONTROL_READ_FAILED')from None
  save(evidence)
  require(absent,'SYNTHETIC_ROOT_UNEXPECTEDLY_CREATED');require(before==after,'RUNTIME_DRIFT_DURING_PROBE')
  if error:raise ProbeError('INVOKE_OUTCOME_UNCERTAIN_NO_RETRY')from None
  record.update(safe_response(meta,response));record['report']=parse_report(meta.get('LogResult'));save(evidence)
 return evidence

def main():
 require(os.environ.get('GITHUB_ACTIONS')=='true'and os.environ.get('PAYMENT_RUNTIME_TIMING_MODE')=='probe','EXPLICIT_CI_PROBE_MODE_REQUIRED')
 require(os.environ.get('GITHUB_RUN_ATTEMPT')=='1','WORKFLOW_RERUN_FORBIDDEN')
 client=Client();require(client.aws('sts','get-caller-identity')['Account']==ACCOUNT,'AWS_ACCOUNT_MISMATCH')
 evidence={'observedUtc':now(),'function':FUNCTION,'syntheticTicket':TICKET,'businessWritesExpected':False,'configurationWrites':False,'iterations':[],
  'measurement':'REJECTED_REQUEST_RUNTIME_DURATION','runtimePhase':'prevalidation_rejection_uninstrumented','fullEightReadPreflightMeasured':False}
 OUT.mkdir(exist_ok=True)
 def save(value):(OUT/'timing.json').write_text(json.dumps(value,indent=2),encoding='utf-8')
 try:
  cfg=client.config();evidence['activeFunction']=pinned(cfg);require(client.root()is None,'SYNTHETIC_ROOT_ALREADY_EXISTS')
  evidence['sourceFence']=static_fence();evidence['sourceNegativeProof']=offline_proof(payload())
  bundle,query=client.active_bundle();evidence['activeBundleNegativeProof']=offline_proof(payload(),bundle)
  evidence['nativeFence']=client.native_fence(cfg,query);save(evidence)
  run_guarded(client,evidence,save);evidence['completed']=True;save(evidence)
  print(json.dumps({'completed':True,'iterations':[{'statusCode':x['statusCode'],'code':x['code'],**x['report']}for x in evidence['iterations']]}))
 except Exception as exc:
  evidence['completed']=False;evidence['stoppedCode']=str(exc)if isinstance(exc,ProbeError)else'UNEXPECTED_READ_FAILURE';save(evidence);raise

if __name__=='__main__':
 try:main()
 except Exception as exc:print(json.dumps({'status':'STOPPED_NO_RETRY','code':str(exc)if isinstance(exc,ProbeError)else'UNEXPECTED_READ_FAILURE'}));raise SystemExit(2)
