const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const cache=new Map(),load=file=>require('./load-ts.cjs')(path.resolve(__dirname,'../src/functions/rm/post',file),{},cache);
const {prepararEvidencia,validarEvidencia,mensagemDiagnostico}=load('pagamentoEvidencia.ts');
const {diagnosticarRetornoRm}=load('pagamentoDiagnosticoSeguro.ts');
const create=()=>prepararEvidencia('<TMOV>PRIVATE_XML_TOKEN</TMOV>',{
 numeroDaNF:'000114',dataDeEmissao:'22/10/2026',dataDeEntrada:'',valorTotal:'5.273,40',
 chavePIX:'private@example.test',Conta:'PRIVATE_ACCOUNT',informacoes:'PRIVATE_DOCUMENT'},'1.2.01',
 {codColPgto:'9',codColCfo:'0',codCfo:'0000000001',idPgto:6},'2','226455',
 [{vencimento:'2026-11-04',valor:'5273.4',campos:[['IPTE','PRIVATE_BARCODE'],['QRCODEPIX','PRIVATE_QR']]}],
 {numero:'000114',serie:'1',tipoDocumento:'055'});

test('evidência seleciona intenção permitida e hashes sem modificar entrada, XML ou banco',()=>{
 const value=create();assert.doesNotThrow(()=>validarEvidencia(value));assert.equal(value.number,'000114');assert.equal(value.entryDate,'');assert.equal(value.issueDate,'2026-10-22');
 const output=JSON.stringify(value);for(const secret of ['PRIVATE_XML_TOKEN','private@example.test','PRIVATE_ACCOUNT','PRIVATE_DOCUMENT','PRIVATE_BARCODE','PRIVATE_QR','<TMOV>'])assert.equal(output.includes(secret),false);
 assert.match(value.xmlSha256,/^[a-f0-9]{64}$/);assert.match(value.installments[0].destinationSha256,/^[a-f0-9]{64}$/);
});
test('fronteira de persistência rejeita campos inesperados, valores pessoais em campos permitidos e diagnóstico bruto',()=>{
 for(const mutate of [e=>e.rawXml='PRIVATE',e=>e.company={private:'PRIVATE'},e=>e.ticket='private@example.test',
  e=>e.number='114;PRIVATE',e=>e.installments[0].barcode='PRIVATE',e=>e.installments[0].destinationSha256='PRIVATE',
  e=>e.phase='native_result',e=>e.diagnostic={rawResponse:'PRIVATE'}]){
  const e=create();mutate(e);assert.throws(()=>validarEvidencia(e),/Evidência sanitizada inválida/);
 }
 const e={...create(),phase:'native_result',diagnostic:diagnosticarRetornoRm('Campo IDNAT não foi informado PRIVATE =====')};
 assert.doesNotThrow(()=>validarEvidencia(e));assert.equal(JSON.stringify(e).includes('PRIVATE'),false);
 for(const change of [{reasonCode:'PRIVATE'},{mentionedFields:['PRIVATE']},{nativeErrorTypes:['PRIVATE']},{rawResponse:'PRIVATE'}]){
  assert.throws(()=>validarEvidencia({...e,diagnostic:{...e.diagnostic,...change}}));
 }
});
test('mensagem informa diagnóstico nativo sem proibir novo envio ou declarar sucesso',()=>{
 for(const code of ['RM_DUPLICATE_RECORD','RM_REQUIRED_FIELD','RM_PERIOD_CLOSED','RM_INVALID_DATE','PRIVATE_UNKNOWN']){
  const message=mensagemDiagnostico(code);assert.doesNotMatch(message,/não autoriza uma nova criação|conferirá um movimento existente/);assert.equal(message.includes('PRIVATE'),false);
 }
 assert.equal(mensagemDiagnostico('RM_UNCLASSIFIED_REJECTION','Série não permitida para este movimento.'),
  'O TOTVS retornou: Série não permitida para este movimento.');
});

test('natureza inválida tem mensagem fixa e evidência aceita a categoria sem armazenar resposta nativa',()=>{
 const raw='Movimento 000000018 - Série 1: Natureza inválida.&#xD;=====\nat RM.Mov.Movimento.MovMovConsistencia.ConsisteIntegracaoFiscal';
 const diagnostic=diagnosticarRetornoRm(raw),evidence={...create(),phase:'native_result',diagnostic};
 assert.equal(diagnostic.reasonCode,'RM_INVALID_FISCAL_NATURE');assert.doesNotThrow(()=>validarEvidencia(evidence));
 const message=mensagemDiagnostico(diagnostic.reasonCode);
 assert.match(message,/TOTVS rejeitou a natureza fiscal/);assert.match(message,/tarefa Fiscal/);
 for(const value of ['000000018','ConsisteIntegracaoFiscal','2.949.01']){
  assert.equal(message.includes(value),false);assert.equal(JSON.stringify(evidence).includes(value),false);
 }
 assert.doesNotMatch(message,/não autoriza|conferirá um movimento existente/);
});
