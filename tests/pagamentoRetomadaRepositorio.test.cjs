const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const dynalite=require('dynalite');
const {DynamoDBClient,CreateTableCommand,DescribeTableCommand}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,PutCommand,UpdateCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const {DynamoPagamento,ConflitoPagamento}=require('./load-ts.cjs')(path.resolve(__dirname,'../src/functions/rm/post/pagamentoV2Idempotencia.ts'));
const digest='a'.repeat(64),novoDigest='b'.repeat(64),outroDigest='c'.repeat(64);
let server,client,doc,sequence=0;
before(async()=>{
 server=dynalite({createTableMs:0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 client=new DynamoDBClient({endpoint:`http://127.0.0.1:${server.address().port}`,region:'local',credentials:{accessKeyId:'local',secretAccessKey:'local'},maxAttempts:1});
 doc=DynamoDBDocumentClient.from(client);
});
after(async()=>{client.destroy();await new Promise(resolve=>server.close(resolve));});
async function fixture(overrides={},customClient){
 const table='RetomadaTest'+(++sequence);
 await client.send(new CreateTableCommand({TableName:table,KeySchema:[{AttributeName:'pk',KeyType:'HASH'}],AttributeDefinitions:[{AttributeName:'pk',AttributeType:'S'}],ProvisionedThroughput:{ReadCapacityUnits:10,WriteCapacityUnits:10}}));
 for(let i=0;;i++){
  const info=await client.send(new DescribeTableCommand({TableName:table}));
  if(info.Table.TableStatus==='ACTIVE')break;
  if(i>=20)throw Error('Tabela local não ativou');
  await new Promise(resolve=>setTimeout(resolve,5));
 }
 const original={pk:'prod#PG#9#226374',state:'RESERVED',digest,owner:'original-owner',lockUntil:Date.now()-1000,protocolVersion:2,
  auditMetadata:{attempt:1,flags:['guarded',true],nullable:null},...overrides};
 await doc.send(new PutCommand({TableName:table,Item:original}));
 const repo=new DynamoPagamento(table,customClient||doc);
 const all=async()=>(await doc.send(new ScanCommand({TableName:table,ConsistentRead:true}))).Items;
 const root=async()=>(await doc.send(new GetCommand({TableName:table,Key:{pk:original.pk},ConsistentRead:true}))).Item;
 const replace=async value=>doc.send(new PutCommand({TableName:table,Item:value}));
 return {table,original,repo,all,root,replace};
}
const histories=items=>items.filter(item=>item.pk.includes('#HISTORY#'));

test('evidência por tentativa é imutável e idempotente, não modifica raiz e não armazena campos arbitrários',async()=>{
 const x=await fixture(),evidence={version:1,phase:'prepared',xmlSha256:'d'.repeat(64),movementType:'1.2.01',
  company:'9',branch:'2',ticket:'226374',supplierCompany:'0',supplier:'0000000001',paymentId:'6',paymentCompany:'9',number:'000114',series:'1',documentType:'055',
  issueDate:'2026-10-22',entryDate:'',total:'100.0',installments:[{dueDate:'2026-11-04',amount:'100.0',destinationSha256:'e'.repeat(64)}]};
 await x.repo.registrarEvidencia(x.original,evidence);await x.repo.registrarEvidencia(x.original,evidence);
 assert.deepEqual(await x.root(),x.original);let rows=(await x.all()).filter(r=>r.pk.includes('#EVIDENCE#'));assert.equal(rows.length,1);
 await assert.rejects(()=>x.repo.registrarEvidencia(x.original,{...evidence,rawXml:'PRIVATE'}));
 await x.replace({...rows[0],evidence:{...rows[0].evidence,total:'999.0'}});
 await assert.rejects(()=>x.repo.registrarEvidencia(x.original,evidence),/imutável divergente/);
 assert.deepEqual(await x.root(),x.original);
});

test('novas raízes recebem protocolo2; retomada normal não promove legado nem marca filho',async()=>{
 const x=await fixture();
 const nova=await x.repo.reservar('prod#PG#9#999999',digest,undefined,30000);
 assert.equal(nova.protocolVersion,2);
 const child=await x.repo.reservar('prod#PG#9#999999#FLAN#44',digest,'10',30000);
 assert.equal(Object.hasOwn(child,'protocolVersion'),false);
 const old={...x.original};delete old.protocolVersion;await x.replace(old);
 assert.equal((await x.repo.reservar(old.pk,digest,undefined,30000)).protocolVersion,undefined);
 assert.equal(histories(await x.all()).length,0);
});

test('correção preserva snapshot inteiro e histórico; dono antigo perde direito de despachar',async()=>{
 const x=await fixture();assert.deepEqual(await x.repo.consultar(x.original.pk),x.original);
 assert.equal(await x.repo.consultar('prod#PG#9#1'),undefined);
 const result=await x.repo.corrigirReserva(x.original,novoDigest,30000);
 assert.equal(result.state,'RESERVED');assert.equal(result.digest,novoDigest);assert.notEqual(result.owner,x.original.owner);
 assert.ok(result.lockUntil>Date.now());assert.equal(result.protocolVersion,2);assert.equal(Object.hasOwn(result,'pg'),false);
 assert.deepEqual(result.auditMetadata,x.original.auditMetadata);
 const [history]=histories(await x.all());assert.deepEqual(history.snapshot,x.original);
 assert.match(history.snapshotSha256,/^[a-f0-9]{64}$/);assert.equal(history.pk,`${x.original.pk}#HISTORY#${history.snapshotSha256}`);
 const cold=new DynamoPagamento(x.table,doc);assert.deepEqual(await cold.consultar(x.original.pk),result);
 await assert.rejects(()=>x.repo.avancar(x.original,'CREATING'),{name:'ConditionalCheckFailedException'});
 assert.equal((await cold.avancar(result,'CREATING')).state,'CREATING');
});

test('duas correções concorrentes: um CAS vence e há um único histórico imutável',async()=>{
 const x=await fixture();
 const results=await Promise.allSettled([x.repo.corrigirReserva(x.original,novoDigest,30000),x.repo.corrigirReserva(x.original,outroDigest,30000)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.equal(histories(await x.all()).length,1);assert.deepEqual(histories(await x.all())[0].snapshot,x.original);
 assert.ok([novoDigest,outroDigest].includes((await x.root()).digest));
});

test('correção não aceita lease ativo, estado diferente, legado, protocolo desconhecido ou filho',async()=>{
 for(const overrides of [{lockUntil:Date.now()+120000},...['CREATING','CREATED','UPDATING','COMPLETE','UNKNOWN'].map(state=>({state})),
  {protocolVersion:undefined},{protocolVersion:1},{pk:'prod#PG#9#226374#FLAN#44'}]){
  // DynamoDB cannot store undefined; absence is a real legacy record.
  const x=await fixture({...overrides,...(overrides.protocolVersion===undefined&&Object.hasOwn(overrides,'protocolVersion')?{protocolVersion:null}:{})});
  if(Object.hasOwn(overrides,'protocolVersion')&&overrides.protocolVersion===undefined){delete x.original.protocolVersion;await x.replace(x.original);}
  await assert.rejects(()=>x.repo.corrigirReserva(x.original,novoDigest,30000),ConflitoPagamento);
  assert.deepEqual(await x.root(),x.original);assert.equal(histories(await x.all()).length,0);
 }
});

test('presença de pg vazia, nula ou válida sempre bloqueia as duas retomadas',async()=>{
 for(const pg of ['',null,'99863']){
  const x=await fixture({pg});await assert.rejects(()=>x.repo.corrigirReserva(x.original,novoDigest,30000),ConflitoPagamento);
  const y=await fixture({state:'CREATING',pg});await assert.rejects(()=>y.repo.confirmarCriacaoIncerta(y.original,'99863',30000),ConflitoPagamento);
  assert.equal(histories(await x.all()).length,0);assert.equal(histories(await y.all()).length,0);
 }
});

test('duração, digest e identificador inválidos falham sem escrever histórico',async()=>{
 for(const duracao of [0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER]){
  const x=await fixture();await assert.rejects(()=>x.repo.corrigirReserva(x.original,novoDigest,duracao),ConflitoPagamento);
  assert.equal(histories(await x.all()).length,0);
 }
 for(const value of ['',digest,'not-a-hash']){
  const x=await fixture();await assert.rejects(()=>x.repo.corrigirReserva(x.original,value,30000),ConflitoPagamento);
  assert.equal(histories(await x.all()).length,0);
 }
 for(const pg of ['',0,123,'0','001','-1','9007199254740992']){
  const x=await fixture({state:'CREATING'});await assert.rejects(()=>x.repo.confirmarCriacaoIncerta(x.original,pg,30000),ConflitoPagamento);
  assert.equal(histories(await x.all()).length,0);
 }
});

test('CAS exige estado, digest, owner, lock, protocolo e ausência real de pg exatos',async()=>{
 for(const change of [{state:'CREATING'},{digest:outroDigest},{owner:'another-owner'},{lockUntil:Date.now()-5000},{protocolVersion:1},{pg:null}]){
  const x=await fixture(),changed={...x.original,...change};await x.replace(changed);
  await assert.rejects(()=>x.repo.corrigirReserva(x.original,novoDigest,30000),{name:'ConditionalCheckFailedException'});
  assert.deepEqual(await x.root(),changed);assert.deepEqual(histories(await x.all())[0].snapshot,x.original);
 }
});

test('CREATING legado com prova positiva fornecida pelo serviço só vira CREATED com mesmo digest',async()=>{
 const x=await fixture({state:'CREATING'});delete x.original.protocolVersion;await x.replace(x.original);
 const result=await x.repo.confirmarCriacaoIncerta(x.original,'99863',30000);
 assert.equal(result.state,'CREATED');assert.equal(result.digest,digest);assert.equal(result.pg,'99863');
 assert.equal(result.recuperadaCriacaoIncerta,true);
 assert.notEqual(result.owner,x.original.owner);assert.equal(Object.hasOwn(result,'protocolVersion'),false);
 assert.deepEqual(histories(await x.all())[0].snapshot,x.original);
 await assert.rejects(()=>x.repo.avancar(x.original,'CREATED','99863'),{name:'ConditionalCheckFailedException'});
 // Existing strict methods still reject changed digests and do not reopen creation.
 await assert.rejects(()=>x.repo.reservar(result.pk,novoDigest,undefined,30000),ConflitoPagamento);
 await assert.rejects(()=>x.repo.concluida(result.pk,novoDigest,undefined),ConflitoPagamento);
 await assert.rejects(()=>x.repo.movimentoConhecido(result.pk,novoDigest,undefined),ConflitoPagamento);
 const updating=await x.repo.avancar(result,'UPDATING');assert.equal(updating.recuperadaCriacaoIncerta,true);
 const complete=await x.repo.avancar(updating,'COMPLETE');assert.equal(complete.recuperadaCriacaoIncerta,true);
 assert.equal((await new DynamoPagamento(x.table,doc).consultar(result.pk)).recuperadaCriacaoIncerta,true);
});

test('dois conciliadores de CREATING só confirmam um PG; não existe caminho de reset',async()=>{
 const x=await fixture({state:'CREATING'});
 const results=await Promise.allSettled([x.repo.confirmarCriacaoIncerta(x.original,'99863',30000),x.repo.confirmarCriacaoIncerta(x.original,'99864',30000)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await x.root()).state,'CREATED');
 assert.equal((await x.root()).digest,digest);assert.equal(histories(await x.all()).length,1);
 await assert.rejects(()=>x.repo.corrigirReserva(x.original,novoDigest,30000),ConflitoPagamento);
 const y=await fixture({state:'CREATING',lockUntil:Date.now()+120000});
 await assert.rejects(()=>y.repo.confirmarCriacaoIncerta(y.original,'99863',30000),ConflitoPagamento);
});

test('confirmação CREATING não aceita snapshot alterado durante a leitura da prova',async()=>{
 for(const change of [{state:'RESERVED'},{digest:outroDigest},{owner:'another-owner'},{lockUntil:Date.now()-5000},{pg:'99864'}]){
  const x=await fixture({state:'CREATING'}),changed={...x.original,...change};await x.replace(changed);
  await assert.rejects(()=>x.repo.confirmarCriacaoIncerta(x.original,'99863',30000),{name:'ConditionalCheckFailedException'});
  assert.deepEqual(await x.root(),changed);
 }
});

test('histórico existente com conteúdo divergente bloqueia CAS e nunca é sobrescrito',async()=>{
 const x=await fixture();await x.replace({...x.original,owner:'concurrent-writer'});
 await assert.rejects(()=>x.repo.corrigirReserva(x.original,novoDigest,30000),{name:'ConditionalCheckFailedException'});
 const [history]=histories(await x.all()),corrupted={...history,snapshot:{...history.snapshot,digest:outroDigest}};
 await x.replace(corrupted);await x.replace(x.original);
 await assert.rejects(()=>x.repo.corrigirReserva(x.original,novoDigest,30000),ConflitoPagamento);
 assert.deepEqual(await x.root(),x.original);assert.deepEqual(histories(await x.all())[0],corrupted);
});

test('timeout após Put de histórico conserva raiz; retry verifica o snapshot e só então faz CAS',async()=>{
 let once=true;
 const wrapped={async send(command,options){const result=await doc.send(command,options);
  if(command instanceof PutCommand&&command.input.Item.pk.includes('#HISTORY#')&&once){once=false;throw Object.assign(Error('ambiguous-history-write'),{name:'TimeoutError'});}return result;}};
 const x=await fixture({},wrapped);
 await assert.rejects(()=>x.repo.corrigirReserva(x.original,novoDigest,30000),{name:'TimeoutError'});
 assert.deepEqual(await x.root(),x.original);assert.equal(histories(await x.all()).length,1);
 assert.equal((await x.repo.corrigirReserva(x.original,novoDigest,30000)).digest,novoDigest);
 assert.equal(histories(await x.all()).length,1);
});

test('timeout após CAS não volta o estado; leitura consistente resolve resultado e snapshot antigo não ganha',async()=>{
 let once=true;
 const wrapped={async send(command,options){const result=await doc.send(command,options);
  if(command instanceof UpdateCommand&&command.input.ReturnValues==='ALL_NEW'&&once){once=false;throw Object.assign(Error('ambiguous-cas'),{name:'TimeoutError'});}return result;}};
 const x=await fixture({},wrapped);
 await assert.rejects(()=>x.repo.corrigirReserva(x.original,novoDigest,30000),{name:'TimeoutError'});
 const confirmed=await x.repo.consultar(x.original.pk);assert.equal(confirmed.digest,novoDigest);assert.notEqual(confirmed.owner,x.original.owner);
 await assert.rejects(()=>x.repo.corrigirReserva(x.original,outroDigest,30000),{name:'ConditionalCheckFailedException'});
 assert.deepEqual(await x.root(),confirmed);assert.equal(histories(await x.all()).length,1);
});

test('encerramento sem despacho expira e troca owner, preserva intenção e permite correção imediata',async()=>{
 const x=await fixture({lockUntil:Date.now()+120000});
 await x.repo.encerrarAntesDoEnvio(x.original);
 const closed=await x.root();assert.equal(closed.state,'RESERVED');assert.equal(closed.digest,digest);
 assert.ok(closed.lockUntil<Date.now());assert.notEqual(closed.owner,x.original.owner);
 assert.deepEqual(closed.auditMetadata,x.original.auditMetadata);assert.equal(histories(await x.all()).length,0);
 await assert.rejects(()=>x.repo.avancar(x.original,'CREATING'),{name:'ConditionalCheckFailedException'});
 assert.equal((await x.repo.corrigirReserva(closed,novoDigest,30000)).digest,novoDigest);
});

test('CREATING remoto depois de checkpoint com resposta perdida impede encerramento local RESERVED',async()=>{
 const x=await fixture({lockUntil:Date.now()+120000});
 const committed=await x.repo.avancar(x.original,'CREATING');
 await assert.rejects(()=>x.repo.encerrarAntesDoEnvio(x.original),{name:'ConditionalCheckFailedException'});
 assert.deepEqual(await x.root(),committed);assert.equal(histories(await x.all()).length,0);
});

test('callback CREATING e encerramento concorrentes têm um único vencedor',async()=>{
 for(let i=0;i<2;i++){
  const x=await fixture({lockUntil:Date.now()+120000});
  const work=[()=>x.repo.encerrarAntesDoEnvio(x.original),()=>x.repo.avancar(x.original,'CREATING')];
  const results=await Promise.allSettled((i?work.reverse():work).map(f=>f()));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const current=await x.root();assert.ok(['RESERVED','CREATING'].includes(current.state));
  if(current.state==='RESERVED')assert.notEqual(current.owner,x.original.owner);
  else assert.equal(current.owner,x.original.owner);
 }
});

test('encerramento rejeita legado, filho, PG e estados que podem ter despachado',async()=>{
 for(const change of [{protocolVersion:1},{protocolVersion:null},{pk:'prod#PG#9#226374#FLAN#44'},
  {pg:null},{pg:''},{pg:'99863'},...['CREATING','CREATED','UPDATING','COMPLETE'].map(state=>({state}))]){
  const x=await fixture(change);
  await assert.rejects(()=>x.repo.encerrarAntesDoEnvio(x.original),ConflitoPagamento);assert.deepEqual(await x.root(),x.original);
 }
 const x=await fixture();delete x.original.protocolVersion;await x.replace(x.original);
 await assert.rejects(()=>x.repo.encerrarAntesDoEnvio(x.original),ConflitoPagamento);assert.deepEqual(await x.root(),x.original);
});

test('encerramento exige owner, digest, estado, lease, protocolo e pg ausente ainda iguais',async()=>{
 for(const change of [{owner:'new-owner'},{digest:outroDigest},{state:'CREATING'},
  {lockUntil:Date.now()+100000},{protocolVersion:1},{pg:null}]){
  const x=await fixture(),changed={...x.original,...change};await x.replace(changed);
  await assert.rejects(()=>x.repo.encerrarAntesDoEnvio(x.original),{name:'ConditionalCheckFailedException'});
  assert.deepEqual(await x.root(),changed);
 }
});

test('timeout no encerramento é propagado, com ou sem persistência, sem reabrir estado incerto',async()=>{
 for(const commit of [false,true]){
  let once=true;
  const wrapped={async send(command,options){
   if(command instanceof UpdateCommand&&command.input.UpdateExpression==='SET #owner = :newOwner, lockUntil = :expired'&&once){
    once=false;if(commit)await doc.send(command,options);throw Object.assign(Error('ambiguous-close'),{name:'TimeoutError'});
   }return doc.send(command,options);
  }};
  const x=await fixture({lockUntil:Date.now()+120000},wrapped);
  await assert.rejects(()=>x.repo.encerrarAntesDoEnvio(x.original),{name:'TimeoutError'});
  const observed=await x.repo.consultar(x.original.pk);assert.equal(observed.state,'RESERVED');assert.equal(observed.digest,digest);
  if(commit){assert.notEqual(observed.owner,x.original.owner);assert.ok(observed.lockUntil<Date.now());
   await assert.rejects(()=>x.repo.avancar(x.original,'CREATING'),{name:'ConditionalCheckFailedException'});
  }else{assert.deepEqual(observed,x.original);assert.equal((await x.repo.avancar(x.original,'CREATING')).state,'CREATING');}
 }
});
