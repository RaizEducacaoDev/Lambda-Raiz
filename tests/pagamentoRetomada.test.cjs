const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./load-ts.cjs');
const {parsearCensoRetomada,validarCriacaoEncontrada}=load(path.resolve('src/functions/rm/post/pagamentoRetomada.ts'));
const {validarDocumentoExistente,validarDocumento}=load(path.resolve('src/functions/rm/post/pagamentoDocumento.ts'));
const docFixture=require('./documento-fixture.cjs');
const meta={RETOMADA_VERSION:1,REQUEST_COMPANY:8,REQUEST_TICKET:'9003',TOTAL_MOVEMENTS:1,TOTAL_LAUNCHES:2};
const rows=[{...meta,ROW_KIND:'MOV',CODCOLIGADA:8,IDMOV:9001},
  ...['9002','9004'].map(IDLAN=>({...meta,ROW_KIND:'LAN',CODCOLIGADA:8,IDMOV:9001,IDLAN,BOLETO_COUNT:0}))];
const xml=(t,o)=>`<${t}>${Object.entries(o).map(([k,v])=>`<${k}>${v}</${k}>`).join('')}</${t}>`;
const e={coligada:'8',filial:'4',fornecedor:'0000000001',coligadaFornecedor:'0',ticket:'9003',idMov:'9001',tipo:'1.2.03',
 numero:'114',serie:'1',tipoDocumento:'002',emissao:'2026-10-22',entrada:'2026-10-27',valor:'100,00',
 planos:[{vencimento:'2026-11-10',valor:'50.0',campos:[]},{vencimento:'2026-12-10',valor:'50.0',campos:[]}]};
const mov={CODCOLIGADA:'8',CODFILIAL:'4',IDMOV:'9001',CODTMV:'1.2.03',CODCOLCFO:'0',CODCFO:e.fornecedor,STATUS:'F',
 NUMEROMOV:'000000114',SERIE:'1',CODTDO:'002',DATAEMISSAO:'2026-10-22T00:00:00',DATASAIDA:'2026-10-27T00:00:00',VALORBRUTO:'100.0000',VALORLIQUIDO:'100.0000'};
const payments=['9002','9004'].map((IDLAN,i)=>({CODCOLIGADA:'8',IDMOV:'9001',IDLAN,DATAVENCIMENTO:e.planos[i].vencimento,VALOR:'50.0000'}));
const lans=payments.map(p=>({CODCOLIGADA:'8',CODFILIAL:'4',IDMOV:'9001',IDLAN:p.IDLAN,CODCOLCFO:'0',CODCFO:e.fornecedor,
 STATUSLAN:'0',VALORBAIXADO:'0.0000',BAIXAPENDENTE:'0',DATAVENCIMENTO:p.DATAVENCIMENTO,VALORORIGINAL:'50.0000'}));
const movement=(m={},ps=payments)=>`<Dataset>${xml('TMOV',{...mov,...m})}${xml('TMOVCOMPL',{CODCOLIGADA:'8',IDMOV:'9001',TICKET:'9003'})}${ps.map(p=>xml('TMOVPAGTO',p)).join('')}</Dataset>`;
const financial=(values=lans)=>values.map(v=>`<Dataset>${xml('FLAN',v)}</Dataset>`);

test('censo exige metadados e contagem completa de MOV e todas parcelas; vazio explícito não é rollback',()=>{
 const c=parsearCensoRetomada(rows,'8','9003');assert.equal(c.movimentos.length,1);assert.equal(c.lancamentos.length,2);
 const empty=parsearCensoRetomada([{...meta,TOTAL_MOVEMENTS:0,TOTAL_LAUNCHES:0,ROW_KIND:'EMPTY'}],'8','9003');
 assert.deepEqual(empty,{movimentos:[],lancamentos:[]});
 for(const bad of [[],{},rows.slice(0,2),[...rows,rows[1]],rows.map(r=>({...r,REQUEST_TICKET:'9004'})),
   rows.map(r=>({...r,REQUEST_COMPANY:9})),rows.map(r=>({...r,UNEXPECTED:'private'})),
   [{...meta,TOTAL_MOVEMENTS:0,TOTAL_LAUNCHES:0,ROW_KIND:'EMPTY',IDLAN:9002}],
   rows.map((r,i)=>i===2?{...r,IDMOV:9999}:r),rows.map((r,i)=>i===0?{...r,TOTAL_LAUNCHES:1}:r)]){
  assert.throws(()=>parsearCensoRetomada(bad,'8','9003'));
 }
});
test('censo preserva movimentos de outra coligada em vez de filtrá-los como zero',()=>{
 const other=rows.map(r=>({...r,CODCOLIGADA:9})), c=parsearCensoRetomada(other,'8','9003');
 assert.equal(c.movimentos[0].coligada,'9');assert.throws(()=>validarCriacaoEncontrada(c,movement(),financial(),e));
});
test('recuperação exige cabeçalho e todas parcelas abertas e exatas, inclusive IDLAN da segunda parcela',()=>{
 const c=parsearCensoRetomada(rows,'8','9003');assert.doesNotThrow(()=>validarCriacaoEncontrada(c,movement(),financial(),e));
 for(const change of [{SERIE:'2'},{CODTDO:'054'},{NUMEROMOV:'115'},{CODCFO:'other'},{CODFILIAL:'9'},{STATUS:'C'},
   {DATAEMISSAO:'2025-10-22'},{DATASAIDA:'2026-10-28'},{VALORBRUTO:'200'},{VALORLIQUIDO:'99'}]){
   assert.throws(()=>validarCriacaoEncontrada(c,movement(change),financial(),e));
 }
 for(const change of [{STATUSLAN:'1'},{VALORBAIXADO:'1'},{BAIXAPENDENTE:'1'},{IDBOLETO:'99'},
   {IDLAN:'another'},{CODCFO:'other'},{DATAVENCIMENTO:'2026-12-11'},{VALORORIGINAL:'49'}]){
   assert.throws(()=>validarCriacaoEncontrada(c,movement(),financial([lans[0],{...lans[1],...change}]),e));
 }
 assert.throws(()=>validarCriacaoEncontrada(c,movement(),financial([lans[0]]),e));
 assert.throws(()=>validarCriacaoEncontrada({...c,lancamentos:c.lancamentos.map(f=>({...f,boletos:1}))},movement(),financial(),e));
});
test('consulta documental para adoção só aceita o único IDMOV do próprio ticket; não autoriza nova criação',()=>{
 const key={codColigada:'8',codFilial:'4',codColCfo:'0',codCfo:e.fornecedor,codTmv:'1.2.03',numero:'114',serie:''};
 const row=docFixture(key,{DOC_MATCH_COUNT:1,CODCOLIGADA:8,CODFILIAL:4,IDMOV:9001,CODCOLCFO:0,CODCFO:e.fornecedor,
 CODCOLCFOAUX:0,CODCFOAUX:e.fornecedor,CODTMV:'1.2.03',SERIE:'1',NUMEROMOV:'000000114',CODTDO:'002',TICKET:'9003'});
 assert.equal(validarDocumentoExistente([row],key,'9001','9003').serie,'1');
 assert.throws(()=>validarDocumento([row],key));
 for(const change of [{TICKET:'old'},{IDMOV:9002},{CODTMV:'2.2.26'}])assert.throws(()=>validarDocumentoExistente([{...row,...change}],key,'9001','9003'));
 assert.throws(()=>validarDocumentoExistente([docFixture(key)],key,'9001','9003'));
});

test('entrada omitida aceita somente uma data nativa válida, preserva o default e mantém comparação estrita quando informada',()=>{
 const c=parsearCensoRetomada(rows,'8','9003'),before=JSON.stringify(mov),expected={...e,entrada:''};
 assert.doesNotThrow(()=>validarCriacaoEncontrada(c,movement(),financial(),expected));
 assert.equal(JSON.stringify(mov),before);assert.equal(expected.entrada,'');
 for(const DATASAIDA of ['', '2026-02-31', 'private'])assert.throws(()=>validarCriacaoEncontrada(c,movement({DATASAIDA}),financial(),expected));
 assert.throws(()=>validarCriacaoEncontrada(c,movement({DATASAIDA:'2026-10-28'}),financial(),e));
 assert.throws(()=>validarCriacaoEncontrada(c,movement({DATAEMISSAO:'2026-10-28'}),financial(),expected));
});

test('recuperação NULL de DOC2 exige ausência/vazio ReadRecord e recusa o tipo financeiro não nulo',()=>{
 const c=parsearCensoRetomada(rows,'8','9003'),expected={...e,tipoDocumento:''};
 assert.doesNotThrow(()=>validarCriacaoEncontrada(c,movement({CODTDO:''}),financial(),expected));
 assert.doesNotThrow(()=>validarCriacaoEncontrada(c,movement().replace('<CODTDO>002</CODTDO>',''),financial(),expected));
 assert.throws(()=>validarCriacaoEncontrada(c,movement(),financial(),expected));
});
