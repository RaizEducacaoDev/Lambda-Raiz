const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const dynalite = require('dynalite');
const { DynamoDBClient, CreateTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const cache=new Map();
const load=(file)=>require('./load-ts.cjs')(file,{},cache);
const base=path.resolve(__dirname,'../src/functions/rm/post');
const {DynamoPagamento}=load(path.join(base,'pagamentoV2Idempotencia.ts'));
const {executarPagamentoV2}=load(path.join(base,'solicitacaoDePagamentoV2.ts'));
const {lerResultadoSoap,registroUnico}=load(path.join(base,'pagamentoV2Rm.ts'));
const linha='836500000002100000000008000000000000000000000000';
const payload={tipoDaSolicitacao:'PG',atividadeAtual:'TS03',tipoDoPagamento:'CC',contasDeConsumo:'T',integracaoBancariaV2:'S',
 codigoDaColigada2:'8',codigoDaFilial2:'4',codigoDoFornecedor:'0000000001',ticketRaiz:'9003',
 idPagamento:'8$_$0$_$0000000001$_$6',idpgto:'6',codigoDeBarrasBoleto:linha};
const fixture=name=>lerResultadoSoap(fs.readFileSync(path.join(__dirname,'fixtures/rm',name+'.soap.xml'),'utf8'),'ReadRecord');
const toXml=(name,row)=>`<DataSet><${name}>${Object.entries(row).map(([k,v])=>`<${k}>${v}</${k}>`).join('')}</${name}></DataSet>`;
const body=r=>JSON.parse(r.body);
let server,client,doc,seq=0;
before(async()=>{
 server=dynalite({createTableMs:0}); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 client=new DynamoDBClient({endpoint:`http://127.0.0.1:${server.address().port}`,region:'local',credentials:{accessKeyId:'local',secretAccessKey:'local'},maxAttempts:1});
 doc=DynamoDBDocumentClient.from(client);
});
after(async()=>{client.destroy();await new Promise(resolve=>server.close(resolve));});
async function setup(options={}) {
 const tabela='PagamentoTest'+(++seq);
 await client.send(new CreateTableCommand({TableName:tabela,KeySchema:[{AttributeName:'pk',KeyType:'HASH'}],AttributeDefinitions:[{AttributeName:'pk',AttributeType:'S'}],ProvisionedThroughput:{ReadCapacityUnits:10,WriteCapacityUnits:10}}));
 let repo=new DynamoPagamento(tabela,doc);
 const stats={create:0,update:0,lookup:0,read:0};
 let restante=30000;
 let lan=registroUnico(fixture('lan-vazio'),'FLAN');
 const rm={
  async buscarEstoque(){if(options.stockError)throw Error('timeout consulta estoque');if(options.stockSlow)restante=10000;return '01';},
  async buscarMovimentosPorTicket(){stats.lookup++;if(options.lookupError)throw Error('lookup indisponível');return options.lookup??[];},
  async readReacord(chave,servidor){
   stats.read++;
   if(servidor==='FinDadosPgtoDataBR')return fixture(options.formaI?'dado-i':'dado-n');
   if(servidor==='MovMovimentoTBCData')return options.movimento??fixture('movimento');
   return toXml('FLAN',lan);
  },
  async saveRecord(xml,servidor){
   if(servidor==='MovMovimentoTBCData'){
    stats.create++;
    if(options.createError)throw Error('socket hang up');
    if(options.afterCreate)restante=6000;
    return options.createResult??'8;9001';
   }
   stats.update++;
   if(!options.writeNoEffect) lan={...lan,...registroUnico(xml.slice(9,-3),'FLAN')};
   if(options.updateTimeout)throw Error('timeout após commit RM');
   if(options.afterUpdate)restante=3000;
   return '8;9002';
  },
 };
 const create=async(campos,transporte)=>{
   assert.equal(campos.tipoDoPagamento,'CC');
   try {await transporte.buscarEstoque('8','4');const result=await transporte.saveRecord('<xml/>','MovMovimentoTBCData','ctx');return {statusCode:200,body:JSON.stringify({PG:result.split(';')[1]})};}
   catch{return {statusCode:500,body:'{}'};}
 };
 const run=(overrides={})=>executarPagamentoV2({...payload,...overrides},{getRemainingTimeInMillis:()=>restante},create,{repositorio:repo,rm});
 const record=async()=> (await doc.send(new ScanCommand({TableName:tabela,ConsistentRead:true}))).Items[0];
 const expire=async()=>{const op=await record();await doc.send(new UpdateCommand({TableName:tabela,Key:{pk:op.pk},UpdateExpression:'SET lockUntil=:old',ExpressionAttributeValues:{':old':Date.now()-1}}));restante=30000;};
 return {run,stats,record,expire,get repo(){return repo;},newRepository(){repo=new DynamoPagamento(tabela,DynamoDBDocumentClient.from(client));},setLan(v){lan={...lan,...v};},setTime(ms){restante=ms;}};
}

test('criação + confirmação + replay durável atravessando instância nova de repositório',async()=>{
 const x=await setup();const first=await x.run({tipoDoPagamento:'Contas de consumo'});
 assert.equal(first.statusCode,200);assert.equal(body(first).integracaoBancaria,'gravada');
 assert.equal((await x.record()).state,'COMPLETE');
 x.newRepository();
 const second=await x.run({idDoMovimento:'9001'});
 assert.equal(second.statusCode,200);assert.equal(body(second).integracaoBancaria,'ja_gravada');
 assert.deepEqual(x.stats,{create:1,update:1,lookup:1,read:4});
});
test('duas execuções concorrentes criam e atualizam uma única vez',async()=>{
 const x=await setup();const results=await Promise.all([x.run(),x.run()]);
 assert.equal(results.filter(r=>r.statusCode===200).length,1);
 assert.equal(results.filter(r=>r.statusCode===409 || r.statusCode===503).length,1);
 assert.equal(x.stats.create,1);assert.equal(x.stats.update,1);
});
test('timeout de criação mantém CREATING após expirar lock, sem segunda criação',async()=>{
 const x=await setup({createError:true});assert.notEqual((await x.run()).statusCode,200);
 assert.equal((await x.record()).state,'CREATING');await x.expire();
 const retry=await x.run();assert.equal(retry.statusCode,409);assert.match(body(retry).avisoIntegracaoBancaria,/incerta/);
 assert.equal(x.stats.create,1);assert.equal(x.stats.update,0);
});
test('resposta de criação ambígua e falha no checkpoint permanecem sem repetição',async()=>{
 const x=await setup({createResult:'texto inesperado'});assert.notEqual((await x.run()).statusCode,200);await x.expire();
 assert.notEqual((await x.run()).statusCode,200);assert.equal(x.stats.create,1);
 const y=await setup();const original=y.repo.avancar.bind(y.repo);
 y.repo.avancar=async(op,state,pg)=>{if(state==='CREATED')throw Error('Dynamo indisponível após criar');return original(op,state,pg);};
 assert.notEqual((await y.run()).statusCode,200);assert.equal((await y.record()).state,'CREATING');
 await y.expire();assert.notEqual((await y.run()).statusCode,200);assert.equal(y.stats.create,1);
});
test('timeout depois do IDMOV recupera CREATED e não cria novamente',async()=>{
 const x=await setup({afterCreate:true});const first=await x.run();assert.notEqual(first.statusCode,200);
 assert.equal(body(first).PG,'9001');assert.equal((await x.record()).state,'CREATED');
 await x.expire();assert.equal((await x.run()).statusCode,200);assert.equal(x.stats.create,1);
});
test('timeout de atualização confirma por leitura, sem repetir escrita',async()=>{
 const x=await setup({updateTimeout:true});assert.notEqual((await x.run()).statusCode,200);
 assert.equal((await x.record()).state,'UPDATING');await x.expire();
 assert.equal((await x.run()).statusCode,200);assert.equal(x.stats.update,1);assert.equal(x.stats.create,1);
});
test('atualização incerta não confirmada mantém pendente e não regrava',async()=>{
 const x=await setup({writeNoEffect:true});const first=await x.run();assert.notEqual(first.statusCode,200);
 assert.equal(body(first).integracaoBancaria,'pendente');await x.expire();
 assert.notEqual((await x.run()).statusCode,200);assert.equal(x.stats.update,1);
});
test('ticket histórico recuperado antes da criação; indisponibilidade e duplicados bloqueiam',async()=>{
 const x=await setup({lookup:['9001']});assert.equal((await x.run()).statusCode,200);assert.equal(x.stats.create,0);
 for(const opts of [{lookup:['9001','9001']},{lookupError:true}]){
  const y=await setup(opts);assert.notEqual((await y.run()).statusCode,200);assert.equal(y.stats.create,0);assert.equal(y.stats.update,0);
 }
});
test('dados mudados no mesmo ticket ou IDMOV diferente nunca furam reserva',async()=>{
 const x=await setup();assert.equal((await x.run()).statusCode,200);
 assert.notEqual((await x.run({valorTotal:'999'})).statusCode,200);
 assert.notEqual((await x.run({idDoMovimento:'9009'})).statusCode,200);
 assert.equal(x.stats.create,1);
});
test('campo ausente, parcelas, forma I, fornecedor/ticket incorretos e status fechado bloqueiam',async()=>{
 for(const overrides of [{ticketRaiz:''},{codigoDeBarrasBoleto:linha.slice(0,44)},{listaDeParcelas:[{},{}]},{idPagamento:'0'}]){
  const x=await setup();assert.equal((await x.run(overrides)).statusCode,422);assert.equal(x.stats.create,0);assert.equal(x.stats.read,0);
 }
 const i=await setup({formaI:true});assert.equal((await i.run()).statusCode,422);assert.equal(i.stats.create,0);
 for(const status of ['1','2','']){
  const x=await setup({lookup:['9001']});x.setLan({STATUSLAN:status});assert.notEqual((await x.run()).statusCode,200);assert.equal(x.stats.update,0);
 }
 for(const [from,to] of [['<TICKET>9003</TICKET>','<TICKET>9004</TICKET>'],['<CODFILIAL>4</CODFILIAL>','<CODFILIAL>5</CODFILIAL>']]){
  const x=await setup({lookup:['9001'],movimento:fixture('movimento').replace(from,to)});assert.notEqual((await x.run()).statusCode,200);assert.equal(x.stats.update,0);
 }
 const x=await setup({lookup:['9001']});x.setLan({IDPGTO:'99'});assert.notEqual((await x.run()).statusCode,200);assert.equal(x.stats.update,0);
});
test('prazo insuficiente e configuração ausente falham antes de efeitos',async()=>{
 const x=await setup();x.setTime(4000);assert.notEqual((await x.run()).statusCode,200);assert.equal(x.stats.create,0);assert.equal(await x.record(),undefined);
 const old=process.env.PAGAMENTO_V2_ENABLED;delete process.env.PAGAMENTO_V2_ENABLED;
 try {const r=await executarPagamentoV2(payload,{getRemainingTimeInMillis:()=>30000},()=>{throw Error('não executar');});assert.equal(r.statusCode,503);}
 finally {if(old!==undefined)process.env.PAGAMENTO_V2_ENABLED=old;}
});
test('owner antigo perde direito de checkpoint após recuperação da reserva',async()=>{
 const x=await setup({lookupError:true});await x.run();const antiga=await x.record();await x.expire();
 const atual=await x.repo.reservar(antiga.pk,antiga.digest,undefined,30000);
 assert.notEqual(atual.owner,antiga.owner);
 await assert.rejects(()=>x.repo.avancar(antiga,'CREATING'),{name:'ConditionalCheckFailedException'});
 assert.equal((await x.record()).state,'RESERVED');
});
test('consulta de estoque com erro ou consumindo orçamento impede criar antes do timeout',async()=>{
 for(const options of [{stockError:true},{stockSlow:true}]){
  const x=await setup(options);assert.equal((await x.run()).statusCode,503);assert.equal(x.stats.create,0);assert.equal((await x.record()).state,'RESERVED');
 }
});
test('aliases de boleto/chave/coligada por parcela e no topo não podem sobrescrever dados validados',async()=>{
 const parcela={valorDaParcela:'10',vencimentoDaParcela:'2026-10-20'};
 for(const campo of [{codigoDeBarrasBoleto:'12345'},{linhaDigitavel:'838700000001100000000007000000000000000000000000'},
  {idpgto:'7'},{idPgto:'0'},{CODCOLPGTO:'9'},{codColPgto:'0'},{idPagamento:'8$_$0$_$0000000002$_$6'}]) {
  const x=await setup();assert.equal((await x.run({listaDeParcelas:[{...parcela,...campo}]})).statusCode,422);assert.equal(x.stats.create,0);assert.equal(await x.record(),undefined);
 }
 for(const alias of ['codigoDeBarras','linhaDigitavel','linhaDigitavelBoleto']){
  const x=await setup();assert.equal((await x.run({[alias]:'12345'})).statusCode,422);assert.equal(await x.record(),undefined);
 }
 const x=await setup();assert.equal((await x.run({listaDeParcelas:[{...parcela,codigoDeBarrasBoleto:linha,idpgto:'6',CODCOLPGTO:'8'}]})).statusCode,200);
});
