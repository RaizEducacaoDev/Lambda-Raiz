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
async function capturarLogs(action){
  const logs=[],original={info:console.info,warn:console.warn,error:console.error};
  try {for(const level of Object.keys(original))console[level]=(...args)=>logs.push(args);return {result:await action(),logs};}
  finally {Object.assign(console,original);}
}
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
  const count={create:0,update:0,lookup:0,read:0,fiscal:0};
  let bank={CODCOLIGADA:'8',CODCOLCFO:'0',CODCFO:'0000000001',IDPGTO:'6',ATIVO:'1',FORMAPAGAMENTO:'S',TIPOPIX:'2',CHAVE:'fixture@example.test',...opts.bank};
  const rows=opts.parcelas || [{IDLAN:'9002',DATAVENCIMENTO:'2026-11-10',VALOR:'100.0000'}];
  let lans=new Map(rows.map(p=>[p.IDLAN,{CODCOLIGADA:'8',CODFILIAL:'4',IDMOV:'9001',IDLAN:p.IDLAN,CODCFO:'0000000001',CODCOLCFO:bank.CODCOLCFO,
    DATAVENCIMENTO:p.DATAVENCIMENTO,VALORORIGINAL:p.VALOR,STATUSLAN:'0',VALORBAIXADO:'0.0000',BAIXAPENDENTE:'0',...opts.lan}]));
  const movement=()=>`<MovMovimento>${xml('TMOV',{CODCOLIGADA:'8',CODFILIAL:'4',IDMOV:'9001',CODCFO:'0000000001',CODCOLCFO:bank.CODCOLCFO,CODTMV:'1.2.16',STATUS:'F',...opts.mov})}${xml('TMOVCOMPL',{CODCOLIGADA:'8',IDMOV:'9001',TICKET:'9003',...opts.compl})}${rows.map(r=>xml('TMOVPAGTO',{CODCOLIGADA:'8',IDMOV:'9001',...r})).join('')}</MovMovimento>`;
  const rm={
    async consultarContextoFiscal(key){count.fiscal++;if(opts.fiscalError)throw Error('fiscal unavailable');return opts.fiscalResponse||[{
      FISCAL_VERSION:1,REQUEST_COMPANY:8,REQUEST_BRANCH:4,REQUEST_SUPPLIER_COMPANY:Number(bank.CODCOLCFO),REQUEST_SUPPLIER:'0000000001',REQUEST_NATURE:Number(key.idNat),
      HAS_SUPPLIER:1,HAS_BRANCH:1,HAS_NATURE:1,NATURE_COMPANY:8,NATURE_ID:Number(key.idNat),NATURE_CODE:key.codigoNatureza||'1.949.01',NATURE_ACTIVE:1,NATURE_ROUTE:'D',
      SUPPLIER_UF:'RJ',SUPPLIER_COUNTRY_ID:1,BRANCH_UF:'RJ',BRANCH_COUNTRY_ID:1}];},
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
  return {run,count,expire,all,setBank(v){bank={...bank,...v};},setLan(id,v){lans.set(id,{...lans.get(id),...v});},setFiscal(options){Object.assign(opts,options);},get lans(){return lans;},setTime(t){remaining=t;},newRepo(){repo=new DynamoPagamento(table,DynamoDBDocumentClient.from(client));},get repo(){return repo;},table};
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
const fiscalFields={tipoDoPagamento:'NF',tipoDeItem:'Serviço',idDaNaturezaFiscal:'121',codigoDaNaturezaFiscal:'1.949.01'};
const fiscalIncompativel={FISCAL_VERSION:1,REQUEST_COMPANY:8,REQUEST_BRANCH:4,REQUEST_SUPPLIER_COMPANY:0,REQUEST_SUPPLIER:'0000000001',REQUEST_NATURE:121,
  HAS_SUPPLIER:1,HAS_BRANCH:1,HAS_NATURE:1,NATURE_COMPANY:8,NATURE_ID:121,NATURE_CODE:'1.949.01',NATURE_ACTIVE:1,NATURE_ROUTE:'D',
  SUPPLIER_UF:'RJ',SUPPLIER_COUNTRY_ID:1,BRANCH_UF:'RS',BRANCH_COUNTRY_ID:1};
test('CREATED/UPDATING duráveis retomam sem PG na entrada nem nova consulta fiscal, com Dynamo real emulado',async()=>{
  for(const state of ['CREATED','UPDATING'])for(const failure of ['incompativel','indisponivel']){
    const x=await setup({timeAfterCreate:true,mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'}});
    assert.equal((await x.run(fiscalFields)).statusCode,503);assert.equal(x.count.create,1);assert.equal(x.count.fiscal,1);
    let root=(await x.all()).find(r=>!r.pk.includes('#FLAN#'));assert.equal(root.state,'CREATED');assert.equal(root.pg,'9001');
    if(state==='UPDATING')await doc.send(new UpdateCommand({TableName:x.table,Key:{pk:root.pk},UpdateExpression:'SET #state=:state',ExpressionAttributeNames:{'#state':'state'},ExpressionAttributeValues:{':state':state}}));
    root=(await x.all()).find(r=>!r.pk.includes('#FLAN#'));
    assert.equal(await x.repo.concluida(root.pk,root.digest,undefined),undefined);
    assert.equal(await x.repo.movimentoConhecido(root.pk,root.digest,undefined),'9001');
    assert.deepEqual((await x.all()).find(r=>r.pk===root.pk),root);
    x.setFiscal(failure==='incompativel'?{fiscalResponse:[fiscalIncompativel]}:{fiscalError:true});
    await x.expire();x.newRepo();const result=await x.run(fiscalFields);
    assert.equal(result.statusCode,200,`${state}/${failure}`);assert.equal(parse(result).PG,'9001');assert.equal(parse(result).LF,'9002');
    assert.equal(x.count.fiscal,1);assert.equal(x.count.create,1);assert.equal(x.count.update,1);
    const completed=(await x.all()).find(r=>!r.pk.includes('#FLAN#'));assert.equal(completed.state,'COMPLETE');assert.equal(completed.pg,'9001');
  }
});
test('leitura do movimento durável não renova lease nem libera retomada com owner ainda ativo',async()=>{
  const x=await setup({timeAfterCreate:true,mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'}});await x.run(fiscalFields);
  const before=(await x.all()).find(r=>!r.pk.includes('#FLAN#'));x.setFiscal({fiscalError:true});x.setTime(30000);
  assert.equal((await x.run(fiscalFields)).statusCode,409);assert.equal(x.count.fiscal,1);assert.equal(x.count.create,1);assert.equal(x.count.update,0);
  assert.deepEqual((await x.all()).find(r=>r.pk===before.pk),before);
});
test('digest ou PG divergente na leitura consistente não permite bypass fiscal ou nova criação',async()=>{
  const x=await setup({timeAfterCreate:true,mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'}});await x.run(fiscalFields);await x.expire();
  const before=(await x.all()).find(r=>!r.pk.includes('#FLAN#'));
  await assert.rejects(()=>x.repo.movimentoConhecido(before.pk,'other-digest',undefined),/dados diferentes/);
  await assert.rejects(()=>x.repo.movimentoConhecido(before.pk,before.digest,'9009'),/dados diferentes/);
  x.setFiscal({fiscalError:true});assert.equal((await x.run({...fiscalFields,valorTotal:'101,00'})).statusCode,409);
  assert.equal(x.count.fiscal,1);assert.equal(x.count.create,1);assert.equal(x.count.update,0);
  assert.deepEqual((await x.all()).find(r=>r.pk===before.pk),before);
});
test('PG durável inválido bloqueia sem consultar fiscal e sem alterar a reserva',async()=>{
  const x=await setup({timeAfterCreate:true,mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'}});await x.run(fiscalFields);await x.expire();
  const parent=(await x.all()).find(r=>!r.pk.includes('#FLAN#'));
  await doc.send(new UpdateCommand({TableName:x.table,Key:{pk:parent.pk},UpdateExpression:'SET pg=:pg',ExpressionAttributeValues:{':pg':'invalid'}}));
  const before=(await x.all()).find(r=>r.pk===parent.pk);
  assert.equal((await x.run(fiscalFields)).statusCode,409);assert.equal(x.count.fiscal,1);assert.equal(x.count.create,1);assert.equal(x.count.update,0);
  assert.deepEqual((await x.all()).find(r=>r.pk===parent.pk),before);
});
test('snapshot de PG não autoriza criação se o registro adquirido perdeu o movimento',async()=>{
  const x=await setup({timeAfterCreate:true,mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'}});await x.run(fiscalFields);await x.expire();
  const original=x.repo.movimentoConhecido.bind(x.repo);
  x.repo.movimentoConhecido=async(pk,digest,pg)=>{const known=await original(pk,digest,pg);
    await doc.send(new UpdateCommand({TableName:x.table,Key:{pk},UpdateExpression:'SET #state=:state REMOVE pg',ExpressionAttributeNames:{'#state':'state'},ExpressionAttributeValues:{':state':'RESERVED'}}));return known;};
  x.setFiscal({fiscalError:true});assert.equal((await x.run(fiscalFields)).statusCode,409);
  assert.equal(x.count.fiscal,1);assert.equal(x.count.create,1);assert.equal(x.count.update,0);
});
test('baseline RM sem raiz ou RESERVED expirado adota o mesmo movimento sem fiscal stale nem criação',async()=>{
  for(const reserved of [false,true])for(const failure of ['incompativel','indisponivel']){
    const x=await setup({lookup:['9001'],mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'},
      ...(failure==='incompativel'?{fiscalResponse:[fiscalIncompativel]}:{fiscalError:true})});
    if(reserved){const fields={...payload,...fiscalFields},key=identidadePagamento(fields);
      const digest=hashIntencao(intencaoPagamento(fields,key,planosPagamento(fields,key),'1.2.03'));
      await x.repo.reservar(`${process.env.STAGE||'dev'}#PG#8#9003`,digest,undefined,30000);await x.expire();}
    const result=await x.run(fiscalFields);assert.equal(result.statusCode,200);assert.equal(parse(result).PG,'9001');assert.equal(parse(result).LF,'9002');
    assert.equal(x.count.fiscal,0);assert.equal(x.count.create,0);assert.equal(x.count.update,1);assert.equal(x.count.lookup,2);
    const root=(await x.all()).find(r=>!r.pk.includes('#FLAN#'));assert.equal(root.state,'COMPLETE');assert.equal(root.pg,'9001');
  }
});
test('CREATING ou estado desconhecido com candidato RM mantém409 e a reserva intacta',async()=>{
  for(const state of ['CREATING','RNE']){
    const x=await setup({lookup:['9001'],mov:{CODTMV:'1.2.03'},fiscalError:true});
    const fields={...payload,...fiscalFields},key=identidadePagamento(fields);
    const digest=hashIntencao(intencaoPagamento(fields,key,planosPagamento(fields,key),'1.2.03'));
    let op=await x.repo.reservar(`${process.env.STAGE||'dev'}#PG#8#9003`,digest,undefined,30000);
    op=await x.repo.avancar(op,'CREATING');
    if(state==='RNE')await doc.send(new UpdateCommand({TableName:x.table,Key:{pk:op.pk},UpdateExpression:'SET #state=:state',ExpressionAttributeNames:{'#state':'state'},ExpressionAttributeValues:{':state':state}}));
    await x.expire();const before=(await x.all())[0];
    assert.equal((await x.run(fiscalFields)).statusCode,409);assert.deepEqual((await x.all())[0],before);
    assert.equal(x.count.create,0);assert.equal(x.count.update,0);assert.equal(x.count.fiscal,0);
  }
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
test('rejeição1586multilinha registra motivo e hash sem dados sensíveis, preservando CREATING e409',async()=>{
  const raw='Campo CODTRB não foi informado.\r\nprivate@example.test CPF12345678909 contaACCOUNT_PRIVATE\r\n=====\r\nat RM.Fixture'.padEnd(1586,'x');
  const x=await setup({realLegacy:true,createResult:raw});
  const {result,logs}=await capturarLogs(()=>x.run());assert.equal(result.statusCode,503);
  const diagnostic=logs.find(l=>l[0]==='[RM-IDPGTO] Retorno de criação sem chave confirmada')[1];
  assert.equal(diagnostic.reasonCode,'RM_REQUIRED_FIELD');assert.equal(diagnostic.length,1586);
  assert.equal(diagnostic.responseSha256,require('node:crypto').createHash('sha256').update(raw).digest('hex'));
  const serialized=JSON.stringify(logs);for(const value of ['private@example.test','CPF12345678909','ACCOUNT_PRIVATE',raw])assert.equal(serialized.includes(value),false);
  assert.equal((await x.all())[0].state,'CREATING');assert.equal(x.count.create,1);assert.equal(x.count.update,0);
  await x.expire();assert.equal((await x.run()).statusCode,409);assert.equal(x.count.create,1);
});
test('chave recebida fica distinguível de checkpoint perdido, sem atualizar banco ou criar novamente',async()=>{
  const x=await setup({realLegacy:true});const advance=x.repo.avancar.bind(x.repo);
  x.repo.avancar=async(op,state,pg)=>{if(state==='CREATED')throw Object.assign(Error('PRIVATE_CHECKPOINT_DATA'),{name:'TimeoutError'});return advance(op,state,pg);};
  const {result,logs}=await capturarLogs(()=>x.run());assert.equal(result.statusCode,503);
  const events=logs.filter(l=>l[0]==='[RM-IDPGTO] Etapa de criação').map(l=>l[1].event);
  assert.deepEqual(events,['creating_checkpoint_started','creating_checkpoint_confirmed','transport_call_started','transport_call_returned','primary_key_received','created_checkpoint_started']);
  const pending=logs.find(l=>l[0]==='[RM-IDPGTO] Integração pendente')[1];
  assert.equal(pending.creationStage,'checkpoint_created');assert.equal(pending.receivedPg,'9001');assert.equal(pending.pg,undefined);
  assert.equal(JSON.stringify(logs).includes('PRIVATE_CHECKPOINT_DATA'),false);
  assert.equal((await x.all())[0].state,'CREATING');assert.equal(x.count.create,1);assert.equal(x.count.update,0);
  await x.expire();assert.equal((await x.run()).statusCode,409);assert.equal(x.count.create,1);
});
test('falha do checkpointCREATING nunca é apresentada como despacho ou respostaRM',async()=>{
  const x=await setup({realLegacy:true});const advance=x.repo.avancar.bind(x.repo);
  x.repo.avancar=async(op,state,pg)=>{const next=await advance(op,state,pg);if(state==='CREATING')throw Object.assign(Error('PRIVATE_CHECKPOINT_DATA'),{name:'TimeoutError'});return next;};
  const {result,logs}=await capturarLogs(()=>x.run());assert.equal(result.statusCode,503);
  const events=logs.filter(l=>l[0]==='[RM-IDPGTO] Etapa de criação').map(l=>l[1].event);
  assert.deepEqual(events,['creating_checkpoint_started']);
  assert.equal(logs.find(l=>l[0]==='[RM-IDPGTO] Integração pendente')[1].creationStage,'checkpoint_creating');
  assert.equal(x.count.create,0);assert.equal(x.count.update,0);assert.equal((await x.all())[0].state,'CREATING');
  assert.equal(JSON.stringify(logs).includes('PRIVATE_CHECKPOINT_DATA'),false);
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
