const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./load-ts.cjs'),modules=new Map();
const {executarPagamentoSeguro}=load(path.resolve(__dirname,'../src/functions/rm/post/solicitacaoDePagamentoSeguro.ts'),{},modules);
const xml=(name,obj)=>`<${name}>${Object.entries(obj).filter(([,v])=>v!==undefined).map(([k,v])=>`<${k}>${v}</${k}>`).join('')}</${name}>`;
function fixture(options={}){
 const input={tipoDaSolicitacao:'PG',tipoDoPagamento:'NF',tipoDeItem:'Serviço',ticketRaiz:'225374',
  codigoDaColigada2:'1',codigoDaFilial2:'1',codigoDoFornecedor:'fixture225374',idpgto:'1',CODCOLPGTO:'1',
  idDoMovimento:'45178',idDoLancamento:'69912',numeroDaNF:'8',serie:'',dataDeEmissao:'19/10/2026',
  dataDeEntrada:'27/10/2026',dataDeVencimento:'10/11/2026',valorTotal:'10.000,00',codigoDoCentroDeCusto:'1.05.006',
  itens:[{codigoDoItem:'124113',qtdDoItem:'1',valorDoItem:'10.000,00',desconto:'0,00',coligadaDaNatureza:'0',codigoDaNatureza:'02.01.00034'}],
  tributos:[],...options.input};
 const header={CODCOLIGADA:'1',CODFILIAL:'1',IDMOV:'45178',CODCOLCFO:'0',CODCFO:'fixture225374',CODTMV:'1.2.03',STATUS:'F',
  NUMEROMOV:'000000008',SERIE:'1',DATAEMISSAO:'2026-10-19',DATASAIDA:'2026-10-25',VALORBRUTO:'10000.0000',VALORLIQUIDO:'10000.0000',CODCCUSTO:'1.05.006',IDNAT:'3',...options.header};
 const item={IDPRD:'124113',QUANTIDADE:'1.0000',PRECOUNITARIO:'10000.0000',VALORDESC:'0.0000',CODCOLTBORCAMENTO:'0',CODTBORCAMENTO:'02.01.00034',...options.item};
 const complement={CODCOLIGADA:'1',IDMOV:'45178',TICKET:'225374',...options.complement};
 const parcels=options.parcels||[{CODCOLIGADA:'1',IDMOV:'45178',DATAVENCIMENTO:'2026-11-10',VALOR:'10000.0000'}];
 const lans=options.lans||[{CODCOLIGADA:'1',CODFILIAL:'1',IDMOV:'45178',IDLAN:'69912',CODCOLCFO:'0',CODCFO:'fixture225374',
  STATUSLAN:'0',VALORORIGINAL:'10000.0000',DATAVENCIMENTO:'2026-11-10',IDPGTO:'1',CODCOLPGTO:'1',...options.lan}];
 const census=options.census||{movimentos:[{coligada:'1',idMov:'45178'}],lancamentos:lans.map(l=>({coligada:'1',idMov:'45178',idLan:l.IDLAN,boletos:0}))};
 const calls={census:0,read:0,create:0,save:0,repository:0};
 // A stale CREATING/different digest would reject every legacy method. A complete
 // native acknowledgement must not touch that control record at all.
 const repo=new Proxy({}, {get:()=>async()=>{calls.repository++;throw Error('STALE_CREATING_ROOT_WITHOUT_PG');}});
 const rm={async consultarRetomada(){calls.census++;if(options.lookupError)throw Error('unavailable');return census;},
  async readReacord(key,server){calls.read++;if(options.readError)throw Error('read unavailable');
   if(server==='MovMovimentoTBCData')return `<MovMovimento>${xml('TMOV',header)}${xml('TMOVCOMPL',complement)}${xml('TITMMOV',item)}${parcels.map(p=>xml('TMOVPAGTO',p)).join('')}${(options.taxes||[]).map(t=>xml('TTRBITMMOV',t)).join('')}</MovMovimento>`;
   if(server==='FinLanDataBR')return `<FinLAN>${xml('FLAN',lans.find(l=>l.IDLAN===key.split(';')[1]))}</FinLAN>`;
   throw Error('unexpected read');},
  async saveRecord(){calls.save++;throw Error('unexpected write');}};
 const run=()=>executarPagamentoSeguro(input,{getRemainingTimeInMillis:()=>30000},async()=>{calls.create++;throw Error('unexpected creation');},{rm,repositorio:repo});
 return {run,calls,input,census,header,lans};
}
const body=r=>JSON.parse(r.body);
test('225374: reconhece MOV/FLAN existentes sem IDLAN em TMOVPAGTO, preserva data de entrada e ignora reserva obsoleta',async()=>{
 const x=fixture(),before=JSON.stringify(x.input),r=await x.run();
 assert.equal(r.statusCode,200,r.body);assert.deepEqual(body(r),{PG:'45178',LF:'69912',idLans:['69912'],integracaoBancaria:'ja_gravada'});
 assert.equal(x.calls.create+x.calls.save+x.calls.repository,0);assert.equal(x.calls.census,1);assert.equal(x.calls.read,2);assert.equal(JSON.stringify(x.input),before);
 assert.equal((await x.run()).statusCode,200);assert.equal(x.calls.create+x.calls.save+x.calls.repository,0);
});
test('descobre pelo ticket mesmo quando IDs de movimento e lançamento estão vazios no formulário',async()=>{
 const x=fixture({input:{idDoMovimento:'',idDoLancamento:''}});assert.equal((await x.run()).statusCode,200);
 assert.equal(x.calls.create+x.calls.save+x.calls.repository,0);
});
test('sucesso existente pode ser confirmado após baixa, remessa ou desativação posterior do cadastro sem escrever',async()=>{
 for(const STATUSLAN of ['1','3','4']){
  const x=fixture({lan:{STATUSLAN,VALORBAIXADO:'10000.0000',IDBORDERO:'123',CNABSTATUS:'1'}});
  assert.equal((await x.run()).statusCode,200);assert.equal(x.calls.create+x.calls.save+x.calls.repository,0);
 }
});
test('nunca devolve sucesso ou cria outro para fornecedor, ticket, filial, número, valor, série, data ou classificação divergentes',async()=>{
 for(const opts of [
  {header:{CODCFO:'other'}},{header:{CODCOLCFO:'1'}},{header:{CODFILIAL:'2'}},{header:{CODTMV:'1.2.01'}},
  {complement:{TICKET:'another'}},{header:{NUMEROMOV:'9'}},{header:{VALORBRUTO:'9999'}},
  {input:{serie:'2'}},{header:{DATAEMISSAO:'2026-10-20'}},{header:{CODCCUSTO:'other'}},
  {input:{idDaNaturezaFiscal:'4'}},{item:{IDPRD:'999'}},{item:{CODTBORCAMENTO:'other'}},
  {header:{STATUS:'C'}},{lan:{STATUSLAN:'2'}},{lan:{CODCFO:'other'}},{lan:{IDMOV:'999'}},
  {input:{idDoMovimento:'999'}},{input:{idDoLancamento:'999'}},
 ]){
  const x=fixture(opts),r=await x.run();assert.equal(r.statusCode,409,JSON.stringify(opts)+' '+r.body);
  assert.equal(x.calls.create+x.calls.save+x.calls.repository,0);
 }
});
test('erro de consulta, movimento ambíguo ou lançamento ausente jamais é interpretado como ausência para criar',async()=>{
 for(const opts of [{lookupError:true},{readError:true},
  {census:{movimentos:[{coligada:'1',idMov:'45178'},{coligada:'1',idMov:'45179'}],lancamentos:[]}},
  {census:{movimentos:[{coligada:'2',idMov:'45178'}],lancamentos:[]}},
  {census:{movimentos:[{coligada:'1',idMov:'45178'}],lancamentos:[]}},
 ]){
  const x=fixture(opts),r=await x.run();assert.notEqual(r.statusCode,200);assert.equal(x.calls.create+x.calls.save+x.calls.repository,0);
 }
});
test('IDPGTO incompleto ou divergente não é falso sucesso e nunca autoriza nova criação',async()=>{
 for(const lan of [{IDPGTO:undefined},{IDPGTO:'2'},{CODCOLPGTO:'2'}]){
  const x=fixture({lan}),r=await x.run();assert.notEqual(r.statusCode,200);assert.equal(x.calls.create+x.calls.save,0);
 }
});
test('confere todas as parcelas e os códigos bancários antes do sucesso, inclusive quando TMOVPAGTO omite IDs',async()=>{
 const base=fixture().lans[0];
 const parcels=[{CODCOLIGADA:'1',IDMOV:'45178',DATAVENCIMENTO:'2026-11-10',VALOR:'4000'},
  {CODCOLIGADA:'1',IDMOV:'45178',DATAVENCIMENTO:'2026-12-10',VALOR:'6000'}];
 const lans=[{...base,IDLAN:'69912',VALORORIGINAL:'4000'}, {...base,IDLAN:'69913',DATAVENCIMENTO:'2026-12-10',VALORORIGINAL:'6000'}];
 const input={idDoLancamento:'',listaDeParcelas:[{valorDaParcela:'4000',vencimentoDaParcela:'2026-11-10'},
  {valorDaParcela:'6000',vencimentoDaParcela:'2026-12-10'}]};
 const x=fixture({input,parcels,lans}),r=await x.run();assert.equal(r.statusCode,200,r.body);
 assert.deepEqual(body(r).idLans,['69912','69913']);assert.equal(body(r).LF,'');assert.equal(x.calls.create+x.calls.save+x.calls.repository,0);
 const wrong=fixture({input,parcels,lans:[lans[0],{...lans[1],IDPGTO:'2'}]});assert.notEqual((await wrong.run()).statusCode,200);
 assert.equal(wrong.calls.create+wrong.calls.save,0);
});
test('vencimento divergente ou IDLAN de parcela apontando para outro lançamento bloqueia reconhecimento',async()=>{
 for(const opts of [{lan:{DATAVENCIMENTO:'2026-11-11'}},
  {parcels:[{CODCOLIGADA:'1',IDMOV:'45178',IDLAN:'99999',DATAVENCIMENTO:'2026-11-10',VALOR:'10000'}]}]){
  const x=fixture(opts);assert.equal((await x.run()).statusCode,409);assert.equal(x.calls.create+x.calls.save+x.calls.repository,0);
 }
});
test('retenção nativa confirma valor líquido da parcela sem exigir nova criação pelo valor bruto',async()=>{
 const x=fixture({parcels:[{CODCOLIGADA:'1',IDMOV:'45178',DATAVENCIMENTO:'2026-11-10',VALOR:'9850'}],
  lan:{VALORORIGINAL:'9850'},input:{tributos:[{codigoDoTributo:'IRRF',baseDeCalculo:'10000',aliquota:'1,5',valorDaAliquota:'150'}]},
  taxes:[{CODTRB:'IRRF',BASEDECALCULO:'10000',ALIQUOTA:'1.5',VALOR:'150'}]});
 assert.equal((await x.run()).statusCode,200);assert.equal(x.calls.create+x.calls.save+x.calls.repository,0);
});
test('tributo explicitamente diferente do movimento não é reconhecido como sucesso',async()=>{
 const x=fixture({input:{tributos:[{codigoDoTributo:'IRRF',baseDeCalculo:'10000',aliquota:'1,5',valorDaAliquota:'150'}]},
  taxes:[{CODTRB:'IRRF',BASEDECALCULO:'10000',ALIQUOTA:'0',VALOR:'0'}]});
 assert.equal((await x.run()).statusCode,409);assert.equal(x.calls.create+x.calls.save+x.calls.repository,0);
});
