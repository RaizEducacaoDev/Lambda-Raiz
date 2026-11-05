const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./load-ts.cjs');
const reconRow=changes=>({RECON_VERSION:1,REQUEST_COMPANY:8,REQUEST_TICKET:'9003',TOTAL_MOVEMENTS:1,
 CODCOLIGADA:8,IDMOV:9001,CODFILIAL:4,CODCFO:'0000000001',CODCOLCFO:0,CODTMV:'1.2.11',STATUS:'F',TICKET:'9003',...changes});
test('todos os GETs e POSTs preservam corpo nativo do erro HTTP sem transmitir config ou headers',async()=>{
 const failure=Object.assign(Error('AxiosLocalPrivate'),{response:{status:500,data:{Message:'Campo IDPRD não foi informado.',ExceptionMessage:'Senha: privatePassword'}},config:{headers:{Authorization:'Basic privateCredential'}}});
 let calls=0;
 const {PrazoPagamento,TransportePagamentoV2}=load(path.resolve(__dirname,'../src/functions/rm/post/pagamentoV2Rm.ts'),{
  axios:{get:async()=>{calls++;throw failure},post:async()=>{calls++;throw failure}},
  '../../../utils/wsDataserver':{wsDataserver:class{getUrl(){return 'http://test.invalid'}getCredentials(){return 'synthetic'}}},
 });
 const rm=new TransportePagamentoV2(new PrazoPagamento(()=>30000));
 const actions=[()=>rm.readReacord('8;9001','MovMovimentoTBCData','ctx'),()=>rm.saveRecord('<x/>','FinLanDataBR','ctx'),
  ()=>rm.buscarMovimentosPorTicket('8','9003','1.2.03'),()=>rm.buscarEstoque('8','4'),()=>rm.consultarRetomada('8','9003'),
  ()=>rm.consultarContextoFiscal({codColigada:'8',codFilial:'4',codColCfo:'0',codCfo:'0000000001',idNat:'3'}),
  ()=>rm.consultarDocumento({codColigada:'8',codFilial:'4',codColCfo:'0',codCfo:'0000000001',codTmv:'1.2.03',numero:'1',serie:'1'})];
 for(const action of actions)await assert.rejects(action,error=>{
  assert.equal(error.name,'ErroNativoRm');assert.ok(error.mensagemNativa.includes('IDPRD'));assert.equal(error.status,503);
  for(const privateValue of ['privatePassword','privateCredential','AxiosLocalPrivate','config','headers'])assert.ok(!JSON.stringify(error).includes(privateValue));
  return true;
 });
 assert.equal(calls,7);
});
test('SOAP Fault e resultado ReadRecord textual mantêm a descrição e rede sem resposta conserva o erro original',async()=>{
 let data='<s:Envelope><s:Body><s:Fault><faultstring>Produto fictício não permitido.</faultstring></s:Fault></s:Body></s:Envelope>';
 let failure;
 const modules=new Map();
 const {PrazoPagamento,TransportePagamentoV2,registroUnico}=load(path.resolve(__dirname,'../src/functions/rm/post/pagamentoV2Rm.ts'),{
  axios:{post:async()=>{if(failure)throw failure;return {data}}},
  '../../../utils/wsDataserver':{wsDataserver:class{getUrl(){return 'http://test.invalid'}getCredentials(){return 'synthetic'}}},
 },modules);
 const rm=new TransportePagamentoV2(new PrazoPagamento(()=>30000));
 await assert.rejects(()=>rm.saveRecord('<x/>','MovMovimentoTBCData','ctx'),e=>e.name==='ErroNativoRm' && e.message.includes('Produto fictício'));
 data='<s:Envelope><s:Body><ReadRecordResponse><ReadRecordResult>O registro fiscal não foi localizado.</ReadRecordResult></ReadRecordResponse></s:Body></s:Envelope>';
 assert.throws(()=>registroUnico('O registro fiscal não foi localizado.','TMOV'),e=>e.name==='ErroNativoRm' && e.message.includes('registro fiscal'));
 data='<s:Envelope><s:Body><ReadRecordResponse><Message>O período fiscal foi encerrado.</Message></ReadRecordResponse></s:Body></s:Envelope>';
 await assert.rejects(()=>rm.readReacord('8;1','MovMovimentoTBCData','ctx'),e=>e.name==='ErroNativoRm' && e.message.includes('período fiscal'));
 assert.throws(()=>registroUnico('<Error><Message>O cadastro fiscal não foi localizado.</Message></Error>','TMOV'),e=>e.name==='ErroNativoRm' && e.message.includes('cadastro fiscal'));
 failure=Object.assign(Error('private network diagnostic'),{code:'ETIMEDOUT'});
 await assert.rejects(()=>rm.readReacord('8;1','MovMovimentoTBCData','ctx'),e=>e===failure);
});
test('SOAP e consultas HTTP compartilham timeout, abort e reserva de orçamento',async()=>{
 let remaining=30000;const requests=[];
 const fake={
  get:async(url,options)=>{requests.push({url,options});return {data:url.includes('0041')?[{CODLOC:'01'}]:[reconRow()]};},
  post:async(url,xml,options)=>{requests.push({url,options});return {data:'<s:Envelope><s:Body><SaveRecordResponse><SaveRecordResult>8;9001</SaveRecordResult></SaveRecordResponse></s:Body></s:Envelope>'};},
 };
 const {PrazoPagamento,TransportePagamentoV2}=load(path.resolve(__dirname,'../src/functions/rm/post/pagamentoV2Rm.ts'),{
  axios:fake,
  '../../../utils/wsDataserver':{wsDataserver:class{getUrl(){return 'http://test.invalid';}getCredentials(){return 'synthetic';}}},
 });
 const rm=new TransportePagamentoV2(new PrazoPagamento(()=>remaining));
 assert.equal(await rm.buscarEstoque('8','4'),'01');
 assert.deepEqual(await rm.buscarMovimentosPorTicket('8','9003','1.2.11'),['9001']);
 assert.equal(await rm.saveRecord('<xml/>','MovMovimentoTBCData','ctx'),'8;9001');
 for(const r of requests){assert.equal(r.options.timeout,r===requests.at(-1)?15000:8000);assert.ok(r.options.signal instanceof AbortSignal);}
 remaining=6500;await rm.buscarEstoque('8','4');assert.ok(requests.at(-1).options.timeout<=3500);
 remaining=3000;const count=requests.length;await assert.rejects(()=>rm.buscarEstoque('8','4'),/Tempo insuficiente/);assert.equal(requests.length,count);
});
test('criação tem cap15s com reserva12s e exige janela mínima antes de qualquer HTTP',async()=>{
 let remaining=30000;const requests=[];
 const {PrazoPagamento,TransportePagamentoV2}=load(path.resolve(__dirname,'../src/functions/rm/post/pagamentoV2Rm.ts'),{
  axios:{post:async(url,xml,options)=>{requests.push(options);return {data:'<s:Envelope><s:Body><SaveRecordResponse><SaveRecordResult>8;9001</SaveRecordResult></SaveRecordResponse></s:Body></s:Envelope>'};}},
  '../../../utils/wsDataserver':{wsDataserver:class{getUrl(){return 'http://test.invalid';}getCredentials(){return 'synthetic';}}},
 });
 const prazo=new PrazoPagamento(()=>remaining),rm=new TransportePagamentoV2(prazo);
 assert.equal(prazo.timeoutCriacao(2500),15000);
 assert.equal(await rm.saveRecord('<xml/>','MovMovimentoTBCData','ctx'),'8;9001');assert.equal(requests[0].timeout,15000);
 remaining=24000;const computed=prazo.timeoutCriacao(2500);assert.ok(computed<=9500&&computed>=9000);
 remaining=22000;assert.throws(()=>prazo.timeoutCriacao(2500),/antes de enviar/);
 remaining=20000;const count=requests.length;await assert.rejects(()=>rm.saveRecord('<xml/>','MovMovimentoTBCData','ctx'),/antes de enviar/);assert.equal(requests.length,count);
});
test('SaveRecord de movimento pode responder depois de8s sem disparar o AbortSignal',async()=>{
 let elapsed=0;
 const {PrazoPagamento,TransportePagamentoV2}=load(path.resolve(__dirname,'../src/functions/rm/post/pagamentoV2Rm.ts'),{
  axios:{post:async(url,xml,options)=>{
    const started=Date.now();
    await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,9000);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('unexpected abort'));},{once:true});});
    elapsed=Date.now()-started;return {data:'<s:Envelope><s:Body><SaveRecordResponse><SaveRecordResult>8;9001</SaveRecordResult></SaveRecordResponse></s:Body></s:Envelope>'};
  }},
  '../../../utils/wsDataserver':{wsDataserver:class{getUrl(){return 'http://test.invalid';}getCredentials(){return 'synthetic';}}},
 });
 const rm=new TransportePagamentoV2(new PrazoPagamento(()=>30000));
 assert.equal(await rm.saveRecord('<xml/>','MovMovimentoTBCData','ctx'),'8;9001');assert.ok(elapsed>=8500);
});
test('consulta completa de reconciliação nunca converte erro, truncamento ou contrato antigo em ausência',async()=>{
 let data={error:'RM indisponível'};
 const {PrazoPagamento,TransportePagamentoV2}=load(path.resolve(__dirname,'../src/functions/rm/post/pagamentoV2Rm.ts'),{
  axios:{get:async()=>({data})},
  '../../../utils/wsDataserver':{wsDataserver:class{getUrl(){return 'http://test.invalid';}getCredentials(){return 'synthetic';}}},
 });
 const rm=new TransportePagamentoV2(new PrazoPagamento(()=>30000));
 for(const invalid of [data,null,[],[{}],[{IDMOV:0}],[{IDMOV:9007199254740992}],[reconRow({TOTAL_MOVEMENTS:2})]]){
  data=invalid;await assert.rejects(()=>rm.buscarMovimentosPorTicket('8','9003','1.2.11'));
 }
 data=[{RECON_VERSION:1,REQUEST_COMPANY:8,REQUEST_TICKET:'9003',TOTAL_MOVEMENTS:0}];assert.deepEqual(await rm.buscarMovimentosPorTicket('8','9003','1.2.11'),[]);
});
test('reconciliação usa somente coligada/ticket e filtra CODTMV depois de validar todas as linhas',async()=>{
 let data=[reconRow({TOTAL_MOVEMENTS:3}),reconRow({TOTAL_MOVEMENTS:3,IDMOV:9002,CODTMV:'1.1.01',CODFILIAL:null,CODCFO:null,CODCOLCFO:null}),reconRow({TOTAL_MOVEMENTS:3,IDMOV:9003,CODTMV:'1.1.02'})];const requests=[];
 const {PrazoPagamento,TransportePagamentoV2}=load(path.resolve(__dirname,'../src/functions/rm/post/pagamentoV2Rm.ts'),{
  axios:{get:async(url,options)=>{requests.push({url,options});return {data};}},
  '../../../utils/wsDataserver':{wsDataserver:class{getUrl(){return 'http://test.invalid';}getCredentials(){return 'synthetic';}}},
 });
 const rm=new TransportePagamentoV2(new PrazoPagamento(()=>30000));assert.deepEqual(await rm.buscarMovimentosPorTicket('8','9003','1.2.11'),['9001']);
 const url=new URL(requests[0].url);assert.equal(url.pathname,'/api/framework/v1/consultaSQLServer/RealizaConsulta/RAIZ.PG.RECON/0/T');
 assert.equal(url.searchParams.get('parameters'),'CODCOLIGADA=8;TICKET=9003');assert.equal(url.searchParams.get('parameters').includes('CODTMV'),false);
 data=[reconRow({TOTAL_MOVEMENTS:2}),reconRow({TOTAL_MOVEMENTS:2,IDMOV:9002,CODTMV:'1.1.01',CODCOLIGADA:31})];await assert.rejects(()=>rm.buscarMovimentosPorTicket('8','9003','1.2.11'));
 const count=requests.length;await assert.rejects(()=>rm.buscarMovimentosPorTicket('8','9003;CODTMV=1.1.01','1.2.11'));assert.equal(requests.length,count);
});
test('consulta fiscal usa somente RAIZ.PG.FISC/0/T, parâmetros codificados e mesmo prazo/abort',async()=>{
 const requests=[],data=[{FISCAL_VERSION:1}];
 const {PrazoPagamento,TransportePagamentoV2}=load(path.resolve(__dirname,'../src/functions/rm/post/pagamentoV2Rm.ts'),{
  axios:{get:async(url,options)=>{requests.push({url,options});return {data};}},
  '../../../utils/wsDataserver':{wsDataserver:class{getUrl(){return 'http://test.invalid';}getCredentials(){return 'synthetic';}}},
 });
 let remaining=30000;const rm=new TransportePagamentoV2(new PrazoPagamento(()=>remaining));
 assert.equal(await rm.consultarContextoFiscal({codColigada:'11',codFilial:'1',codColCfo:'0',codCfo:'0000000001',idNat:'121'}),data);
 const url=new URL(requests[0].url);assert.equal(url.pathname,'/api/framework/v1/consultaSQLServer/RealizaConsulta/RAIZ.PG.FISC/0/T');
 assert.deepEqual([...url.searchParams.keys()],['parameters']);assert.equal(url.searchParams.get('parameters'),'CODCOLIGADA=11;CODFILIAL=1;CODCOLCFO=0;CODCFO=0000000001;IDNAT=121');
 assert.ok(requests[0].url.includes('%3B'));assert.equal(requests[0].options.timeout,8000);assert.ok(requests[0].options.signal instanceof AbortSignal);
 await assert.rejects(()=>rm.consultarContextoFiscal({codColigada:'11',codFilial:'1',codColCfo:'0',codCfo:'fixture;IDNAT=999',idNat:'121'}),/Chave de consulta fiscal inválida/);assert.equal(requests.length,1);
 remaining=3000;await assert.rejects(()=>rm.consultarContextoFiscal({codColigada:'11',codFilial:'1',codColCfo:'0',codCfo:'0000000001',idNat:'121'}),/Tempo insuficiente/);assert.equal(requests.length,1);
});

test('consulta documental usa contrato isolado, sentinela de série ausente, abort e rejeita injeção antes do HTTP',async()=>{
 const requests=[],data=[{DOC_VERSION:2}];let remaining=30000;
 const {PrazoPagamento,TransportePagamentoV2}=load(path.resolve(__dirname,'../src/functions/rm/post/pagamentoV2Rm.ts'),{
  axios:{get:async(url,options)=>{requests.push({url,options});return {data};}},
  '../../../utils/wsDataserver':{wsDataserver:class{getUrl(){return 'http://test.invalid';}getCredentials(){return 'synthetic';}}},
 });
 const rm=new TransportePagamentoV2(new PrazoPagamento(()=>remaining));
 const key={codColigada:'9',codFilial:'3',codColCfo:'0',codCfo:'0000154129',codTmv:'1.2.03',numero:'114',serie:''};
 assert.equal(await rm.consultarDocumento(key),data);
 const url=new URL(requests[0].url);assert.equal(url.pathname,'/api/framework/v1/consultaSQLServer/RealizaConsulta/RAIZ.PG.DOC2/0/T');
 assert.equal(url.searchParams.get('parameters'),'CODCOLIGADA=9;CODFILIAL=3;CODCOLCFO=0;CODCFO=0000154129;CODTMV=1.2.03;NUMERO=114;SERIE=~');
 assert.equal(requests[0].options.timeout,8000);assert.ok(requests[0].options.signal instanceof AbortSignal);
 for(const changes of [{codCfo:'PRIVATE;CODCOLIGADA=31'},{numero:'1234567890'},{serie:'1;X=9'},{serie:'~'},{codTmv:'1.1.01'}]){
  await assert.rejects(()=>rm.consultarDocumento({...key,...changes}),/consulta do documento inválida/);
 }
 assert.equal(requests.length,1);remaining=3000;await assert.rejects(()=>rm.consultarDocumento(key),/Tempo insuficiente/);assert.equal(requests.length,1);
});

test('consulta documental permite os dez tipos PG e mantém cada CODTMV no escopo HTTP',async()=>{
 const requests=[];
 const {PrazoPagamento,TransportePagamentoV2}=load(path.resolve(__dirname,'../src/functions/rm/post/pagamentoV2Rm.ts'),{
  axios:{get:async(url)=>{requests.push(new URL(url));return {data:[]};}},
  '../../../utils/wsDataserver':{wsDataserver:class{getUrl(){return 'http://test.invalid';}getCredentials(){return 'synthetic';}}},
 });
 const rm=new TransportePagamentoV2(new PrazoPagamento(()=>30000));
 for(const codTmv of ['1.2.01','1.2.03','1.2.25','1.2.09','1.2.10','1.2.11','1.2.12','1.2.16','1.2.08','1.2.17']){
  await rm.consultarDocumento({codColigada:'9',codFilial:'3',codColCfo:'0',codCfo:'0000000001',codTmv,numero:'00114',serie:''});
  assert.ok(requests.at(-1).searchParams.get('parameters').includes(`CODTMV=${codTmv};NUMERO=00114;SERIE=~`));
 }
 assert.equal(requests.length,10);
});
