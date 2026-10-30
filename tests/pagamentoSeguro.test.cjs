const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const dynalite = require('dynalite');
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const modules = new Map();
const load = file => require('./load-ts.cjs')(path.resolve(__dirname, '../src/functions/rm/post', file), {}, modules);
const { executarPagamentoSeguro } = load('solicitacaoDePagamentoSeguro.ts');
const { DynamoPagamento } = load('pagamentoV2Idempotencia.ts');
const { registroUnico } = load('pagamentoV2Rm.ts');
const { identidadePagamento, planosPagamento, intencaoPagamento, hashIntencao } = load('pagamentoIdentidade.ts');
const xml = (table, obj) => `<${table}>${Object.entries(obj).map(([k,v]) => `<${k}>${v}</${k}>`).join('')}</${table}>`;
const dataset = (table, obj) => `<DataSet>${xml(table, obj)}</DataSet>`;
const payload = { tipoDaSolicitacao:'PG', tipoDoPagamento:'OG', outrosGastos:'FR', atividadeAtual:'analiseFiscal',
  ticketRaiz:'9003', codigoDaColigada2:'8', codigoDaFilial2:'4', codigoDoFornecedor:'0000000001',
  idpgto:'6', CODCOLPGTO:'8', CODCOLCFO:'0', numeroDaNF:'9003001',
  dataDeVencimento:'2026-11-10', valorTotal:'100,00', codigoTipoChavePIX:'2', chavePIX:'fixture@example.test',
  dataDeEmissao:'2026-10-29',dataDeEntrada:'2026-10-29',chaveDeAcesso:'',itens:[],tributos:[] };
const parse = response => JSON.parse(response.body);
let server, client, doc, seq=0;
before(async()=>{
  server=dynalite({createTableMs:0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  client=new DynamoDBClient({endpoint:`http://127.0.0.1:${server.address().port}`,region:'local',credentials:{accessKeyId:'local',secretAccessKey:'local'},maxAttempts:1});
  doc=DynamoDBDocumentClient.from(client);
});
after(async()=>{client.destroy();await new Promise(resolve=>server.close(resolve));});
async function setup(opts={}) {
  const table='Seguro'+(++seq);
  await client.send(new CreateTableCommand({TableName:table,KeySchema:[{AttributeName:'pk',KeyType:'HASH'}],AttributeDefinitions:[{AttributeName:'pk',AttributeType:'S'}],ProvisionedThroughput:{ReadCapacityUnits:10,WriteCapacityUnits:10}}));
  for(let n=0;n<30;n++){
    try {const r=await client.send(new DescribeTableCommand({TableName:table}));if(r.Table.TableStatus==='ACTIVE')break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  let repo=new DynamoPagamento(table,doc), remaining=30000;
  const count={create:0,update:0,lookup:0,read:0};
  let bank={CODCOLIGADA:'8',CODCOLCFO:'0',CODCFO:'0000000001',IDPGTO:'6',ATIVO:'1',FORMAPAGAMENTO:'S',TIPOPIX:'2',CHAVE:'fixture@example.test',...opts.bank};
  const rows=opts.parcelas || [{IDLAN:'9002',DATAVENCIMENTO:'2026-11-10',VALOR:'100.0000'}];
  let lans=new Map(rows.map(p=>[p.IDLAN,{CODCOLIGADA:'8',CODFILIAL:'4',IDMOV:'9001',IDLAN:p.IDLAN,CODCFO:'0000000001',CODCOLCFO:bank.CODCOLCFO,
    DATAVENCIMENTO:p.DATAVENCIMENTO,VALORORIGINAL:p.VALOR,STATUSLAN:'0',VALORBAIXADO:'0.0000',BAIXAPENDENTE:'0',...opts.lan}]));
  const movement=()=>`<MovMovimento>${xml('TMOV',{CODCOLIGADA:'8',CODFILIAL:'4',IDMOV:'9001',CODCFO:'0000000001',CODCOLCFO:bank.CODCOLCFO,CODTMV:'1.2.16',STATUS:'F',...opts.mov})}${xml('TMOVCOMPL',{CODCOLIGADA:'8',IDMOV:'9001',TICKET:'9003',...opts.compl})}${rows.map(r=>xml('TMOVPAGTO',{CODCOLIGADA:'8',IDMOV:'9001',...r})).join('')}</MovMovimento>`;
  const rm={
    async buscarEstoque(){if(opts.stockError)throw Error('stock down');return '01';},
    async buscarMovimentosPorTicket(){count.lookup++;if(opts.lookupError)throw Error('lookup down');return opts.lookup||[];},
    async readReacord(key,table){count.read++;if(opts.readError)throw Error('unavailable');
      if(table==='FinDadosPgtoDataBR')return dataset('FDadosPgto',bank);
      if(table==='MovMovimentoTBCData')return movement();
      return dataset('FLAN',lans.get(key.split(';')[1]));},
    async saveRecord(content,table){
      if(table==='MovMovimentoTBCData'){count.create++;if(opts.createError)throw opts.createError instanceof Error?opts.createError:Error('timeout');if(opts.timeAfterCreate)remaining=6000;return opts.createResult||'8;9001';}
      count.update++;const row=registroUnico(content.slice(9,-3),'FLAN');
      if(!opts.noEffect)lans.set(row.IDLAN,{...lans.get(row.IDLAN),...row});
      if(opts.afterFirstUpdate && count.update===1)remaining=7000;
      if(opts.updateError)throw Error('timeout after commit');
      return `8;${row.IDLAN}`;
    }
  };
  const create=async(c,transport)=>{
    if(opts.realLegacy){
      const {handlerLegado}=require('./load-ts.cjs')(path.resolve(__dirname,'../src/functions/rm/post/solicitacaoDePagamentoLegado.ts'));
      return handlerLegado({body:JSON.stringify(c)},{transporte:transport,getLOC:transport.buscarEstoque});
    }
    try {
      await transport.buscarEstoque('8','4');
      const result=await transport.saveRecord(`<![CDATA[<MovMovimento>${xml('TMOV',{CODCOLIGADA:'8',CODFILIAL:'4',CODCFO:'0000000001',CODCOLCFO:bank.CODCOLCFO,CODTMV:'1.2.16',NUMEROMOV:c.numeroDaNF.slice(0,9),...opts.createMov})}${xml('TMOVCOMPL',{TICKET:'9003'})}</MovMovimento>]]>`,'MovMovimentoTBCData','ctx');
      return {statusCode:200,body:JSON.stringify({PG:result.split(';')[1]})};
    } catch { return {statusCode:500,body:'{}'}; }
  };
  const run=(fields={})=>executarPagamentoSeguro({...payload,...fields},{getRemainingTimeInMillis:()=>remaining},create,{repositorio:repo,rm});
  const all=async()=>(await doc.send(new ScanCommand({TableName:table,ConsistentRead:true}))).Items;
  const expire=async()=>{for(const op of await all())await doc.send(new UpdateCommand({TableName:table,Key:{pk:op.pk},UpdateExpression:'SET lockUntil=:old',ExpressionAttributeValues:{':old':Date.now()-1}}));remaining=30000;};
  return {run,count,expire,all,setBank(v){bank={...bank,...v};},setLan(id,v){lans.set(id,{...lans.get(id),...v});},get lans(){return lans;},setTime(t){remaining=t;},newRepo(){repo=new DynamoPagamento(table,DynamoDBDocumentClient.from(client));},get repo(){return repo;}};
}

test('PIX: criação e gravação com leitura final; replay em instância nova sem nova escrita',async()=>{
  const x=await setup();const first=await x.run();assert.equal(first.statusCode,200);assert.equal(parse(first).LF,'9002');
  assert.equal(x.lans.get('9002').IDPGTO,'6');assert.equal(x.lans.get('9002').CODCOLPGTO,'8');
  x.newRepo();const second=await x.run({atividadeAtual:'baixarLancamento',idDoMovimento:'9001',idDoLancamento:'9002'});
  assert.equal(second.statusCode,200);assert.equal(parse(second).integracaoBancaria,'ja_gravada');assert.equal(x.count.create,1);assert.equal(x.count.update,1);
  assert.equal((await x.all()).filter(r=>r.state==='COMPLETE').length,2);
});
test('cadastro é validado por chave completa, modalidade, fornecedor e destino antes de criar',async()=>{
  for(const bad of [{idpgto:''},{idpgto:'0'},{IDPGTO:'7'},{CODCOLPGTO:'9'},{idPagamento:'8$_$0$_$outro$_$6'},
    {idPagamento:'8$_$1$_$0000000001$_$6'},{chavePIX:'other'},{codigoTipoChavePIX:'3'},
    {formaPagamentoIdpgto:'Transferência Bancária'},{listaDeParcelas:[{valorDaParcela:'100',vencimentoDaParcela:'2026-11-10',idpgto:'8'}]}]){
    const x=await setup();assert.equal((await x.run(bad)).statusCode,422,JSON.stringify(bad));assert.equal(x.count.create,0);assert.equal((await x.all()).length,0);
  }
  const x=await setup({bank:{ATIVO:'0'}});assert.equal((await x.run()).statusCode,422);assert.equal((await x.all()).length,0);
  x.setBank({ATIVO:'1'});assert.equal((await x.run()).statusCode,200);
});
test('aliases numéricos ou chave composta aceitos e divergências bloqueadas',async()=>{
  const c={...payload,idpgto:'',idPagamento:'8$_$0$_$0000000001$_$6',CODCOLPGTO:''};
  assert.equal(identidadePagamento(c).idPgto,6);
  assert.throws(()=>identidadePagamento({...c,idpgto:'7'}));
  assert.equal(identidadePagamento({...payload,idpgto:'',IDPGTO:'6'}).idPgto,6);
});
test('transferência, boleto e concessionária preservam a modalidade nativa e o vínculo',async()=>{
  const cases=[{bank:{FORMAPAGAMENTO:'T'},fields:{chavePIX:'',codigoTipoChavePIX:'',formaPagamentoIdpgto:'Transferência Bancária'}},
    {bank:{FORMAPAGAMENTO:'I'},fields:{chavePIX:'',codigoTipoChavePIX:'',codigoDeBarrasBoleto:'1'.repeat(44),formaPagamentoIdpgto:'Boleto'}},
    {bank:{FORMAPAGAMENTO:'N'},fields:{chavePIX:'',codigoTipoChavePIX:'',codigoDeBarrasBoleto:'836500000002100000000008000000000000000000000000',formaPagamentoIdpgto:'Boleto'}}];
  for(const c of cases){const x=await setup({bank:c.bank});assert.equal((await x.run(c.fields)).statusCode,200);assert.equal(x.lans.get('9002').IDPGTO,'6');}
});
test('erros e timeout de criação nunca autorizam segunda criação após expirar lock',async()=>{
  for(const opts of [{createError:true},{createResult:'ambiguous'}]){
    const x=await setup(opts);assert.notEqual((await x.run()).statusCode,200);await x.expire();assert.equal((await x.run()).statusCode,409);assert.equal(x.count.create,1);
  }
});
test('timeout após checkpoint do movimento recupera PG sem duplicar',async()=>{
  const x=await setup({timeAfterCreate:true});assert.notEqual((await x.run()).statusCode,200);await x.expire();assert.equal((await x.run()).statusCode,200);assert.equal(x.count.create,1);
});
test('orçamento curto bloqueia antes de CREATING e pode retomar uma reserva ainda sem efeito',async()=>{
  const x=await setup();x.setTime(22000);assert.equal((await x.run()).statusCode,503);
  assert.equal((await x.all())[0].state,'RESERVED');assert.equal(x.count.create,0);
  await x.expire();assert.equal((await x.run()).statusCode,200);assert.equal(x.count.create,1);
});
test('falha/efeito incerto na associação não vira sucesso e nunca repete escrita incerta',async()=>{
  const committed=await setup({updateError:true});assert.notEqual((await committed.run()).statusCode,200);await committed.expire();assert.equal((await committed.run()).statusCode,200);assert.equal(committed.count.update,1);
  const lost=await setup({noEffect:true});assert.equal((await lost.run()).statusCode,409);await lost.expire();assert.equal((await lost.run()).statusCode,409);assert.equal(lost.count.update,1);
});
test('replay confirma persistência atual e detecta vínculo alterado sem sobrescrever',async()=>{
  const x=await setup();assert.equal((await x.run()).statusCode,200);x.setLan('9002',{IDPGTO:'7'});assert.equal((await x.run()).statusCode,409);assert.equal(x.count.update,1);
});
test('concorrência cria apenas um movimento e só um retorno pode confirmar',async()=>{
  const x=await setup();const out=await Promise.all([x.run(),x.run()]);assert.equal(out.filter(r=>r.statusCode===200).length,1);assert.equal(x.count.create,1);assert.equal(x.count.update,1);
});
test('movimento histórico, pago/cancelado, com boleto ou outra identidade nunca é sobrescrito',async()=>{
  for(const lan of [{IDPGTO:'9',CODCOLPGTO:'8'},{STATUSLAN:'1'},{VALORBAIXADO:'1.0'},{BAIXAPENDENTE:'1'},{IDBOLETO:'5'},{CODFILIAL:'3'},{CODCFO:'wrong'}]){
    const x=await setup({lookup:['9001'],lan});assert.equal((await x.run()).statusCode,409,JSON.stringify(lan));assert.equal(x.count.create,0);assert.equal(x.count.update,0);
  }
  for(const opts of [{mov:{STATUS:'C'}},{compl:{TICKET:'other'}},{lookup:['9001','9001']},{lookupError:true}]){
    const x=await setup({lookup:['9001'],...opts});assert.notEqual((await x.run()).statusCode,200);assert.equal(x.count.create,0);assert.equal(x.count.update,0);
  }
});
test('default do RM só é substituído na chamada que acabou de criar o lançamento',async()=>{
  const x=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8'}});assert.equal((await x.run()).statusCode,200);assert.equal(x.lans.get('9002').IDPGTO,'6');
  const y=await setup({lookup:['9001'],lan:{IDPGTO:'1',CODCOLPGTO:'8'}});assert.equal((await y.run()).statusCode,409);assert.equal(y.count.update,0);
});
test('parcelas fora da ordem são pareadas por valor/vencimento e têm checkpoint independente',async()=>{
  const x=await setup({afterFirstUpdate:true,parcelas:[{IDLAN:'9004',DATAVENCIMENTO:'2026-12-10',VALOR:'60.0000'},{IDLAN:'9002',DATAVENCIMENTO:'2026-11-10',VALOR:'40.0000'}]});
  const fields={listaDeParcelas:[{vencimentoDaParcela:'2026-11-10',valorDaParcela:'40,00'},{vencimentoDaParcela:'2026-12-10',valorDaParcela:'60,00'}]};
  assert.notEqual((await x.run(fields)).statusCode,200);assert.equal(x.count.update,1);await x.expire();assert.equal((await x.run(fields)).statusCode,200);assert.equal(x.count.create,1);assert.equal(x.count.update,2);
  assert.equal(x.lans.get('9004').IDPGTO,'6');assert.equal(x.lans.get('9002').IDPGTO,'6');
});
test('mudança financeira ou parcela ambígua bloqueia replay sem novo lançamento',async()=>{
  const x=await setup();await x.run();assert.equal((await x.run({valorDoAluguel:'90'})).statusCode,409);assert.equal(x.count.create,1);
  const key=identidadePagamento(payload), plans=planosPagamento(payload,key);
  assert.notEqual(hashIntencao(intencaoPagamento(payload,key,plans,'1.2.16')),hashIntencao(intencaoPagamento({...payload,valorDoIPTU:'10'},key,plans,'1.2.16')));
  assert.equal((await x.run({formaPagamentoIdpgto:'Transferência Bancária'})).statusCode,409);
});
test('montador real do legado usa o transporte durável e o protocolo confirma FLAN',async()=>{
  const x=await setup({realLegacy:true});assert.equal((await x.run()).statusCode,200);assert.equal(x.count.create,1);assert.equal(x.count.update,1);
});
test('erros do legado injetado registram etapa e classe sem expor Axios config, credenciais ou corpo',async()=>{
  const secret='SYNTHETIC_SECRET_MUST_NOT_APPEAR';
  const error=Object.assign(Error(secret),{name:'CanceledError',code:'ERR_CANCELED',
    config:{headers:{Authorization:secret},data:secret},request:{body:secret},response:{data:secret}});
  const x=await setup({realLegacy:true,createError:error});
  const logs=[],original={info:console.info,warn:console.warn,error:console.error};
  try {
    for(const level of Object.keys(original))console[level]=(...args)=>logs.push(args);
    const result=await x.run();assert.equal(result.statusCode,503);assert.equal(x.count.create,1);
  } finally {Object.assign(console,original);}
  const output=JSON.stringify(logs);assert.ok(output.includes('SaveRecord'));assert.ok(output.includes('CanceledError'));
  assert.ok(output.includes('ERR_CANCELED'));assert.equal(output.includes(secret),false);
  assert.equal(output.includes('Authorization'),false);assert.equal((await x.all())[0].state,'CREATING');
});
test('retorno RM sem chave registra somente categoria e tamanho e mantém a criação bloqueada',async()=>{
  const secret='SYNTHETIC_RM_DIAGNOSTIC_MUST_NOT_APPEAR';
  const x=await setup({realLegacy:true,createResult:`Business rejection ${secret} ===== at RM.Fixture`});
  const logs=[],original={info:console.info,warn:console.warn,error:console.error};
  try {
    for(const level of Object.keys(original))console[level]=(...args)=>logs.push(args);
    assert.equal((await x.run()).statusCode,503);
  } finally {Object.assign(console,original);}
  const output=JSON.stringify(logs);assert.ok(output.includes('rm_rejection_or_diagnostic'));assert.ok(output.includes('length'));
  assert.equal(output.includes(secret),false);assert.equal((await x.all())[0].state,'CREATING');
  await x.expire();assert.equal((await x.run()).statusCode,409);assert.equal(x.count.create,1);assert.equal(x.count.update,0);
});
test('retenção no RM conserva valor líquido e associa somente a parcela nativa do movimento',async()=>{
  const x=await setup({parcelas:[{IDLAN:'9002',DATAVENCIMENTO:'2026-11-10',VALOR:'80.0000'}]});
  assert.equal((await x.run()).statusCode,200);assert.equal(x.lans.get('9002').VALORORIGINAL,'80.0000');
  assert.equal(x.lans.get('9002').IDPGTO,'6');
});
test('retenção com bruto coincidente com outro líquido bloqueia boletos ambíguos antes de qualquer escrita',async()=>{
  const x=await setup({bank:{FORMAPAGAMENTO:'N'},parcelas:[
    {IDLAN:'9002',DATAVENCIMENTO:'2026-11-10',VALOR:'80.0000'},
    {IDLAN:'9004',DATAVENCIMENTO:'2026-11-10',VALOR:'64.0000'}]});
  const r=await x.run({chavePIX:'',codigoTipoChavePIX:'',valorTotal:'180',listaDeParcelas:[
    {vencimentoDaParcela:'2026-11-10',valorDaParcela:'100',codigoDeBarrasBoleto:'1'.repeat(44)},
    {vencimentoDaParcela:'2026-11-10',valorDaParcela:'80',codigoDeBarrasBoleto:'2'.repeat(44)}]});
  assert.equal(r.statusCode,409);assert.equal(x.count.update,0);
});
test('fornecedor de outra coligada só cria com CODCOLCFO validado no XML',async()=>{
  const x=await setup({realLegacy:true,bank:{CODCOLCFO:'3'}});assert.equal((await x.run({CODCOLCFO:'3'})).statusCode,200);assert.equal(x.count.create,1);
  const y=await setup({bank:{CODCOLCFO:'3'},createMov:{CODCOLCFO:'0'}});assert.notEqual((await y.run({CODCOLCFO:'3'})).statusCode,200);assert.equal(y.count.create,0);
});
test('handler preserva bundle original para não-PG e bloqueia JSON/PG inválido',async()=>{
  let old=0;
  const {handler}=require('./load-ts.cjs')(path.resolve(__dirname,'../src/functions/rm/post/solicitacaoDePagamento.ts'),{'./solicitacaoDePagamento.core.cjs':{handler:async()=>{old++;return {statusCode:200,body:'{}'};}}});
  assert.equal((await handler({body:JSON.stringify({tipoDaSolicitacao:'AD'})})).statusCode,200);assert.equal(old,1);
  assert.equal((await handler({body:'{'},{})).statusCode,422);
  assert.notEqual((await handler({body:JSON.stringify({...payload,idpgto:''})},{getRemainingTimeInMillis:()=>30000})).statusCode,200);assert.equal(old,1);
});
