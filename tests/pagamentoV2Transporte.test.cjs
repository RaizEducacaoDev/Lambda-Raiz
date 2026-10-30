const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./load-ts.cjs');
const reconRow=changes=>({RECON_VERSION:1,REQUEST_COMPANY:8,REQUEST_TICKET:'9003',TOTAL_MOVEMENTS:1,
 CODCOLIGADA:8,IDMOV:9001,CODFILIAL:4,CODCFO:'0000000001',CODCOLCFO:0,CODTMV:'1.2.11',STATUS:'F',TICKET:'9003',...changes});
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
