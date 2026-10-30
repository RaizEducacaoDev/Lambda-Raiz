const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const modules=new Map(),load=file=>require('./load-ts.cjs')(path.resolve(__dirname,'../src/functions/rm/post',file),{},modules);
const {NaturezaFiscalInvalida,prepararContextoFiscal,validarContextoFiscal}=load('pagamentoFiscal.ts');
const {PagamentoInvalido}=load('pagamentoIdentidade.ts');
const expected={codColigada:'11',codFilial:'1',codColCfo:'0',codCfo:'0000000001',idNat:'121',codigoNatureza:'1.949.01'};
const native=changes=>({FISCAL_VERSION:1,REQUEST_COMPANY:11,REQUEST_BRANCH:1,REQUEST_SUPPLIER_COMPANY:0,
 REQUEST_SUPPLIER:'0000000001',REQUEST_NATURE:121,HAS_SUPPLIER:1,HAS_BRANCH:1,HAS_NATURE:1,
 NATURE_COMPANY:11,NATURE_ID:121,NATURE_CODE:'1.949.01',NATURE_ACTIVE:1,NATURE_ROUTE:'D',
 SUPPLIER_UF:'RJ',SUPPLIER_COUNTRY_ID:1,BRANCH_UF:'RS',BRANCH_COUNTRY_ID:1,...changes});

test('natureza interna RJ/RS recebe422 tipado com UFs e instrução fiscal, sem escolher alternativa',()=>{
 assert.throws(()=>validarContextoFiscal([native()],expected),error=>{
  assert.ok(error instanceof PagamentoInvalido);assert.ok(error instanceof NaturezaFiscalInvalida);
  assert.equal(error.code,'NATUREZA_FISCAL_INCOMPATIVEL');assert.match(error.message,/RJ.*RS/);assert.match(error.message,/tarefa Fiscal/);
  assert.equal(error.message.includes('166'),false);return true;
 });
});
test('rotas D/RJ_RJ e F/RJ_RS são válidas; F/RJ_RJ é incompatível',()=>{
 assert.doesNotThrow(()=>validarContextoFiscal([native({BRANCH_UF:'RJ'})],expected));
 assert.doesNotThrow(()=>validarContextoFiscal([native({NATURE_ROUTE:'F',NATURE_CODE:'2.949.01'})],{...expected,codigoNatureza:'2.949.01'}));
 assert.throws(()=>validarContextoFiscal([native({NATURE_ROUTE:'F',NATURE_CODE:'2.949.01',BRANCH_UF:'RJ'})],{...expected,codigoNatureza:'2.949.01'}),NaturezaFiscalInvalida);
});
test('cadastro ausente, natureza inativa ou código divergente são inválidos, sem inferirCFOP',()=>{
 for(const changes of [{HAS_SUPPLIER:0},{HAS_BRANCH:0},{HAS_NATURE:0},{NATURE_ACTIVE:0},{NATURE_CODE:'2.949.01'}]){
  assert.throws(()=>validarContextoFiscal([native(changes)],expected),NaturezaFiscalInvalida);
 }
});
test('contrato incompleto/corrompido, eco divergente e resposta ambígua falham como indisponíveis',()=>{
 const missing=native();delete missing.SUPPLIER_COUNTRY_ID;
 const missingUf=native();delete missingUf.SUPPLIER_UF;
 const missingNature=native();delete missingNature.NATURE_ROUTE;
 for(const data of [[],[native(),native()],{},null,[missing],[missingUf],[missingNature],
  ...[{FISCAL_VERSION:2},{FISCAL_VERSION:'01'},{REQUEST_COMPANY:31},{REQUEST_BRANCH:2},{REQUEST_SUPPLIER_COMPANY:1},{REQUEST_SUPPLIER:'PRIVATE_OTHER'},
   {REQUEST_NATURE:122},{NATURE_COMPANY:31},{NATURE_ID:122},{NATURE_ACTIVE:2},{HAS_BRANCH:true},{HAS_BRANCH:'01'},{SUPPLIER_UF:'XX'},
   {BRANCH_COUNTRY_ID:0},{NATURE_CODE:null},{NATURE_ROUTE:null}].map(changes=>[native(changes)])]){
  assert.throws(()=>validarContextoFiscal(data,expected),error=>{assert.ok(error instanceof Error);assert.equal(error instanceof NaturezaFiscalInvalida,false);assert.equal(error.message.includes('PRIVATE'),false);return true;});
 }
});
test('globalCFO0 é preservado; outros países/rotas permanecem sob controle nativo',()=>{
 assert.doesNotThrow(()=>validarContextoFiscal([native({REQUEST_SUPPLIER_COMPANY:'0',BRANCH_UF:'RJ'})],expected));
 assert.doesNotThrow(()=>validarContextoFiscal([native({SUPPLIER_COUNTRY_ID:2,SUPPLIER_UF:null})],expected));
 assert.doesNotThrow(()=>validarContextoFiscal([native({NATURE_ROUTE:'X'})],expected));
});
test('preparação valida ID informado sem alterar entrada e permite ausência de ambos campos',()=>{
 const base={codColigada:'11',codFilial:'1',codColCfo:'0',codCfo:'0000000001'};
 assert.equal(prepararContextoFiscal({},base),undefined);
 for(const input of [{codigoDaNaturezaFiscal:'1.949.01'},{idDaNaturezaFiscal:'0'},{idDaNaturezaFiscal:'-1'},
  {idDaNaturezaFiscal:'invalid'},{idDaNaturezaFiscal:'9007199254740992'}])assert.throws(()=>prepararContextoFiscal(input,base),NaturezaFiscalInvalida);
 const input={idDaNaturezaFiscal:'121',codigoDaNaturezaFiscal:'1.949.01'},snapshot=JSON.stringify(input);
 assert.deepEqual(prepararContextoFiscal(input,base),expected);assert.equal(JSON.stringify(input),snapshot);
});
