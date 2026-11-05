const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const modules=new Map(),load=file=>require('./load-ts.cjs')(path.resolve(__dirname,'../src/functions/rm/post',file),{},modules);
const {executarPagamentoSeguro}=load('solicitacaoDePagamentoSeguro.ts');
const {codigoMovimento,identidadePagamento,planosPagamento,intencaoPagamento,hashIntencao}=load('pagamentoIdentidade.ts');
const {registroUnico}=load('pagamentoV2Rm.ts');
const xml=(name,data)=>`<${name}>${Object.entries(data).map(([k,v])=>`<${k}>${v}</${k}>`).join('')}</${name}>`;
const dataset=(name,data)=>`<Fixture>${xml(name,data)}</Fixture>`;
const parse=result=>JSON.parse(result.body);
function setup(options={}){
 const fields={tipoDaSolicitacao:'PG',tipoDoPagamento:'NF',tipoDeItem:'Serviço',atividadeAtual:'aprovacaoDoGestor',
  ticketRaiz:'9003',codigoDaColigada2:'11',codigoDaFilial2:'1',codigoDoFornecedor:'0000000001',CODCOLCFO:'0',
  idpgto:'2',CODCOLPGTO:'11',numeroDaNF:'9003001',idDaNaturezaFiscal:'121',codigoDaNaturezaFiscal:'1.949.01',
  dataDeEmissao:'2026-10-26',dataDeEntrada:'2026-10-30',dataDeVencimento:'2026-12-31',valorTotal:'100,00',
  codigoTipoChavePIX:'2',chavePIX:'fixture@example.test',chaveDeAcesso:'',itens:[],tributos:[],...options.fields};
 const calls={reserve:0,create:0,bankWrite:0,fiscal:0,document:0,lookup:0,movementRead:0,census:0,evidences:[],order:[]},records=new Map();
 let lan={CODCOLIGADA:'11',IDLAN:'9002',IDMOV:'9001',CODFILIAL:'1',CODCFO:'0000000001',CODCOLCFO:'0',
  DATAVENCIMENTO:'2026-12-31',VALORORIGINAL:'100.0000',STATUSLAN:'0',VALORBAIXADO:'0',BAIXAPENDENTE:'0',
  ...(options.complete||options.durablePg||fields.idDoMovimento?{IDPGTO:'2',CODCOLPGTO:'11'}:{})};
 const repo={
  async consultar(pk){return records.get(pk);},
  async concluida(pk,digest,pg){calls.order.push('concluida');if(options.complete&&!pk.includes('#FLAN#'))return {pk,digest,pg:'9001',state:'COMPLETE',owner:'fixture',lockUntil:Date.now()+90000};return undefined;},
  async movimentoConhecido(){calls.order.push('movimentoConhecido');return options.durablePg;},
  async reservar(pk,digest,pg){calls.reserve++;calls.order.push('reservar');pg=options.reservePg||options.durablePg||pg;const op={pk,digest,...(pg?{pg}:{}),state:pg?'CREATED':'RESERVED',owner:'fixture',lockUntil:Date.now()+90000};records.set(pk,op);return op;},
  async registrarEvidencia(op,evidence){calls.evidences.push(evidence);},
  async encerrarRejeicao(op){const next={...op,state:'RESERVED',owner:'rejected-owner',lockUntil:Date.now()-1};records.set(op.pk,next);return next;},
  async avancar(op,state,pg=op.pg){const next={...op,state,...(pg?{pg}:{})};records.set(op.pk,next);return next;},
  // This fixture tests fiscal routing only. Continuation CAS and lost ACKs are
  // exercised against the real Dynamo repository/dynalite in pagamentoSeguro.
  async confirmarCriacaoPropria(op,pg,xmlSha256){
   const next={...op,state:'CREATED',pg,continuation:JSON.stringify({version:1,receipt:{owner:op.owner,digest:op.digest,pg,xmlSha256}})};
   records.set(op.pk,next);return next;
  },
  async selarBaseline(op,baseline){
   const c=JSON.parse(op.continuation),progress=Object.fromEntries(Object.keys(baseline.parcels).map(id=>[id,'PREPARED']));
   const next={...op,continuation:JSON.stringify({...c,baseline,progress})};records.set(op.pk,next);return next;
  },
  async avancarParcelaPropria(op,id,state){
   const c=JSON.parse(op.continuation),next={...op,continuation:JSON.stringify({...c,progress:{...c.progress,[id]:state}})};
   records.set(op.pk,next);return next;
  },
  async conferirEnvioProprio(op){assert.equal(records.get(op.pk).continuation,op.continuation);},
 };
 const rm={
  async consultarRetomada(){calls.census++;return {movimentos:[],lancamentos:[]};},
  async consultarDocumento(){calls.document++;throw Error('DOC2 must not run in payment submission');},
  async consultarContextoFiscal(key){calls.fiscal++;calls.order.push('fiscal');if(options.fiscalError)throw Error('fixture unavailable');
   const row={FISCAL_VERSION:1,REQUEST_COMPANY:11,REQUEST_BRANCH:1,REQUEST_SUPPLIER_COMPANY:0,REQUEST_SUPPLIER:'0000000001',
    REQUEST_NATURE:Number(key.idNat),HAS_SUPPLIER:1,HAS_BRANCH:1,HAS_NATURE:1,NATURE_COMPANY:11,NATURE_ID:Number(key.idNat),
    NATURE_CODE:fields.codigoDaNaturezaFiscal||'1.949.01',NATURE_ACTIVE:1,NATURE_ROUTE:'D',SUPPLIER_UF:'RJ',SUPPLIER_COUNTRY_ID:1,BRANCH_UF:'RS',BRANCH_COUNTRY_ID:1,...options.native};
   return options.fiscalResponse===undefined?[row]:options.fiscalResponse;},
  async buscarMovimentosPorTicket(){calls.lookup++;throw Error('RECON must not run in payment submission');},
  async buscarEstoque(){return '01.001';},
  async readReacord(key,server){
   if(server==='FinDadosPgtoDataBR'){calls.order.push('bank');return dataset('FDadosPgto',{CODCOLIGADA:'11',CODCOLCFO:'0',CODCFO:'0000000001',IDPGTO:'2',ATIVO:'1',FORMAPAGAMENTO:'S',TIPOPIX:'2',CHAVE:'fixture@example.test'});}
   if(server==='MovMovimentoTBCData'){calls.movementRead++;if(options.movementReadErrorAt===calls.movementRead)throw Error('fixture read unavailable');
    return `<MovMovimento>${xml('TMOV',{CODCOLIGADA:'11',IDMOV:'9001',CODFILIAL:'1',CODCFO:'0000000001',CODCOLCFO:'0',CODTMV:codigoMovimento(fields),STATUS:'F',...options.movement})}${xml('TMOVCOMPL',{CODCOLIGADA:'11',IDMOV:'9001',TICKET:'9003',...options.compl})}${xml('TMOVPAGTO',{CODCOLIGADA:'11',IDMOV:'9001',IDLAN:'9002',DATAVENCIMENTO:'2026-12-31',VALOR:'100.0000'})}</MovMovimento>`;}
   return dataset('FLAN',{...lan,...options.lan});
  },
  async saveRecord(content,server){if(server==='MovMovimentoTBCData'){calls.create++;if(options.createError)throw options.createError;return options.nativeResult||'11;9001';}
   calls.bankWrite++;lan={...lan,...registroUnico(content.slice(9,-3),'FLAN')};return '11;9002';},
 };
 const create=async(input,transport)=>{calls.createdInput=JSON.parse(JSON.stringify(input));await transport.saveRecord(`<![CDATA[<MovMovimento>${xml('TMOV',{CODCOLIGADA:'11',CODFILIAL:'1',CODCFO:'0000000001',CODCOLCFO:'0',CODTMV:codigoMovimento(input),NUMEROMOV:input.numeroDaNF,...(input.serie?{SERIE:input.serie}:{})})}${xml('TMOVCOMPL',{TICKET:'9003',...options.compl})}</MovMovimento>]]>`,'MovMovimentoTBCData','fixture');return {statusCode:200,body:'{}'};};
 const run=()=>executarPagamentoSeguro(fields,{getRemainingTimeInMillis:()=>30000},create,{repositorio:repo,rm});
 const digest=()=>{const key=identidadePagamento(fields);return hashIntencao(intencaoPagamento(fields,key,planosPagamento(fields,key),codigoMovimento(fields)));};
 return {fields,calls,records,run,digest};
}

test('natureza interna SP/RJ alcança criação simulada com a seleção original',async()=>{
 const x=setup({native:{SUPPLIER_UF:'SP',BRANCH_UF:'RJ'}}),snapshot=JSON.stringify(x.fields),digest=x.digest();const result=await x.run();
 assert.equal(result.statusCode,200);assert.equal(parse(result).PG,'9001');
 assert.equal(x.calls.fiscal,1);assert.equal(x.calls.order.indexOf('fiscal')<x.calls.order.indexOf('reservar'),true);
 assert.equal(x.calls.create,1);assert.equal(x.calls.bankWrite,1);
 const root=[...x.records.values()].find(r=>!r.pk.includes('#FLAN#'));assert.equal(root.state,'COMPLETE');assert.equal(root.digest,digest);
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
  {native:{NATURE_ID:122}},{native:{NATURE_COMPANY:31}}]){
  const x=setup(options);assert.equal((await x.run()).statusCode,503);assert.equal(x.calls.reserve,0);assert.equal(x.calls.create,0);assert.equal(x.calls.bankWrite,0);
 }
});
const noDuplicateReads=(x,census=x.calls.create?2:1)=>{assert.equal(x.calls.document,0);assert.equal(x.calls.lookup,0);assert.equal(x.calls.census,census);};

test('os dez tipos PG conferem o ticket sem consultar DOC2 ou RECON antes de submeter ao RM',async()=>{
 const tipos=[{tipoDoPagamento:'NF',tipoDeItem:'Material'},{tipoDoPagamento:'NF',tipoDeItem:'Serviço'},
  {tipoDoPagamento:'TM'},...['A','E','T','G'].map(contasDeConsumo=>({tipoDoPagamento:'CC',contasDeConsumo})),
  {tipoDoPagamento:'OG',outrosGastos:'FR'},...['PF','PJ'].map(tipoDoLocador=>({tipoDoPagamento:'OG',outrosGastos:'AL',tipoDoLocador}))];
 for(const fields of tipos){
  const x=setup({fields}),result=await x.run();
  assert.equal(result.statusCode,200,JSON.stringify(fields));assert.equal(x.calls.create,1);noDuplicateReads(x);
  assert.equal(x.calls.fiscal,codigoMovimento(x.fields)==='1.2.03'?1:0);
 }
});

test('COMPLETE, PG informado ou durável relê ownership sem consultar duplicidade nem criar novamente',async()=>{
 for(const options of [{complete:true},{fields:{idDoMovimento:'9001'}},{durablePg:'9001'}]){
  const x=setup(options);assert.equal((await x.run()).statusCode,200);assert.equal(x.calls.fiscal,0);
  assert.equal(x.calls.create,0);assert.equal(x.calls.bankWrite,0);assert.ok(x.calls.movementRead>0);noDuplicateReads(x);
 }
});

test('material ignora natureza de serviço; serviço sem natureza usa seleção e defaults do RM',async()=>{
 for(const fields of [{tipoDeItem:'Material',idDaNaturezaFiscal:'invalid'},{idDaNaturezaFiscal:'',codigoDaNaturezaFiscal:''}]){
  const x=setup({fields});assert.equal((await x.run()).statusCode,200);assert.equal(x.calls.fiscal,0);
  assert.equal(x.calls.create,1);noDuplicateReads(x);
 }
});

test('PG conhecido de fornecedor, unidade ou ticket diferente nunca recebe vínculo bancário',async()=>{
 for(const change of [{movement:{CODCFO:'OTHER'}},{movement:{CODCOLCFO:'1'}},{movement:{CODFILIAL:'2'}},
  {movement:{CODCOLIGADA:'31'}},{movement:{IDMOV:'9009'}},{movement:{STATUS:'C'}},{compl:{TICKET:'9004'}}]){
  for(const options of [{fields:{idDoMovimento:'9001'}},{complete:true},{durablePg:'9001'}]){
   const x=setup({...change,...options}),result=await x.run();assert.equal(result.statusCode,409);
   assert.equal(x.calls.create,0);assert.equal(x.calls.bankWrite,0);noDuplicateReads(x);
  }
 }
 const x=setup({durablePg:'9001',reservePg:'9009'});assert.equal((await x.run()).statusCode,409);
 assert.equal(x.calls.create,0);assert.equal(x.calls.bankWrite,0);
});

test('falha na leitura do PG conhecido permanece pendente sem nova criação nem vínculo',async()=>{
 for(const options of [{fields:{idDoMovimento:'9001'}},{complete:true},{durablePg:'9001'}]){
  const x=setup({...options,movementReadErrorAt:1});assert.equal((await x.run()).statusCode,503);
  assert.equal(x.calls.create,0);assert.equal(x.calls.bankWrite,0);noDuplicateReads(x);
 }
});

test('a duplicidade é decidida pelo SaveRecord e sua mensagem de negócio é devolvida sem stack',async()=>{
 const mensagem='Já Existe Nota do Emitente com este Número e Série.';
 const x=setup({nativeResult:mensagem+'\r\n=====\r\nat RM.Fixture.SaveRecord'}),result=await x.run();
 assert.equal(result.statusCode,400);assert.equal(parse(result).code,'RM_DUPLICATE_RECORD');
 assert.ok(parse(result).message.includes(mensagem));assert.doesNotMatch(parse(result).message,/at RM|não autoriza nova criação/);
 assert.equal(x.calls.create,1);assert.equal(x.calls.bankWrite,0);assert.equal(x.calls.fiscal,1);noDuplicateReads(x,3);
 assert.equal([...x.records.values()][0].state,'RESERVED');
 assert.equal(JSON.stringify(x.calls.evidences).includes(mensagem),false);
});

test('série de cadastro fica a cargo do RM sem selecionar série alternativa nem consultar DOC2',async()=>{
 for(const serie of ['', '70000']){
  const fields={serie,idDaNaturezaFiscal:'',codigoDaNaturezaFiscal:''},mensagem='Série não cadastrada.';
  const x=setup({fields,nativeResult:mensagem+'\n=====\nat RM.Fixture.Validate'}),snapshot=JSON.stringify(x.fields);
  const result=await x.run();assert.equal(result.statusCode,400);assert.equal(parse(result).code,'RM_UNCLASSIFIED_REJECTION');
  assert.ok(parse(result).message.includes(mensagem));assert.equal(x.calls.createdInput.serie,serie);
  assert.equal(JSON.stringify(x.fields),snapshot);assert.equal(x.calls.create,1);assert.equal(x.calls.bankWrite,0);noDuplicateReads(x);
 }
});

test('timeout do SaveRecord não dispara uma segunda chamada nem expõe dados da exceção',async()=>{
 const erro=Object.assign(Error('PRIVATE_NATIVE_PAYLOAD'),{name:'TimeoutError'});
 const x=setup({createError:erro}),result=await x.run();assert.equal(result.statusCode,503);
 assert.equal(parse(result).code,'COMUNICACAO_NAO_CONFIRMADA');assert.equal(parse(result).efeito,'CRIACAO_NAO_CONFIRMADA');assert.equal(x.calls.create,1);assert.equal(x.calls.bankWrite,0);
 assert.equal(JSON.stringify(result).includes('PRIVATE_NATIVE_PAYLOAD'),false);noDuplicateReads(x);
});

test('rejeição fiscal é decisão nativa e devolve o texto do TOTVS sem stack ou alteração fiscal',async()=>{
 const raw='Movimento 000000018 - Série 1: Natureza inválida.&#xD;Possíveis causas: natureza interestadual em movimentação interna e vice-versa.\n=====\nat RM.Mov.Movimento.MovMovConsistencia.ConsisteIntegracaoFiscal';
 const x=setup({nativeResult:raw}),result=await x.run(),body=parse(result);
 assert.equal(result.statusCode,400);assert.equal(body.code,'RM_INVALID_FISCAL_NATURE');
 assert.match(body.message,/Retorno do TOTVS: Movimento 000000018/);assert.match(body.message,/Natureza inválida/);
 assert.match(body.message,/Possíveis causas: natureza interestadual em movimentação interna/);
 assert.doesNotMatch(body.message,/ConsisteIntegracaoFiscal|não autoriza|2\.949\.01/);
 assert.equal(x.calls.create,1);assert.equal(x.calls.bankWrite,0);noDuplicateReads(x,3);
 assert.equal(JSON.stringify(x.calls.evidences).includes('Natureza inválida'),false);
 assert.equal(x.calls.evidences.find(e=>e.phase==='native_result').diagnostic.reasonCode,'RM_INVALID_FISCAL_NATURE');
});
