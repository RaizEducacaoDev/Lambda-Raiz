const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./load-ts.cjs');
test('SOAP e consultas HTTP compartilham timeout, abort e reserva de orçamento',async()=>{
 let remaining=30000;const requests=[];
 const fake={
  get:async(url,options)=>{requests.push({url,options});return {data:url.includes('0041')?[{CODLOC:'01'}]:[{IDMOV:9001}]};},
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
test('consulta0059 nunca converte erro/objeto inesperado em ausência de movimento',async()=>{
 let data={error:'RM indisponível'};
 const {PrazoPagamento,TransportePagamentoV2}=load(path.resolve(__dirname,'../src/functions/rm/post/pagamentoV2Rm.ts'),{
  axios:{get:async()=>({data})},
  '../../../utils/wsDataserver':{wsDataserver:class{getUrl(){return 'http://test.invalid';}getCredentials(){return 'synthetic';}}},
 });
 const rm=new TransportePagamentoV2(new PrazoPagamento(()=>30000));
 for(const invalid of [data,null,[{}],[{IDMOV:0}],[{IDMOV:9007199254740992}]]){
  data=invalid;await assert.rejects(()=>rm.buscarMovimentosPorTicket('8','9003','1.2.11'));
 }
 data=[];assert.deepEqual(await rm.buscarMovimentosPorTicket('8','9003','1.2.11'),[]);
});
