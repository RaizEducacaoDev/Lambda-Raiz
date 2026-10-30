const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const modules=new Map(),load=file=>require('./load-ts.cjs')(path.resolve(__dirname,'../src/functions/rm/post',file),{},modules);
const {executarPagamentoSeguro}=load('solicitacaoDePagamentoSeguro.ts');
const {codigoMovimento,identidadePagamento,planosPagamento,intencaoPagamento,hashIntencao}=load('pagamentoIdentidade.ts');
const {registroUnico}=load('pagamentoV2Rm.ts');
const {parsearReconciliacaoPagamento}=load('pagamentoReconciliacao.ts');
const xml=(name,data)=>`<${name}>${Object.entries(data).map(([k,v])=>`<${k}>${v}</${k}>`).join('')}</${name}>`;
const dataset=(name,data)=>`<Fixture>${xml(name,data)}</Fixture>`;
const parse=result=>JSON.parse(result.body);
function setup(options={}){
 const fields={tipoDaSolicitacao:'PG',tipoDoPagamento:'NF',tipoDeItem:'Serviço',atividadeAtual:'aprovacaoDoGestor',
  ticketRaiz:'9003',codigoDaColigada2:'11',codigoDaFilial2:'1',codigoDoFornecedor:'0000000001',CODCOLCFO:'0',
  idpgto:'2',CODCOLPGTO:'11',numeroDaNF:'9003001',idDaNaturezaFiscal:'121',codigoDaNaturezaFiscal:'1.949.01',
  dataDeEmissao:'2026-10-26',dataDeEntrada:'2026-10-30',dataDeVencimento:'2026-12-31',valorTotal:'100,00',
  codigoTipoChavePIX:'2',chavePIX:'fixture@example.test',itens:[],tributos:[],...options.fields};
 const calls={reserve:0,create:0,bankWrite:0,fiscal:0,lookup:0,movementRead:0,order:[]},records=new Map();
 let lan={CODCOLIGADA:'11',IDLAN:'9002',IDMOV:'9001',CODFILIAL:'1',CODCFO:'0000000001',CODCOLCFO:'0',
  DATAVENCIMENTO:'2026-12-31',VALORORIGINAL:'100.0000',STATUSLAN:'0',VALORBAIXADO:'0',BAIXAPENDENTE:'0',
  ...(options.complete||fields.idDoMovimento?{IDPGTO:'2',CODCOLPGTO:'11'}:{})};
 const repo={
  async concluida(pk,digest,pg){calls.order.push('concluida');if(options.complete&&!pk.includes('#FLAN#'))return {pk,digest,pg:'9001',state:'COMPLETE',owner:'fixture',lockUntil:Date.now()+90000};return undefined;},
  async movimentoConhecido(){calls.order.push('movimentoConhecido');return undefined;},
  async reservar(pk,digest,pg){calls.reserve++;calls.order.push('reservar');pg=options.reservePg||pg;const op={pk,digest,pg,state:pg?'CREATED':'RESERVED',owner:'fixture',lockUntil:Date.now()+90000};records.set(pk,op);return op;},
  async avancar(op,state,pg=op.pg){const next={...op,state,...(pg?{pg}:{})};records.set(op.pk,next);return next;},
 };
 const rm={
  async consultarContextoFiscal(key){calls.fiscal++;calls.order.push('fiscal');if(options.fiscalError)throw Error('fixture unavailable');
   const row={FISCAL_VERSION:1,REQUEST_COMPANY:11,REQUEST_BRANCH:1,REQUEST_SUPPLIER_COMPANY:0,REQUEST_SUPPLIER:'0000000001',
    REQUEST_NATURE:Number(key.idNat),HAS_SUPPLIER:1,HAS_BRANCH:1,HAS_NATURE:1,NATURE_COMPANY:11,NATURE_ID:Number(key.idNat),
    NATURE_CODE:fields.codigoDaNaturezaFiscal||'1.949.01',NATURE_ACTIVE:1,NATURE_ROUTE:'D',SUPPLIER_UF:'RJ',SUPPLIER_COUNTRY_ID:1,BRANCH_UF:'RS',BRANCH_COUNTRY_ID:1,...options.native};
   return options.fiscalResponse===undefined?[row]:options.fiscalResponse;},
  async buscarMovimentosPorTicket(coligada,ticket,codTmv){calls.lookup++;calls.order.push('lookup');
   if(options.lookupErrorAt===calls.lookup)throw Error('fixture query unavailable');
   if(options.reconResponse!==undefined)return parsearReconciliacaoPagamento(options.reconResponse,coligada,ticket,codTmv).filter(m=>m.CODTMV===codTmv).map(m=>m.IDMOV);
   if(options.lookupSequence)return options.lookupSequence[Math.min(calls.lookup-1,options.lookupSequence.length-1)];
   return options.lookup||[];},async buscarEstoque(){return '01.001';},
  async readReacord(key,server){
   if(server==='FinDadosPgtoDataBR'){calls.order.push('bank');return dataset('FDadosPgto',{CODCOLIGADA:'11',CODCOLCFO:'0',CODCFO:'0000000001',IDPGTO:'2',ATIVO:'1',FORMAPAGAMENTO:'S',TIPOPIX:'2',CHAVE:'fixture@example.test'});}
   if(server==='MovMovimentoTBCData'){calls.movementRead++;if(options.movementReadErrorAt===calls.movementRead)throw Error('fixture read unavailable');
    return `<MovMovimento>${xml('TMOV',{CODCOLIGADA:'11',IDMOV:'9001',CODFILIAL:'1',CODCFO:'0000000001',CODCOLCFO:'0',CODTMV:codigoMovimento(fields),STATUS:'F',...options.movement})}${xml('TMOVCOMPL',{CODCOLIGADA:'11',IDMOV:'9001',TICKET:'9003'})}${xml('TMOVPAGTO',{CODCOLIGADA:'11',IDMOV:'9001',IDLAN:'9002',DATAVENCIMENTO:'2026-12-31',VALOR:'100.0000'})}</MovMovimento>`;}
   return dataset('FLAN',lan);
  },
  async saveRecord(content,server){if(server==='MovMovimentoTBCData'){calls.create++;return '11;9001';}
   calls.bankWrite++;lan={...lan,...registroUnico(content.slice(9,-3),'FLAN')};return '11;9002';},
 };
 const create=async(input,transport)=>{await transport.saveRecord(`<![CDATA[<MovMovimento>${xml('TMOV',{CODCOLIGADA:'11',CODFILIAL:'1',CODCFO:'0000000001',CODCOLCFO:'0',CODTMV:codigoMovimento(input)})}${xml('TMOVCOMPL',{TICKET:'9003'})}</MovMovimento>]]>`,'MovMovimentoTBCData','fixture');return {statusCode:200,body:'{}'};};
 const run=()=>executarPagamentoSeguro(fields,{getRemainingTimeInMillis:()=>30000},create,{repositorio:repo,rm});
 const digest=()=>{const key=identidadePagamento(fields);return hashIntencao(intencaoPagamento(fields,key,planosPagamento(fields,key),codigoMovimento(fields)));};
 return {fields,calls,records,run,digest};
}

test('novo121/RJ_RS retorna422 específico antes de qualquer reserva ou efeito',async()=>{
 const x=setup(),snapshot=JSON.stringify(x.fields),digest=x.digest();const result=await x.run();
 assert.equal(result.statusCode,422);assert.equal(parse(result).code,'NATUREZA_FISCAL_INCOMPATIVEL');assert.match(parse(result).message,/RJ.*RS/);
 assert.equal(x.calls.fiscal,1);assert.deepEqual(x.calls.order,['concluida','bank','movimentoConhecido','lookup','fiscal']);
 assert.equal(x.calls.reserve,0);assert.equal(x.calls.create,0);assert.equal(x.calls.bankWrite,0);assert.equal(x.records.size,0);
 assert.equal(JSON.stringify(x.fields),snapshot);assert.equal(x.digest(),digest);
});
test('F/RJ_RS e D/RJ_RJ válidos seguem protocolo completo sem mudar intenção ou natureza',async()=>{
 for(const options of [{fields:{idDaNaturezaFiscal:'166',codigoDaNaturezaFiscal:'2.949.01'},native:{NATURE_ROUTE:'F'}},{native:{BRANCH_UF:'RJ'}}]){
  const x=setup(options),snapshot=JSON.stringify(x.fields),digest=x.digest();assert.equal((await x.run()).statusCode,200);
  assert.equal(x.calls.fiscal,1);assert.equal(x.calls.create,1);assert.equal(x.calls.bankWrite,1);assert.equal(x.calls.order.indexOf('fiscal')<x.calls.order.indexOf('reservar'),true);
  const root=[...x.records.values()].find(r=>!r.pk.includes('#FLAN#'));assert.equal(root.digest,digest);assert.equal(root.state,'COMPLETE');assert.equal(JSON.stringify(x.fields),snapshot);
 }
});
test('ID inválido, código divergente, FK ausente ou inativa nunca reserva',async()=>{
 for(const options of [{fields:{idDaNaturezaFiscal:''}},{fields:{idDaNaturezaFiscal:'invalid'}},
  {native:{NATURE_CODE:'2.949.01'}},{native:{HAS_SUPPLIER:0}},{native:{HAS_BRANCH:0}},{native:{HAS_NATURE:0}},{native:{NATURE_ACTIVE:0}}]){
  const x=setup(options),result=await x.run();assert.equal(result.statusCode,422);assert.equal(parse(result).code,'NATUREZA_FISCAL_INCOMPATIVEL');
  assert.equal(x.calls.reserve,0);assert.equal(x.calls.create,0);assert.equal(x.records.size,0);
 }
});
test('consulta indisponível, contrato errado ou incompleto retorna503 sem reserva',async()=>{
 for(const options of [{fiscalError:true},{fiscalResponse:[]},{fiscalResponse:[{},{}]},{native:{REQUEST_COMPANY:31}},
  {native:{REQUEST_SUPPLIER_COMPANY:1}},{native:{REQUEST_SUPPLIER:'OTHER'}},{native:{REQUEST_NATURE:122}},
  {native:{NATURE_ID:122}},{native:{NATURE_COMPANY:31}},{native:{SUPPLIER_COUNTRY_ID:undefined}},{native:{SUPPLIER_UF:undefined}}]){
  const x=setup(options);assert.equal((await x.run()).statusCode,503);assert.equal(x.calls.reserve,0);assert.equal(x.calls.create,0);assert.equal(x.calls.bankWrite,0);
 }
});
test('COMPLETE e PG informado não executam guard fiscal nem criam novo movimento',async()=>{
 for(const options of [{complete:true},{fields:{idDoMovimento:'9001'}}]){
  const x=setup(options);assert.equal((await x.run()).statusCode,200);assert.equal(x.calls.fiscal,0);assert.equal(x.calls.create,0);assert.equal(x.calls.bankWrite,0);assert.equal(x.calls.order.includes('movimentoConhecido'),false);
 }
});
test('outroCODTMV ou ambos campos de natureza ausentes preservam comportamento anterior',async()=>{
 for(const fields of [{tipoDeItem:'Material',idDaNaturezaFiscal:'invalid'},{idDaNaturezaFiscal:'',codigoDaNaturezaFiscal:''}]){
  const x=setup({fields});assert.equal((await x.run()).statusCode,200);assert.equal(x.calls.fiscal,0);assert.equal(x.calls.create,1);assert.equal(x.calls.order.includes('movimentoConhecido'),false);
 }
});
test('RM existente sem raiz durável pula fiscal stale e associa sem criar outro movimento',async()=>{
 const x=setup({lookup:['9001']});const result=await x.run();
 assert.equal(result.statusCode,200);assert.equal(parse(result).PG,'9001');assert.equal(x.calls.fiscal,0);assert.equal(x.calls.create,0);assert.equal(x.calls.bankWrite,1);
 assert.equal(x.calls.lookup,2);assert.ok(x.calls.movementRead>=3);
});
test('ownership inválido, cache perdido, nova leitura falhando ou reserva divergente nunca permitem criação',async()=>{
 for(const options of [{lookup:['9001'],movement:{CODCFO:'OTHER'}},{lookup:['9001'],movement:{STATUS:'C'}},
  {lookupSequence:[['9001'],[]]},{lookupSequence:[['9001'],['9009']]},{lookup:['9001'],lookupErrorAt:2},
  {lookup:['9001'],movementReadErrorAt:2},{lookup:['9001'],reservePg:'9009'}]){
  const x=setup({...options,fiscalError:true}),result=await x.run();assert.notEqual(result.statusCode,200);
  assert.equal(x.calls.fiscal,0);assert.equal(x.calls.create,0);assert.equal(x.calls.bankWrite,0);
 }
});
const nativeRecon=changes=>({RECON_VERSION:1,REQUEST_COMPANY:11,REQUEST_TICKET:'9003',TOTAL_MOVEMENTS:1,
 CODCOLIGADA:11,IDMOV:9001,CODFILIAL:1,CODCFO:'0000000001',CODCOLCFO:0,CODTMV:'1.2.03',STATUS:'F',TICKET:'9003',...changes});
test('SC/OC mais um PG preservam o alvo; contrato truncado/foreign e dois PGs bloqueiam antes da reserva',async()=>{
 const sc=nativeRecon({TOTAL_MOVEMENTS:3,IDMOV:9004,CODTMV:'1.1.01',STATUS:'A',CODFILIAL:null,CODCFO:null,CODCOLCFO:null});
 const oc=nativeRecon({TOTAL_MOVEMENTS:3,IDMOV:9005,CODTMV:'1.1.02'});delete oc.CODFILIAL;delete oc.CODCFO;delete oc.CODCOLCFO;
 const valid=[nativeRecon({TOTAL_MOVEMENTS:3}),sc,oc];
 const good=setup({reconResponse:valid,fiscalError:true});assert.equal((await good.run()).statusCode,200);assert.equal(good.calls.create,0);assert.equal(good.calls.fiscal,0);
 for(const response of [[nativeRecon({TOTAL_MOVEMENTS:2})],[nativeRecon({CODCFO:null})],[nativeRecon({CODFILIAL:null})],[nativeRecon({CODCOLCFO:null})],
  [nativeRecon({TOTAL_MOVEMENTS:2}),nativeRecon({TOTAL_MOVEMENTS:2,IDMOV:9004,CODTMV:'1.1.01',CODCOLIGADA:31})],
  [nativeRecon({TOTAL_MOVEMENTS:2}),nativeRecon({TOTAL_MOVEMENTS:2,IDMOV:9009})]]){
  const x=setup({reconResponse:response,fiscalError:true});assert.notEqual((await x.run()).statusCode,200);
  assert.equal(x.calls.reserve,0);assert.equal(x.calls.create,0);assert.equal(x.calls.bankWrite,0);assert.equal(x.calls.fiscal,0);
 }
});
