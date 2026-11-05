const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./load-ts.cjs');
const {DynamoPagamento,ConflitoPagamento}=load(path.resolve('src/functions/rm/post/pagamentoV2Idempotencia.ts'));
const root={pk:'prod#PG#11#226927',digest:'a'.repeat(64),state:'CREATING',owner:'fixture',lockUntil:1};
function fixture(record=root){
 const calls=[];
 const client={async send(command){
  calls.push(command.constructor.name);
  if(command.constructor.name==='PutCommand'){const e=new Error('exists');e.name='ConditionalCheckFailedException';throw e;}
  if(command.constructor.name==='GetCommand')return {Item:record};
  throw new Error('No mutation is permitted in this diagnostic fixture');
 }};
 return {repo:new DynamoPagamento('fixture',client),calls};
}
for(const method of ['concluida','movimentoConhecido','reservar']){
 test(method+': changed input and stale PG have distinct reasons without a state transition',async()=>{
  const x=fixture();
  await assert.rejects(()=>x.repo[method](root.pk,'b'.repeat(64),undefined,30000),e=>
   e instanceof ConflitoPagamento&&e.reason==='DADOS_SOLICITACAO_ALTERADOS'&&/dados enviados pelo Zeev mudaram/i.test(e.message));
  const y=fixture();
  await assert.rejects(()=>y.repo[method](root.pk,root.digest,'71983',30000),e=>
   e instanceof ConflitoPagamento&&e.reason==='MOVIMENTO_RESERVA_DIVERGENTE'&&/não confirmou nenhum movimento/.test(e.message));
  assert.ok(![...x.calls,...y.calls].includes('UpdateCommand'));
  assert.equal(root.state,'CREATING');assert.equal(root.pg,undefined);
 });
}
test('known different PG is not presented as a changed bank or missing IDPGTO',async()=>{
 const x=fixture({...root,state:'CREATED',pg:'9001'});
 await assert.rejects(()=>x.repo.concluida(root.pk,root.digest,'9002'),e=>
  e.reason==='MOVIMENTO_RESERVA_DIVERGENTE'&&/difere do movimento registrado/.test(e.message)&&!e.message.includes('IDPGTO'));
 assert.deepEqual(x.calls,['GetCommand']);
});
test('matching identity preserves pending and complete replay semantics',async()=>{
 const pending=fixture();assert.equal(await pending.repo.concluida(root.pk,root.digest,undefined),undefined);
 const complete=fixture({...root,state:'COMPLETE',pg:'9001'});
 assert.equal((await complete.repo.concluida(root.pk,root.digest,'9001')).pg,'9001');
 assert.deepEqual(pending.calls,['GetCommand']);assert.deepEqual(complete.calls,['GetCommand']);
});
