const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {parsearReconciliacaoPagamento}=require('./load-ts.cjs')(path.resolve(__dirname,'../src/functions/rm/post/pagamentoReconciliacao.ts'));
const meta={RECON_VERSION:1,REQUEST_COMPANY:11,REQUEST_TICKET:'9003',TOTAL_MOVEMENTS:1};
const row=changes=>({...meta,CODCOLIGADA:11,IDMOV:9001,CODFILIAL:1,CODCFO:'0000000001',CODCOLCFO:0,CODTMV:'1.2.03',STATUS:'F',TICKET:'9003',...changes});
const parse=raw=>parsearReconciliacaoPagamento(raw,'11','9003','1.2.03');

test('contrato0 aceita SQLNULL explícito ou omitido, sem transformar vazio em ausência',()=>{
 assert.deepEqual(parse([{...meta,TOTAL_MOVEMENTS:0}]),[]);
 assert.deepEqual(parse([Object.fromEntries(Object.entries(row({TOTAL_MOVEMENTS:0})).map(([k,v])=>[k,k in meta?v:null]))]),[]);
 for(const raw of [[],[{...meta,TOTAL_MOVEMENTS:0,IDMOV:9001}],[{...meta,TOTAL_MOVEMENTS:0,TICKET:''}],
  [{...meta,TOTAL_MOVEMENTS:0},{...meta,TOTAL_MOVEMENTS:0}]])assert.throws(()=>parse(raw),/lista completa/);
});
test('todos os movimentos são validados e preservados, inclusive SC/OC e cancelados',()=>{
 const result=parse([row({TOTAL_MOVEMENTS:3}),row({TOTAL_MOVEMENTS:3,IDMOV:9002,CODTMV:'1.1.01',STATUS:'A'}),row({TOTAL_MOVEMENTS:3,IDMOV:9003,CODTMV:'1.1.02',STATUS:'C'})]);
 assert.deepEqual(result.map(r=>r.IDMOV),['9001','9002','9003']);assert.equal(result[1].CODTMV,'1.1.01');assert.equal(result[2].STATUS,'C');
 assert.equal(result[0].CODCFO,'0000000001');assert.equal(result[0].CODCOLCFO,'0');
});
test('TOP/truncamento, totais divergentes e IDs repetidos falham fechados',()=>{
 for(const raw of [[row({TOTAL_MOVEMENTS:2})],[row(),row({IDMOV:9002})],
  [row({TOTAL_MOVEMENTS:2}),row({TOTAL_MOVEMENTS:3,IDMOV:9002})],[row({TOTAL_MOVEMENTS:2}),row({TOTAL_MOVEMENTS:2})]])assert.throws(()=>parse(raw),/lista completa/);
});
test('pedido/coligada/ticket divergentes falham também em movimento de outro tipo',()=>{
 for(const changes of [{REQUEST_COMPANY:31},{REQUEST_TICKET:'9004'},{CODCOLIGADA:31},{TICKET:'9004'}])assert.throws(()=>parse([row(changes)]),/lista completa/);
 assert.throws(()=>parse([row({TOTAL_MOVEMENTS:2}),row({TOTAL_MOVEMENTS:2,IDMOV:9002,CODTMV:'1.1.01',CODCOLIGADA:31})]),/lista completa/);
});
test('tickets textuais não perdem zeros e apenas números nativos seguros podem virar texto',()=>{
 const leading=row({REQUEST_TICKET:'0009003',TICKET:'0009003'});
 assert.equal(parsearReconciliacaoPagamento([leading],'11','0009003','1.2.03')[0].TICKET,'0009003');
 assert.throws(()=>parsearReconciliacaoPagamento([{...leading,TICKET:9003}],'11','0009003','1.2.03'),/lista completa/);
 assert.throws(()=>parse([leading]),/lista completa/);
 assert.equal(parse([row({REQUEST_TICKET:9003,TICKET:9003})])[0].TICKET,'9003');
});
test('metadados opcionais NULL/omitidos de outro tipo são preservados; alvo continua exigindo ownership completo',()=>{
 const optional=row({TOTAL_MOVEMENTS:2,IDMOV:9002,CODTMV:'1.1.01',CODFILIAL:null,CODCFO:null,CODCOLCFO:null});
 assert.equal(parse([row({TOTAL_MOVEMENTS:2}),optional])[1].CODCFO,null);
 delete optional.CODFILIAL;delete optional.CODCFO;delete optional.CODCOLCFO;
 assert.equal(parse([row({TOTAL_MOVEMENTS:2}),optional])[1].CODFILIAL,null);
 for(const field of ['CODFILIAL','CODCFO','CODCOLCFO']){
  assert.throws(()=>parse([row({[field]:null})]),/lista completa/);
  const missing=row();delete missing[field];assert.throws(()=>parse([missing]),/lista completa/);
 }
 assert.throws(()=>parse([row({TOTAL_MOVEMENTS:2}),{...optional,CODCFO:123}]),/lista completa/);
});
test('contrato antigo, versão errada, dados ausentes, identificadores inválidos ou PII extra não passam',()=>{
 const missing=row();delete missing.CODCOLCFO;
 for(const raw of [null,{},[{IDMOV:9001}],[row({RECON_VERSION:2})],[row({RECON_VERSION:'01'})],[missing],
  ...[{IDMOV:0},{IDMOV:9007199254740992},{CODFILIAL:null},{CODCFO:123},{CODCFO:'private@example.test'},
   {STATUS:'INVALID'},{TOTAL_MOVEMENTS:true},{CHAVE:'PRIVATE_PIX'}].map(changes=>[row(changes)])]){
  assert.throws(()=>parse(raw),error=>{assert.equal(error.message.includes('PRIVATE'),false);assert.equal(error.message.includes('private@example.test'),false);return /lista completa/.test(error.message);});
 }
});
