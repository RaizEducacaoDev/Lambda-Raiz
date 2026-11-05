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
const { identidadePagamento, planosPagamento, intencaoPagamento, hashIntencao, codigoMovimento } = load('pagamentoIdentidade.ts');
const xml = (table, obj) => `<${table}>${Object.entries(obj).map(([k,v]) => `<${k}>${v}</${k}>`).join('')}</${table}>`;
const dataset = (table, obj) => `<DataSet>${xml(table, obj)}</DataSet>`;
const payload = { tipoDaSolicitacao:'PG', tipoDoPagamento:'OG', outrosGastos:'FR', atividadeAtual:'analiseFiscal',
  ticketRaiz:'9003', codigoDaColigada2:'8', codigoDaFilial2:'4', codigoDoFornecedor:'0000000001',
  idpgto:'6', CODCOLPGTO:'8', CODCOLCFO:'0', numeroDaNF:'9003001',
  dataDeVencimento:'2026-11-10', valorTotal:'100,00', codigoTipoChavePIX:'2', chavePIX:'fixture@example.test',
  dataDeEmissao:'2026-10-29',dataDeEntrada:'2026-10-29',chaveDeAcesso:'',itens:[],tributos:[] };
const parse = response => JSON.parse(response.body);
const documentoFixture=require('./documento-fixture.cjs');
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
  const count={create:0,update:0,lookup:0,read:0,fiscal:0,censo:0,document:0};
  let bank={CODCOLIGADA:'8',CODCOLCFO:'0',CODCFO:'0000000001',IDPGTO:'6',ATIVO:'1',FORMAPAGAMENTO:'S',TIPOPIX:'2',CHAVE:'fixture@example.test',...opts.bank};
  const rows=opts.parcelas || [{IDLAN:'9002',DATAVENCIMENTO:'2026-11-10',VALOR:'100.0000'}];
  let lans=new Map(rows.map(p=>[p.IDLAN,{CODCOLIGADA:'8',CODFILIAL:'4',IDMOV:'9001',IDLAN:p.IDLAN,CODCFO:'0000000001',CODCOLCFO:bank.CODCOLCFO,
    DATAVENCIMENTO:p.DATAVENCIMENTO,VALORORIGINAL:p.VALOR,STATUSLAN:'0',VALORBAIXADO:'0.0000',BAIXAPENDENTE:'0',...opts.lan}]));
  const movement=()=>`<MovMovimento>${xml('TMOV',{CODCOLIGADA:'8',CODFILIAL:'4',IDMOV:'9001',CODCFO:'0000000001',CODCOLCFO:bank.CODCOLCFO,CODTMV:opts.codTmv||'1.2.16',STATUS:'F',NUMEROMOV:payload.numeroDaNF,SERIE:'1',CODTDO:'002',DATAEMISSAO:payload.dataDeEmissao,DATASAIDA:payload.dataDeEntrada,VALORLIQUIDO:'100.0000',VALORBRUTO:'100.0000',...opts.mov})}${xml('TMOVCOMPL',{CODCOLIGADA:'8',IDMOV:'9001',TICKET:'9003',...opts.compl})}${rows.map(r=>xml('TMOVPAGTO',{CODCOLIGADA:'8',IDMOV:'9001',...r})).join('')}</MovMovimento>`;
  const rm={
    async consultarDocumento(key){count.document++;if(opts.documentError)throw Error('document unavailable');return opts.documentResponse || [documentoFixture(key, opts.nativeAfterLost ? {
      DOC_MATCH_COUNT:1,CODCOLIGADA:8,CODFILIAL:4,IDMOV:9001,CODCOLCFO:0,CODCFO:'0000000001',CODTMV:opts.codTmv||'1.2.03',
      SERIE:key.serie||opts.documentNative?.EFFECTIVE_SERIES||'1',NUMEROMOV:key.numero.padStart(9,'0'),CODTDO:opts.documentNative?.DOCUMENT_TYPE_IS_NULL===1?null:opts.documentNative?.EFFECTIVE_DOCUMENT_TYPE||'002',CODCOLCFOAUX:0,CODCFOAUX:'0000000001',TICKET:'9003',...opts.documentNative
    } : opts.documentNative||{})];},
    async consultarRetomada(){count.censo++;if(opts.censoError || opts.censoErrorAt===count.censo)throw Error('census unavailable');
      const exists=opts.nativeAfterLost || (opts.nativeFromCensus && count.censo>=opts.nativeFromCensus);
      return opts.censo || {movimentos:exists?[{coligada:'8',idMov:'9001'}]:[],
        lancamentos:exists?rows.map(p=>({coligada:'8',idMov:'9001',idLan:p.IDLAN,boletos:0})):[]};},
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
      if(table==='MovMovimentoTBCData'){count.create++;count.createdXml=content;if(opts.createError){if(opts.commitOnError){opts.nativeAfterLost=true;opts.lookup=['9001'];}throw opts.createError instanceof Error?opts.createError:Error('timeout');}if(opts.timeAfterCreate)remaining=6000;return opts.createResult||'8;9001';}
      count.update++;const row=registroUnico(content.slice(9,-3),'FLAN');
      if(!opts.noEffect)lans.set(row.IDLAN,{...lans.get(row.IDLAN),...row,...opts.nativeBankSideEffect});
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
      const result=await transport.saveRecord(`<![CDATA[<MovMovimento>${xml('TMOV',{CODCOLIGADA:'8',CODFILIAL:'4',CODCFO:'0000000001',CODCOLCFO:bank.CODCOLCFO,CODTMV:codigoMovimento(c),NUMEROMOV:c.numeroDaNF.slice(0,9),...(c.serie?{SERIE:c.serie}:{}),...opts.createMov})}${xml('TMOVCOMPL',{TICKET:'9003'})}</MovMovimento>]]>`,'MovMovimentoTBCData','ctx');
      return {statusCode:200,body:JSON.stringify({PG:result.split(';')[1]})};
    } catch { return {statusCode:500,body:'{}'}; }
  };
  const run=(fields={})=>executarPagamentoSeguro({...payload,...fields},{getRemainingTimeInMillis:()=>remaining},create,{repositorio:repo,rm});
  const rawAll=async()=>(await doc.send(new ScanCommand({TableName:table,ConsistentRead:true}))).Items;
  const all=async()=>(await rawAll()).filter(r=>!r.pk.includes('#EVIDENCE#'));
  const expire=async()=>{for(const op of (await all()).filter(r=>r.state))await doc.send(new UpdateCommand({TableName:table,Key:{pk:op.pk},UpdateExpression:'SET lockUntil=:old',ExpressionAttributeValues:{':old':Date.now()-1}}));remaining=30000;};
  return {run,count,expire,all,rawAll,setBank(v){bank={...bank,...v};},setLan(id,v){lans.set(id,{...lans.get(id),...v});},setFiscal(options){Object.assign(opts,options);},get lans(){return lans;},setTime(t){remaining=t;},newRepo(){repo=new DynamoPagamento(table,DynamoDBDocumentClient.from(client));},get repo(){return repo;},table};
}

// Native read-only DOC contracts, company9: default series and CODTDO vary by
// type. They are observations, never automatic choices of a new fiscal series.
const tiposPG = [
 ['1.2.01',{tipoDoPagamento:'NF',tipoDeItem:'Material'},'1','055'],
 ['1.2.03',{tipoDoPagamento:'NF',tipoDeItem:'Serviço'},'1','002'],
 ['1.2.25',{tipoDoPagamento:'TM'},'0','057'],
 ['1.2.09',{tipoDoPagamento:'CC',contasDeConsumo:'A'},'1','029'],
 ['1.2.10',{tipoDoPagamento:'CC',contasDeConsumo:'E'},'1','006'],
 ['1.2.11',{tipoDoPagamento:'CC',contasDeConsumo:'I'},'1','022'],
 ['1.2.12',{tipoDoPagamento:'CC',contasDeConsumo:'G'},'1','028'],
 ['1.2.16',{tipoDoPagamento:'OG',outrosGastos:'FR'},'REC',''],
 ['1.2.08',{tipoDoPagamento:'OG',outrosGastos:'',tipoDoLocador:'PF'},'AL',''],
 ['1.2.17',{tipoDoPagamento:'OG',outrosGastos:'',tipoDoLocador:'PJ'},'ALPJ',''],
];

test('filial bancária incompatível é informada antes de reservar ou criar para todos os tipos PG',async()=>{
 for(const [codTmv,fields] of tiposPG){
  const x=await setup({codTmv,bank:{CODFILIAL:'5'}}),result=await x.run(fields);
  assert.equal(result.statusCode,422,codTmv);assert.match(parse(result).message,/cadastro bancário.*filial 5.*solicitação.*filial 4/);
  assert.equal(x.count.create,0);assert.equal(x.count.update,0);assert.equal((await x.rawAll()).length,0);
  assert.equal(x.count.lookup+x.count.document,0);assert.equal(x.count.censo,1);
 }
});

test('cadastro compatível após recusa de filial prossegue sem reserva presa nem alteração do digest',async()=>{
 const x=await setup({bank:{CODFILIAL:'5'}}),snapshot=JSON.stringify(payload);
 assert.equal((await x.run()).statusCode,422);assert.equal((await x.rawAll()).length,0);
 x.setBank({CODFILIAL:'4'});assert.equal((await x.run()).statusCode,200);
 const key=identidadePagamento(payload),root=(await x.all()).find(r=>r.pk==='dev#PG#8#9003');
 assert.equal(root.digest,hashIntencao(intencaoPagamento(payload,key,planosPagamento(payload,key),codigoMovimento(payload))));
 assert.equal(JSON.stringify(payload),snapshot);assert.equal(x.count.create,1);assert.equal(x.count.update,1);
});

test('filial coincidente ou sem restrição positiva mantém contrato bancário existente',async()=>{
 for(const bank of [{CODFILIAL:'4'},{CODFILIAL:'04'},{CODFILIAL:''},{CODFILIAL:'0'},{}]){
  const x=await setup({bank}),result=await x.run();assert.equal(result.statusCode,200,result.body);
  assert.equal(x.count.create,1);assert.equal(x.count.update,1);assert.equal(x.lans.get('9002').CODFILIAL,'4');
 }
});

test('cadastro passa a filial incompatível depois de CREATED: nenhum novo movimento ou banco é escrito',async()=>{
 const x=await setup({bank:{CODFILIAL:'4'},timeAfterCreate:true});assert.equal((await x.run()).statusCode,503);
 await x.expire();const before=await x.rawAll();x.setBank({CODFILIAL:'5'});
 assert.equal((await x.run()).statusCode,422);assert.equal(x.count.create,1);assert.equal(x.count.update,0);
 assert.deepEqual(await x.rawAll(),before);
});

test('replay já confirmado preserva o vínculo persistido sem reaplicar cadastro posteriormente alterado',async()=>{
 const x=await setup({bank:{CODFILIAL:'4'}});assert.equal((await x.run()).statusCode,200);
 x.setBank({CODFILIAL:'5',ATIVO:'0'});assert.equal((await x.run()).statusCode,200);
 assert.equal(x.count.create,1);assert.equal(x.count.update,1);assert.equal(x.lans.get('9002').CODFILIAL,'4');
});

test('dez tipos PG usam XML real, contrato nativo por tipo, IDPGTO e replay sem segunda criação',async()=>{
 for(const [codTmv,fields,series,documentType] of tiposPG){
  const x=await setup({realLegacy:true,codTmv,documentNative:{EFFECTIVE_SERIES:series,EFFECTIVE_DOCUMENT_TYPE:documentType||null,DOCUMENT_TYPE_IS_NULL:documentType?0:1},mov:{SERIE:series,CODTDO:documentType}});
  const input={...fields,...(['1.2.01','1.2.03','1.2.25'].includes(codTmv)?{serie:series}:{}),valorDoAluguel:'100,00',valorDoIPTU:'',valorDoCondominio:'',valorTaxaDeIncendio:'',valorContaDeEnergia:'',valorContaDeAgua:'',ValorContaDeGas:''};
  const raw={...payload,...input},before=JSON.stringify(raw),key=identidadePagamento(raw);
  const first=await x.run(input);assert.equal(first.statusCode,200,`${codTmv}: ${first.body}`);
  const header=registroUnico(x.count.createdXml.slice(9,-3),'TMOV');
  assert.equal(header.CODTMV,codTmv);assert.equal(header.SERIE||'',input.serie||'');assert.equal(header.NUMEROMOV,raw.numeroDaNF);assert.equal(x.count.lookup+x.count.document,0);assert.equal(x.count.censo,2);
  assert.equal((await x.all()).find(r=>r.pk==='dev#PG#8#9003').digest,hashIntencao(intencaoPagamento(raw,key,planosPagamento(raw,key),codTmv)));
  assert.equal(JSON.stringify(raw),before);assert.equal(x.lans.get('9002').IDPGTO,'6');assert.equal(x.lans.get('9002').CODCOLPGTO,'8');
  x.newRepo();assert.equal((await x.run(input)).statusCode,200,codTmv);assert.equal(x.count.create,1);assert.equal(x.count.update,1);
 }
});

test('dez tipos permitem corrigir reserva2 pré-envio e mantêm histórico, sem repetir movimento',async()=>{
 for(const [codTmv,fields] of tiposPG){
  const x=await setup({stockError:true,codTmv});assert.equal((await x.run(fields)).statusCode,503);
  const original=(await x.all()).find(r=>r.pk==='dev#PG#8#9003');assert.equal(original.state,'RESERVED');assert.ok(original.lockUntil<Date.now());
  x.setFiscal({stockError:false});assert.equal((await x.run({...fields,numeroDaNF:'9003002'})).statusCode,200,codTmv);
  assert.equal(x.count.create,1);assert.equal((await x.all()).filter(r=>r.pk.includes('#HISTORY#')).length,1);
 }
});

test('dez tipos com efeito após timeout reconhecem cadeia parcial sem uma segunda criação',async()=>{
 for(const [codTmv,fields] of tiposPG){
  const x=await setup({codTmv,createError:true,commitOnError:true});
  assert.equal((await x.run(fields)).statusCode,503,codTmv);assert.equal(x.count.create,1);
  await x.expire();x.setFiscal({createError:false,createResult:'Já Existe Nota do Emitente com este Número e Série.\n=====\nat RM.Fixture'});
  const results=await Promise.all([x.run(fields),x.run(fields)]);
  assert.ok(results.every(r=>r.statusCode===409),codTmv);
  assert.equal(x.count.create,1);assert.equal(x.count.update,0);
  assert.equal(x.count.lookup+x.count.document,0);assert.equal(x.count.censo,4);
 }
});

test('dados locais inválidos são422 sem reserva; datas vazias preservam default e referências CC35 permanecem completas',async()=>{
 for(const [codTmv,fields] of tiposPG){
  for(const invalid of [{dataDeEntrada:'31/02/2026'},{dataDeEmissao:'garbage'},{valorTotal:'NaN'},{tributos:{}},{numeroDaNF:' 123'}]){
   const x=await setup({codTmv});assert.equal((await x.run({...fields,...invalid})).statusCode,422,codTmv);assert.equal((await x.rawAll()).length,0);assert.equal(x.count.create,0);
  }
 }
 const x=await setup({codTmv:'1.2.10'}),number='12345678901234567890123456789012345';
 const result=await x.run({tipoDoPagamento:'CC',contasDeConsumo:'E',numeroDaNF:number,dataDeEntrada:''});assert.equal(result.statusCode,200,result.body);
 assert.equal(registroUnico(x.count.createdXml.slice(9,-3),'TMOV').NUMEROMOV,number);
});

test('material com produto vazio nas linhas6 e10 é422 antes de reservar, sem invalidar itens automáticos de consumo',async()=>{
 const items=Array.from({length:11},(_,i)=>({codigoDoItem:[5,9].includes(i)?'':'124113',qtdDoItem:'1',valorDoItem:i===5?'30,79':i===9?'34,31':'1,00',desconto:'0'}));
 const x=await setup({codTmv:'1.2.01'});let result=await x.run({tipoDoPagamento:'NF',tipoDeItem:'Material',itens:items});
 assert.equal(result.statusCode,422);assert.equal(parse(result).code,'DADOS_PAGAMENTO_INVALIDOS');assert.match(parse(result).message,/6, 10.*produto/);assert.equal(x.count.create,0);assert.equal((await x.rawAll()).length,0);
 const y=await setup({codTmv:'1.2.10'});result=await y.run({tipoDoPagamento:'CC',contasDeConsumo:'E',itens:items});assert.equal(result.statusCode,200,result.body);
});

test('evidência durável não guarda XML, chavePIX, barcode, conta, documento pessoal ou link assinado',async()=>{
 const x=await setup({realLegacy:true});const raw={Banco:'BANK_PRIVATE',Agencia:'AGENCY_PRIVATE',Conta:'ACCOUNT_PRIVATE',
  informacoes:'CPF_PRIVATE',linkDaSolicitacao:'https://private.invalid/?token=SECRET_PRIVATE'};
 assert.equal((await x.run(raw)).statusCode,200);
 const evidence=(await x.rawAll()).filter(r=>r.pk.includes('#EVIDENCE#'));assert.equal(evidence.length,1);const stored=JSON.stringify(evidence);
 for(const privateValue of [...Object.values(raw),'fixture@example.test','<TMOV>'])assert.equal(stored.includes(privateValue),false,privateValue);
 assert.match(evidence[0].evidence.xmlSha256,/^[a-f0-9]{64}$/);assert.equal(evidence[0].evidence.installments.length,1);
});

test('falha de evidência é antes de CREATING e permite corrigir a reserva, sem despachar',async()=>{
 const x=await setup();const original=x.repo.registrarEvidencia.bind(x.repo);x.repo.registrarEvidencia=async()=>{throw Error('PRIVATE_STORAGE')};
 assert.equal((await x.run()).statusCode,503);const root=(await x.all())[0];assert.equal(root.state,'RESERVED');assert.ok(root.lockUntil<Date.now());assert.equal(x.count.create,0);
 x.repo.registrarEvidencia=original;assert.equal((await x.run({numeroDaNF:'9003002'})).statusCode,200);assert.equal(x.count.create,1);
});

test('série vazia permanece vazia para o RM aplicar seu default sem seleção pela Lambda',async()=>{
 const x=await setup({createMov:{SERIE:''},documentNative:{EFFECTIVE_SERIES:'REC'}});
 assert.equal((await x.run()).statusCode,200);
 assert.equal(registroUnico(x.count.createdXml.slice(9,-3),'TMOV').SERIE,'');
 assert.equal(x.count.document,0);
});

test('dez tipos mantêm duplicidade documental no RM após confirmar ausência pelo ticket',async()=>{
 for(const [codTmv,fields] of tiposPG){
  const x=await setup({codTmv,lookupError:true,documentError:true});
  assert.equal((await x.run(fields)).statusCode,200,codTmv);
  assert.equal(x.count.create,1);assert.equal(x.count.lookup+x.count.document,0);assert.equal(x.count.censo,2);
 }
});

test('CC35 preserva número completo e não repete criação já observada após timeout',async()=>{
 const x=await setup({codTmv:'1.2.10',createError:true,commitOnError:true});
 const input={tipoDoPagamento:'CC',contasDeConsumo:'E',numeroDaNF:'12345678901234567890123456789012345'};
 assert.equal((await x.run(input)).statusCode,503);await x.expire();
 x.setFiscal({createError:false,mov:{NUMEROMOV:input.numeroDaNF}});
 assert.equal((await x.run(input)).statusCode,409);assert.equal(x.count.create,1);assert.equal(x.count.update,0);
 assert.equal(registroUnico(x.count.createdXml.slice(9,-3),'TMOV').NUMEROMOV,input.numeroDaNF);
});

test('identidade bancária inválida conserva o código público e nunca reserva',async()=>{
 const x=await setup(),result=await x.run({idpgto:''});assert.equal(result.statusCode,422);assert.equal(parse(result).code,'IDPGTO_NAO_CONFIRMADO');assert.equal((await x.rawAll()).length,0);assert.equal(x.count.create,0);
});

test('data de entrada omitida preserva default nativo após consulta do ticket',async()=>{
 const x=await setup({codTmv:'1.2.01'});
 const fields={tipoDoPagamento:'NF',tipoDeItem:'Material',dataDeEntrada:''};
 assert.equal((await x.run(fields)).statusCode,200);
 assert.equal(x.count.create,1);assert.equal(x.count.update,1);assert.equal(x.count.censo,2);
});

test('rejeição RM encerra a tentativa e permite corrigir e enviar novamente imediatamente',async()=>{
 const raw='Já Existe Nota do Emitente com este Número e Série. CPF_PRIVATE private@example.test\n=====\nat RM.Fixture';
 const x=await setup({createResult:raw});const result=await x.run();assert.equal(result.statusCode,503);assert.equal(parse(result).code,'RM_DUPLICATE_RECORD');assert.match(parse(result).message,/duplicado/);
 const evidence=(await x.rawAll()).filter(r=>r.pk.includes('#EVIDENCE#'));assert.equal(evidence.length,2);assert.equal(evidence.find(r=>r.evidence.phase==='native_result').evidence.diagnostic.reasonCode,'RM_DUPLICATE_RECORD');
 const output=JSON.stringify([result,evidence]);assert.equal(output.includes('CPF_PRIVATE'),false);assert.equal(output.includes('private@example.test'),false);
 const root=(await x.all()).find(r=>r.pk==='dev#PG#8#9003');assert.equal(root.state,'RESERVED');assert.ok(root.lockUntil<Date.now());
 x.setFiscal({createResult:'8;9001'});
 assert.equal((await x.run({numeroDaNF:'9003002',dataDeEntrada:'2026-10-28'})).statusCode,200);
 assert.equal(x.count.create,2);assert.equal(x.count.update,1);
 const history=(await x.all()).filter(r=>r.pk.includes('#HISTORY#'));assert.equal(history.length,1);
 assert.equal(history[0].snapshot.digest,root.digest);
});

test('consulta automática com movimento de outro ticket não bloqueia formulário corrigido nem adota o movimento alheio',async()=>{
 const x=await setup();const result=await x.run({movimentoExistente:'71983'});
 assert.equal(result.statusCode,200,result.body);assert.equal(parse(result).PG,'9001');
 assert.equal(x.count.create,1);assert.notEqual(parse(result).PG,'71983');
});

test('consulta automática obsoleta não invalida confirmação nativa pelo ticket',async()=>{
 const x=await setup();assert.equal((await x.run()).statusCode,200);
 x.setFiscal({nativeAfterLost:true});
 const result=await x.run({movimentoExistente:'71983'});
 assert.equal(result.statusCode,200,result.body);assert.equal(parse(result).PG,'9001');
 assert.equal(x.count.create,1);assert.equal(x.count.update,1);
});

test('rejeição seguida de falha de consulta mantém a tentativa protegida e orienta aguardar em vez de reconciliar',async()=>{
 const x=await setup({createResult:'Já Existe Nota do Emitente com este Número e Série.\n=====\nat RM.Fixture',censoErrorAt:3});
 assert.equal((await x.run()).statusCode,503);
 const before=await x.rawAll();assert.equal(before.find(r=>r.pk==='dev#PG#8#9003').state,'CREATING');
 const retry=await x.run({numeroDaNF:'9003002'});assert.equal(retry.statusCode,409);
 assert.match(parse(retry).message,/Aguarde alguns instantes e envie novamente/);
 assert.doesNotMatch(parse(retry).message,/reconciliar/);assert.equal(x.count.create,1);
 assert.deepEqual(await x.rawAll(),before);
});

test('retorno de rejeição não libera tentativa quando a consulta encontra movimento ou título',async()=>{
  const x=await setup({createResult:'Já Existe Nota do Emitente com este Número e Série.\n=====\nat RM.Fixture'});
  const original=x.repo.encerrarRejeicao.bind(x.repo);let closed=0;x.repo.encerrarRejeicao=async op=>{closed++;return original(op);};
  // The first two censuses are pre-dispatch; expose an external effect only in
  // the read after the response so it cannot be mistaken for a rejected write.
  x.setFiscal({nativeFromCensus:3});
  assert.equal((await x.run()).statusCode,503);assert.equal(closed,0);
  assert.equal((await x.all()).find(r=>r.pk==='dev#PG#8#9003').state,'CREATING');
});

test('PIX: criação e gravação com leitura final; replay em instância nova sem nova escrita',async()=>{
  const x=await setup();const first=await x.run();assert.equal(first.statusCode,200);assert.equal(parse(first).LF,'9002');
  assert.equal(x.lans.get('9002').IDPGTO,'6');assert.equal(x.lans.get('9002').CODCOLPGTO,'8');
  x.newRepo();const second=await x.run({atividadeAtual:'baixarLancamento',idDoMovimento:'9001',idDoLancamento:'9002'});
  assert.equal(second.statusCode,200);assert.equal(parse(second).integracaoBancaria,'ja_gravada');assert.equal(x.count.create,1);assert.equal(x.count.update,1);
  assert.equal((await x.all()).filter(r=>r.state==='COMPLETE').length,2);
});

test('preserva patch PIX CNPJ ativo: máscara só na comparação, sem mudar entrada ou digest',async()=>{
 const x=await setup({bank:{TIPOPIX:'4',CHAVE:'12345678000199'}});
 const fields={codigoTipoChavePIX:'4',chavePIX:'12.345.678/0001-99'};
 assert.equal((await x.run(fields)).statusCode,200);assert.equal(fields.chavePIX,'12.345.678/0001-99');
 const current={...payload,...fields},key=identidadePagamento(current);
 assert.equal((await x.all()).find(r=>r.pk==='dev#PG#8#9003').digest,hashIntencao(intencaoPagamento(current,key,planosPagamento(current,key),'1.2.16')));
 for(const invalid of [{codigoTipoChavePIX:'4',chavePIX:'12.345.678/0001-98'},{codigoTipoChavePIX:'4',chavePIX:'./ -'}]){
  const y=await setup({bank:{TIPOPIX:'4',CHAVE:'12345678000199'}});assert.equal((await y.run(invalid)).statusCode,422);assert.equal(y.count.create,0);
 }
 const email=await setup({bank:{TIPOPIX:'2',CHAVE:'fixture@example.test'}});
 assert.equal((await email.run({chavePIX:'fixture@example-test'})).statusCode,422);assert.equal(email.count.create,0);
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
test('erro ou timeout não bloqueia permanentemente novo envio após expirar lock',async()=>{
  for(const opts of [{createError:true},{createResult:'ambiguous'}]){
    const x=await setup(opts);assert.notEqual((await x.run()).statusCode,200);
    assert.equal((await x.run()).statusCode,409);assert.equal(x.count.create,1);
    await x.expire();x.setFiscal({createError:false,createResult:'8;9001'});
    assert.equal((await x.run()).statusCode,200);assert.equal(x.count.create,2);assert.equal(x.count.update,1);
    const history=(await x.all()).filter(r=>r.pk.includes('#HISTORY#'));
    assert.equal(history.length,1);assert.equal(history[0].snapshot.state,'CREATING');
    assert.equal((await x.run()).statusCode,200);assert.equal(x.count.create,2);
  }
});
test('timeout após checkpoint do movimento recupera PG sem duplicar',async()=>{
  const x=await setup({timeAfterCreate:true});assert.notEqual((await x.run()).statusCode,200);await x.expire();assert.equal((await x.run()).statusCode,200);assert.equal(x.count.create,1);
});
const fiscalFields={tipoDoPagamento:'NF',tipoDeItem:'Serviço',idDaNaturezaFiscal:'121',codigoDaNaturezaFiscal:'1.949.01'};
const fiscalIncompativel={FISCAL_VERSION:1,REQUEST_COMPANY:8,REQUEST_BRANCH:4,REQUEST_SUPPLIER_COMPANY:0,REQUEST_SUPPLIER:'0000000001',REQUEST_NATURE:121,
  HAS_SUPPLIER:1,HAS_BRANCH:1,HAS_NATURE:1,NATURE_COMPANY:8,NATURE_ID:121,NATURE_CODE:'1.949.01',NATURE_ACTIVE:1,NATURE_ROUTE:'D',
  SUPPLIER_UF:'RJ',SUPPLIER_COUNTRY_ID:1,BRANCH_UF:'RS',BRANCH_COUNTRY_ID:1};

test('corrigir uma NF recusada antes do envio retoma imediatamente, arquiva a intenção e cria uma única vez',async()=>{
  const x=await setup({stockError:true,mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'}});
  assert.notEqual((await x.run(fiscalFields)).statusCode,200);
  const before=(await x.all()).find(r=>r.pk==='dev#PG#8#9003');
  assert.equal(before.state,'RESERVED');assert.equal(before.protocolVersion,2);assert.ok(before.lockUntil<=Date.now());assert.equal(x.count.create,0);
  x.setFiscal({stockError:false});
  assert.equal((await x.run({...fiscalFields,numeroDaNF:'9003002'})).statusCode,200);
  const records=await x.all(), after=records.find(r=>r.pk===before.pk), history=records.filter(r=>r.pk.includes('#HISTORY#'));
  assert.equal(after.state,'COMPLETE');assert.notEqual(after.digest,before.digest);assert.equal(history.length,1);
  assert.equal(history[0].snapshot.digest,before.digest);assert.equal(x.count.create,1);assert.equal(x.count.update,1);
});

test('corrigir intenção sem PG confirma ausência e mantém histórico antes de reenviar',async()=>{
 const x=await setup({stockError:true,mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'}});
 await x.run(fiscalFields);const before=(await x.all()).find(r=>r.pk==='dev#PG#8#9003');
 x.setFiscal({stockError:false,lookupError:true,documentError:true});
 assert.equal((await x.run({...fiscalFields,numeroDaNF:'9003002'})).statusCode,200);
 assert.equal(x.count.create,1);assert.equal(x.count.lookup+x.count.document,0);assert.equal(x.count.censo,3);
 assert.deepEqual((await x.all()).find(r=>r.pk.includes('#HISTORY#')).snapshot,before);
});

test('rejeição nativa permite corrigir série após expirar sem recuperar outro movimento automaticamente',async()=>{
 const x=await setup({createResult:'Série não permitida para este movimento.\n=====\nat RM.Fixture',mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'}});
 const first=await x.run({...fiscalFields,serie:'1'});assert.equal(first.statusCode,503);
 assert.equal(parse(first).message.includes('não autoriza uma nova criação'),false);
 await x.expire();const before=(await x.all()).find(r=>r.pk==='dev#PG#8#9003');
 x.setFiscal({createResult:'8;9001'});
 assert.equal((await x.run({...fiscalFields,serie:'2'})).statusCode,200);
 assert.equal(x.count.create,2);assert.equal(x.count.update,1);
 assert.deepEqual((await x.all()).find(r=>r.pk.includes('#HISTORY#')).snapshot,before);
 assert.equal(registroUnico(x.count.createdXml.slice(9,-3),'TMOV').SERIE,'2');
});

test('PG já conhecido continua verificando fornecedor unidade e parcelas sem criar outro',async()=>{
 for(const changes of [{mov:{CODTMV:'1.2.03',CODCFO:'other'}},{mov:{CODTMV:'1.2.03',CODFILIAL:'9'}},
  {lan:{STATUSLAN:'1',VALORBAIXADO:'100'}},{lan:{CODCFO:'other'}},{lan:{IDBOLETO:'99'}}]){
  const x=await setup({timeAfterCreate:true,mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'},...changes});
  await x.run(fiscalFields);await x.expire();assert.notEqual((await x.run(fiscalFields)).statusCode,200);
  assert.equal(x.count.create,1);assert.equal(x.count.update,0);
 }
});

test('zero no RM permite tentar novamente a mesma NF, preservando a intenção e as regras nativas',async()=>{
  const x=await setup({createError:true,mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'}});
  await x.run(fiscalFields);await x.expire();
  assert.equal((await x.run(fiscalFields)).statusCode,503);
  assert.equal((await x.run({...fiscalFields,numeroDaNF:'9003002'})).statusCode,409);
  assert.equal(x.count.create,2);assert.equal(x.count.update,0);
  assert.equal((await x.all()).find(r=>r.pk==='dev#PG#8#9003').state,'CREATING');
});

test('resposta RM sem identificador nunca vira sucesso nem associação de FLAN',async()=>{
 for(const result of ['erro nativo','9;9001','8;0','8;9001;extra']){
  const x=await setup({createResult:result});const response=await x.run();
  assert.notEqual(response.statusCode,200);assert.equal(parse(response).PG,undefined);
  assert.equal(x.count.create,1);assert.equal(x.count.update,0);
 }
});

test('consulta do ticket indisponível não autoriza nova criação ou reserva',async()=>{
 const x=await setup({censoError:true,lookupError:true,documentError:true,mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'}});
 assert.equal((await x.run(fiscalFields)).statusCode,503);assert.equal(x.count.create,0);
 assert.equal(x.count.censo,1);assert.equal(x.count.lookup+x.count.document,0);assert.equal((await x.rawAll()).length,0);
});

test('movimento aparece entre preflight e envio: não despacha e próximo pedido reconhece a operação',async()=>{
 const x=await setup({nativeFromCensus:2,lan:{IDPGTO:'6',CODCOLPGTO:'8'}});
 const first=await x.run();assert.notEqual(first.statusCode,200);
 assert.equal(x.count.create,0);assert.equal(x.count.update,0);
 const before=await x.rawAll();assert.equal(before.length,1);assert.equal(before[0].state,'RESERVED');
 assert.equal((await x.run()).statusCode,200);assert.equal(x.count.create,0);assert.equal(x.count.update,0);
 assert.deepEqual(await x.rawAll(),before);
});

test('segunda consulta falha: ausência inicial não autoriza despacho após erro',async()=>{
 const x=await setup({censoErrorAt:2});assert.equal((await x.run()).statusCode,503);
 assert.equal(x.count.create,0);assert.equal(x.count.update,0);assert.equal(x.count.censo,2);
 assert.equal((await x.all())[0].state,'RESERVED');
});

test('censo de cadeia parcial preserva continuação própria com recibo sem repetir criação',async()=>{
 const x=await setup({timeAfterCreate:true,nativeFromCensus:3});assert.equal((await x.run()).statusCode,503);
 await x.expire();assert.equal((await x.run()).statusCode,200);
 assert.equal(x.count.create,1);assert.equal(x.count.update,1);
 const before=await x.rawAll();assert.equal((await x.run()).statusCode,200);
 assert.equal(x.count.create,1);assert.equal(x.count.update,1);assert.deepEqual(await x.rawAll(),before);
});

test('serviço preserva série omitida para default nativo sem alterar a intenção da entrada',async()=>{
 const x=await setup({realLegacy:true,mov:{CODTMV:'1.2.03'}}),fields={...fiscalFields,serie:''};
 assert.equal((await x.run(fields)).statusCode,200);assert.equal(fields.serie,'');
 const header=registroUnico(x.count.createdXml.slice(9,-3),'TMOV');
 assert.equal(header.SERIE,undefined);assert.equal(header.NUMEROMOV,payload.numeroDaNF);
 const root=(await x.all()).find(r=>!r.pk.includes('#FLAN#')),raw={...payload,...fields},key=identidadePagamento(raw);
 assert.equal(root.digest,hashIntencao(intencaoPagamento(raw,key,planosPagamento(raw,key),'1.2.03')));
});

test('XML divergente da identidade documental validada nunca atravessa o checkpointCREATING',async()=>{
 const x=await setup({mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03',SERIE:'2'}});
 assert.notEqual((await x.run({...fiscalFields,serie:'1'})).statusCode,200);assert.equal(x.count.create,0);assert.equal(x.count.update,0);
 assert.equal((await x.all())[0].state,'RESERVED');
});
test('CREATED/UPDATING duráveis retomam sem PG na entrada nem nova consulta fiscal, com Dynamo real emulado',async()=>{
  for(const state of ['CREATED','UPDATING'])for(const failure of ['incompativel','indisponivel']){
    const x=await setup({timeAfterCreate:true,mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'}});
    assert.equal((await x.run(fiscalFields)).statusCode,503);assert.equal(x.count.create,1);assert.equal(x.count.fiscal,1);
    let root=(await x.all()).find(r=>!r.pk.includes('#FLAN#'));assert.equal(root.state,'CREATED');assert.equal(root.pg,'9001');
    // Root-UPDATING is a legacy fixture, not a phase emitted by the new receipt.
    if(state==='UPDATING')await doc.send(new UpdateCommand({TableName:x.table,Key:{pk:root.pk},UpdateExpression:'SET #state=:state REMOVE continuation',ExpressionAttributeNames:{'#state':'state'},ExpressionAttributeValues:{':state':state}}));
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
  await assert.rejects(()=>x.repo.movimentoConhecido(before.pk,'other-digest',undefined),/dados atuais precisam corresponder/i);
  await assert.rejects(()=>x.repo.movimentoConhecido(before.pk,before.digest,'9009'),/dados atuais precisam corresponder/i);
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
test('sem PG conhecido o RM decide se pode criar, sem adotar outro movimento por consulta',async()=>{
 for(const reserved of [false,true]){
  const x=await setup({lookup:['9001'],mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'}});
  if(reserved){const raw={...payload,...fiscalFields},key=identidadePagamento(raw);
   const digest=hashIntencao(intencaoPagamento(raw,key,planosPagamento(raw,key),'1.2.03'));
   await x.repo.reservar('dev#PG#8#9003',digest,undefined,30000);await x.expire();}
  assert.equal((await x.run(fiscalFields)).statusCode,200);assert.equal(x.count.create,1);assert.equal(x.count.lookup,0);
 }
});

test('CREATING expirado reenvia ao RM; estado desconhecido mantém409',async()=>{
  for(const state of ['CREATING','RNE']){
    const x=await setup({lookup:['9001'],mov:{CODTMV:'1.2.03'},createMov:{CODTMV:'1.2.03'}});
    const fields={...payload,...fiscalFields},key=identidadePagamento(fields);
    const digest=hashIntencao(intencaoPagamento(fields,key,planosPagamento(fields,key),'1.2.03'));
    let op=await x.repo.reservar(`${process.env.STAGE||'dev'}#PG#8#9003`,digest,undefined,30000);
    op=await x.repo.avancar(op,'CREATING');
    if(state==='RNE')await doc.send(new UpdateCommand({TableName:x.table,Key:{pk:op.pk},UpdateExpression:'SET #state=:state',ExpressionAttributeNames:{'#state':'state'},ExpressionAttributeValues:{':state':state}}));
    await x.expire();const before=(await x.all())[0];
    assert.equal((await x.run(fiscalFields)).statusCode,state==='CREATING'?200:409);
    if(state==='RNE')assert.deepEqual((await x.all())[0],before);
    assert.equal(x.count.create,state==='CREATING'?1:0);assert.equal(x.count.update,state==='CREATING'?1:0);assert.equal(x.count.lookup+x.count.document,0);assert.equal(x.count.censo,state==='CREATING'?2:1);
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
    const x=await setup({lan});assert.equal((await x.run({idDoMovimento:'9001'})).statusCode,409,JSON.stringify(lan));assert.equal(x.count.create,0);assert.equal(x.count.update,0);
  }
  for(const opts of [{mov:{STATUS:'C'}},{compl:{TICKET:'other'}},{mov:{CODCOLIGADA:'9'}},{readError:true}]){
    const x=await setup(opts);assert.notEqual((await x.run({idDoMovimento:'9001'})).statusCode,200);assert.equal(x.count.create,0);assert.equal(x.count.update,0);
  }
});
test('default do RM só é substituído com baseline da criação própria, nunca por movimento explícito',async()=>{
  const x=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8'}});assert.equal((await x.run()).statusCode,200);assert.equal(x.lans.get('9002').IDPGTO,'6');
  const y=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8'}});assert.equal((await y.run({idDoMovimento:'9001'})).statusCode,409);assert.equal(y.count.update,0);
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
test('retorno RM sem chave registra somente categoria e tamanho e permite nova tentativa',async()=>{
  const secret='SYNTHETIC_RM_DIAGNOSTIC_MUST_NOT_APPEAR';
  const x=await setup({realLegacy:true,createResult:`Business rejection ${secret} ===== at RM.Fixture`});
  const logs=[],original={info:console.info,warn:console.warn,error:console.error};
  try {
    for(const level of Object.keys(original))console[level]=(...args)=>logs.push(args);
    assert.equal((await x.run()).statusCode,503);
  } finally {Object.assign(console,original);}
  const output=JSON.stringify(logs);assert.ok(output.includes('rm_rejection_or_diagnostic'));assert.ok(output.includes('length'));
  assert.equal(output.includes(secret),false);assert.equal((await x.all())[0].state,'CREATING');
  await x.expire();assert.equal((await x.run()).statusCode,503);assert.equal(x.count.create,2);assert.equal(x.count.update,0);
});
test('rejeição1586multilinha registra motivo sem dados sensíveis e permite nova tentativa',async()=>{
  const raw='Campo CODTRB não foi informado.\r\nprivate@example.test CPF12345678909 contaACCOUNT_PRIVATE\r\n=====\r\nat RM.Fixture'.padEnd(1586,'x');
  const x=await setup({realLegacy:true,createResult:raw});
  const {result,logs}=await capturarLogs(()=>x.run());assert.equal(result.statusCode,503);
  const diagnostic=logs.find(l=>l[0]==='[RM-IDPGTO] Retorno de criação sem chave confirmada')[1];
  assert.equal(diagnostic.reasonCode,'RM_REQUIRED_FIELD');assert.equal(diagnostic.length,1586);
  assert.equal(diagnostic.responseSha256,require('node:crypto').createHash('sha256').update(raw).digest('hex'));
  const serialized=JSON.stringify(logs);for(const value of ['private@example.test','CPF12345678909','ACCOUNT_PRIVATE',raw])assert.equal(serialized.includes(value),false);
  assert.equal((await x.all())[0].state,'RESERVED');assert.equal(x.count.create,1);assert.equal(x.count.update,0);
  assert.equal((await x.run()).statusCode,503);assert.equal(x.count.create,2);
});
test('chave recebida fica distinguível de checkpoint perdido; nova tentativa consulta o RM',async()=>{
  const x=await setup({realLegacy:true});
  x.repo.confirmarCriacaoPropria=async()=>{throw Object.assign(Error('PRIVATE_CHECKPOINT_DATA'),{name:'TimeoutError'});};
  const {result,logs}=await capturarLogs(()=>x.run());assert.equal(result.statusCode,503);
  const events=logs.filter(l=>l[0]==='[RM-IDPGTO] Etapa de criação').map(l=>l[1].event);
  assert.deepEqual(events,['creating_checkpoint_started','creating_checkpoint_confirmed','transport_call_started','transport_call_returned','primary_key_received','created_checkpoint_started']);
  const pending=logs.find(l=>l[0]==='[RM-IDPGTO] Integração pendente')[1];
  assert.equal(pending.creationStage,'checkpoint_created');assert.equal(pending.receivedPg,'9001');assert.equal(pending.pg,undefined);
  assert.equal(JSON.stringify(logs).includes('PRIVATE_CHECKPOINT_DATA'),false);
  assert.equal((await x.all())[0].state,'CREATING');assert.equal(x.count.create,1);assert.equal(x.count.update,0);
  await x.expire();assert.equal((await x.run()).statusCode,503);assert.equal(x.count.create,2);
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


// Production continuation path: real Dynamo commands/dynalite; no audit reader
// injection and no network to AWS, RM or Zeev. Native records deliberately omit
// RECCREATEDON/RECMODIFIEDON, as observed on the installed DataServer.
const continuation = op => JSON.parse(op.continuation);
const rootOf = async x => (await x.all()).find(r=>r.pk==='dev#PG#8#9003');
function pauseAfterSeal(x) {
  const seal=x.repo.selarBaseline.bind(x.repo);
  x.repo.selarBaseline=async(...args)=>{const op=await seal(...args);x.setTime(6000);return op;};
}

test('continuação: padrão RM em duas parcelas retoma somente a pendente depois do prazo',async()=>{
  const x=await setup({afterFirstUpdate:true,lan:{IDPGTO:'1',CODCOLPGTO:'8'},parcelas:[
    {IDLAN:'9002',DATAVENCIMENTO:'2026-11-10',VALOR:'40.0000'},
    {IDLAN:'9004',DATAVENCIMENTO:'2026-12-10',VALOR:'60.0000'}]});
  const fields={listaDeParcelas:[{vencimentoDaParcela:'2026-11-10',valorDaParcela:'40,00'},
    {vencimentoDaParcela:'2026-12-10',valorDaParcela:'60,00'}]};
  assert.equal((await x.run(fields)).statusCode,503);assert.equal(x.count.create,1);assert.equal(x.count.update,1);
  const first=await rootOf(x),saved=continuation(first);
  assert.deepEqual(saved.progress,{'9002':'COMPLETE','9004':'PREPARED'});
  assert.deepEqual(Object.keys(saved.baseline.parcels).sort(),['9002','9004']);
  assert.equal(first.continuation.includes('fixture@example.test'),false);
  assert.equal(first.continuation.includes('RECCREATEDON'),false);
  await x.expire();x.newRepo();assert.equal((await x.run(fields)).statusCode,200);
  assert.equal(x.count.create,1);assert.equal(x.count.update,2);
  const last=await rootOf(x);assert.equal(last.digest,first.digest);assert.equal(last.state,'COMPLETE');
  assert.deepEqual(continuation(last).progress,{'9002':'COMPLETE','9004':'COMPLETE'});
});

test('continuação: selo completo antes da primeira parcela mantém autorização após expirar lease',async()=>{
  const x=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8'}});pauseAfterSeal(x);
  assert.equal((await x.run()).statusCode,503);assert.equal(x.count.update,0);
  const first=await rootOf(x);assert.equal(continuation(first).progress['9002'],'PREPARED');
  await x.expire();x.newRepo();assert.equal((await x.run()).statusCode,200);
  assert.equal(x.count.create,1);assert.equal(x.count.update,1);
});

test('continuação: CREATED antes do primeiro baseline não autoriza banco divergente tardio',async()=>{
  const x=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8'}}),confirm=x.repo.confirmarCriacaoPropria.bind(x.repo);
  x.repo.confirmarCriacaoPropria=async(...args)=>{const op=await confirm(...args);x.setTime(3000);return op;};
  assert.equal((await x.run()).statusCode,503);
  const first=await rootOf(x);assert.ok(continuation(first).receipt);assert.equal(continuation(first).baseline,undefined);
  await x.expire();x.newRepo();assert.equal((await x.run()).statusCode,409);
  assert.equal(x.count.create,1);assert.equal(x.count.update,0);
  assert.equal(continuation(await rootOf(x)).baseline,undefined);
});

test('continuação: alvo já persistido confirma após perda da resposta sem novo SaveRecord',async()=>{
  const x=await setup({updateError:true,lan:{IDPGTO:'1',CODCOLPGTO:'8'}});
  assert.equal((await x.run()).statusCode,503);assert.equal(continuation(await rootOf(x)).progress['9002'],'UPDATING');
  await x.expire();x.newRepo();assert.equal((await x.run()).statusCode,200);
  assert.equal(x.count.create,1);assert.equal(x.count.update,1);
});

test('continuação: estado nativo completo muda antes do despacho e nenhuma diferença é sobrescrita',async()=>{
  for(const change of [{IDPGTO:'3'},{HISTORICO:'external-edit'},{RECMODIFIEDON:'2026-11-04T20:00:00'},
    {STATUSLAN:'1'},{VALORORIGINAL:'101.0000'},{CODFILIAL:'3'}]) {
    const x=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8'}});pauseAfterSeal(x);assert.equal((await x.run()).statusCode,503);
    x.setLan('9002',change);await x.expire();x.newRepo();assert.equal((await x.run()).statusCode,409,JSON.stringify(change));
    assert.equal(x.count.create,1);assert.equal(x.count.update,0);
  }
});

test('continuação: legado e ADOPT com PG não ganham recibo/baseline pela presença de CREATED',async()=>{
  for(const adopted of [false,true]) {
    const x=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8'}});
    const key=identidadePagamento(payload),digest=hashIntencao(intencaoPagamento(payload,key,planosPagamento(payload,key),codigoMovimento(payload)));
    const op=await x.repo.reservar('dev#PG#8#9003',digest,'9001',30000);
    if(adopted)await doc.send(new UpdateCommand({TableName:x.table,Key:{pk:op.pk},UpdateExpression:'SET recuperadaCriacaoIncerta=:v',ExpressionAttributeValues:{':v':true}}));
    await x.expire();assert.equal((await x.run()).statusCode,409);assert.equal(x.count.create,0);assert.equal(x.count.update,0);
    assert.equal((await rootOf(x)).continuation,undefined);
  }
});

test('continuação: ACK perdido de recibo, selo ou claim de envio usa readback exato sem reenviar DDB',async()=>{
  for(const phase of ['receipt','seal','dispatch']) {
    const x=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8'}}),send=doc.send.bind(doc);let lost=0,writes=0;
    doc.send=async(cmd,...args)=>{
      const v=cmd.input?.ExpressionAttributeValues?.[':next'];
      const state=typeof v==='string'?JSON.parse(v):undefined;
      const matches=cmd.input?.TableName===x.table && state &&
        (phase==='receipt'?!state.baseline:phase==='seal'?state.progress?.['9002']==='PREPARED':state.progress?.['9002']==='UPDATING');
      if(matches)writes++;
      const result=await send(cmd,...args);
      if(matches&&!lost++){throw Object.assign(Error('ack lost after commit'),{name:'TimeoutError'});}
      return result;
    };
    try {assert.equal((await x.run()).statusCode,200,phase);}finally {doc.send=send;}
    assert.equal(writes,1,phase);assert.equal(lost,1);assert.equal(x.count.create,1);assert.equal(x.count.update,1);
  }
});

test('continuação: ACK perdido do checkpoint da parcela permanece incerto e não rearma UPDATING',async()=>{
  const x=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8'}}),advance=x.repo.avancar.bind(x.repo);
  x.repo.avancar=async(op,state,...args)=>{const next=await advance(op,state,...args);if(op.pk.includes('#FLAN#')&&state==='UPDATING')throw Error('lost child ACK');return next;};
  assert.equal((await x.run()).statusCode,503);assert.equal(x.count.update,0);
  await x.expire();x.newRepo();assert.equal((await x.run()).statusCode,409);assert.equal(x.count.update,0);
  assert.equal(continuation(await rootOf(x)).progress['9002'],'UPDATING');
});

test('continuação: raiz, owner, prazo, digest e baseline são cercados no mesmo CAS por parcela',async()=>{
  for(const change of ['owner','lease','digest','baseline']) {
    const x=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8'}}),dispatch=x.repo.avancarParcelaPropria.bind(x.repo);let changed=false;
    x.repo.avancarParcelaPropria=async(op,id,state)=>{
      if(state==='UPDATING'&&!changed){
        changed=true;let field=change==='lease'?'lockUntil':change==='baseline'?'continuation':change;
        let value=change==='owner'?'different-owner':change==='lease'?Date.now()-1:change==='digest'?'a'.repeat(64):undefined;
        if(change==='baseline'){const c=continuation(op);c.baseline.parcels[id].nativeHash='a'.repeat(64);value=JSON.stringify(c);}
        await doc.send(new UpdateCommand({TableName:x.table,Key:{pk:op.pk},UpdateExpression:'SET #f=:v',ExpressionAttributeNames:{'#f':field},ExpressionAttributeValues:{':v':value}}));
      }
      return dispatch(op,id,state);
    };
    assert.notEqual((await x.run()).statusCode,200,change);assert.equal(x.count.create,1);assert.equal(x.count.update,0,change);
  }
});

test('continuação: duas execuções após expirar lease despacham a parcela uma única vez',async()=>{
  const x=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8'}});pauseAfterSeal(x);assert.equal((await x.run()).statusCode,503);
  await x.expire();x.newRepo();const results=await Promise.all([x.run(),x.run()]);
  assert.equal(results.filter(r=>r.statusCode===200).length,1);assert.equal(x.count.create,1);assert.equal(x.count.update,1);
});

test('continuação: efeito nativo VALORAUXILIAR1→3 e auditoria posterior não invalidam alvo confirmado',async()=>{
  const x=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8',VALORAUXILIAR:'1'},nativeBankSideEffect:{VALORAUXILIAR:'3'}});
  assert.equal((await x.run()).statusCode,200);assert.equal(x.lans.get('9002').VALORAUXILIAR,'3');
  x.setLan('9002',{STATUSLAN:'1',VALORBAIXADO:'100.0000',RECMODIFIEDON:'2026-11-05T10:00:00',HISTORICO:'normal later payment'});
  x.setFiscal({mov:{STATUS:'Q',RECMODIFIEDON:'2026-11-05T10:00:00'}});
  assert.equal((await x.run()).statusCode,200);assert.equal(x.count.update,1);assert.equal(x.count.create,1);
  x.setLan('9002',{IDPGTO:'9'});assert.equal((await x.run()).statusCode,409);assert.equal(x.count.update,1);
});

test('continuação: ACK bancário perdido com alvo persistido e alterações nativas permite só confirmação',async()=>{
  const x=await setup({updateError:true,lan:{IDPGTO:'1',CODCOLPGTO:'8',VALORAUXILIAR:'1'},nativeBankSideEffect:{VALORAUXILIAR:'3'}});
  assert.equal((await x.run()).statusCode,503);assert.equal(x.lans.get('9002').IDPGTO,'6');
  x.setFiscal({mov:{RECMODIFIEDON:'2026-11-05T10:00:00'}});
  await x.expire();x.newRepo();assert.equal((await x.run()).statusCode,200);assert.equal(x.count.update,1);
  x.setLan('9002',{CODCFO:'outro'});assert.equal((await x.run()).statusCode,409);assert.equal(x.count.update,1);
});

test('continuação: perda da raiz durante checkpoint filho é detectada imediatamente antes do Save',async()=>{
  const x=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8'}}),advance=x.repo.avancar.bind(x.repo);
  x.repo.avancar=async(op,state,...args)=>{
    const next=await advance(op,state,...args);
    if(op.pk.includes('#FLAN#')&&state==='UPDATING')await doc.send(new UpdateCommand({TableName:x.table,Key:{pk:'dev#PG#8#9003'},
      UpdateExpression:'SET #owner=:owner',ExpressionAttributeNames:{'#owner':'owner'},ExpressionAttributeValues:{':owner':'new-owner'}}));
    return next;
  };
  assert.equal((await x.run()).statusCode,409);assert.equal(x.count.update,0);assert.equal(x.count.create,1);
});

test('continuação: baseline de todas as parcelas é validado antes de associar a primeira',async()=>{
  const x=await setup({lan:{IDPGTO:'1',CODCOLPGTO:'8'},parcelas:[
    {IDLAN:'9002',DATAVENCIMENTO:'2026-11-10',VALOR:'40.0000'},
    {IDLAN:'9004',DATAVENCIMENTO:'2026-12-10',VALOR:'60.0000'}]});
  x.setLan('9004',{IDBOLETO:'12'});
  const fields={listaDeParcelas:[{vencimentoDaParcela:'2026-11-10',valorDaParcela:'40,00'},
    {vencimentoDaParcela:'2026-12-10',valorDaParcela:'60,00'}]};
  assert.equal((await x.run(fields)).statusCode,409);assert.equal(x.count.update,0);
  assert.equal(continuation(await rootOf(x)).baseline,undefined);
});

test('continuação: manifesto completo é limitado, tipado e nunca aceita campos secretos ou parcela parcial',()=>{
  const {validarContinuacao,baselineParcela,hashSnapshot}=load('pagamentoContinuacao.ts');
  const receipt={owner:'fixture-owner',digest:'a'.repeat(64),pg:'9001',xmlSha256:'b'.repeat(64)};
  const entry=baselineParcela({IDLAN:'9002',IDPGTO:'1'},[['IDPGTO','6']]);
  const valid={version:1,receipt,baseline:{movementHash:hashSnapshot('movement'),parcels:{'9002':entry}},progress:{'9002':'PREPARED'}};
  validarContinuacao(valid);
  for(const bad of [{...valid,progress:{}},{...valid,secret:'private'},
    {...valid,receipt:{...receipt,xml:'secret'}},{...valid,baseline:{...valid.baseline,parcels:{'9002':{...entry,nativeHash:''}}}}])assert.throws(()=>validarContinuacao(bad));
  const parcels=Object.fromEntries(Array.from({length:1001},(_,i)=>[String(i+1),entry]));
  assert.throws(()=>validarContinuacao({...valid,baseline:{...valid.baseline,parcels},progress:Object.fromEntries(Object.keys(parcels).map(k=>[k,'PREPARED']))}));
});
