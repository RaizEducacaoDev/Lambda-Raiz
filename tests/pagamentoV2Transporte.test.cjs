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
 for(const r of requests){assert.equal(r.options.timeout,8000);assert.ok(r.options.signal instanceof AbortSignal);}
 remaining=6500;await rm.buscarEstoque('8','4');assert.ok(requests.at(-1).options.timeout<=3500);
 remaining=3000;const count=requests.length;await assert.rejects(()=>rm.buscarEstoque('8','4'),/Tempo insuficiente/);assert.equal(requests.length,count);
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
