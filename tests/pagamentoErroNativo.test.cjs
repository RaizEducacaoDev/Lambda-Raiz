const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=require('./load-ts.cjs'),cache=new Map();
const native=load(path.resolve(__dirname,'../src/functions/rm/post/pagamentoErroNativo.ts'),{},cache);
const {respostaErroPagamento}=load(path.resolve(__dirname,'../src/functions/rm/post/pagamentoResposta.ts'),{},cache);

test('retorno nativo desconhecido conserva item, código longo, unicode substituído e motivo, sem stack na apresentação',()=>{
 const text='Item 0 - Produto 9.99.999999-ITEM FICTICIO do Movimento 000123456-S�rie 7: Produto n�o permitido para o tipo de movimento.\n=====\nat RM.Fixture.SaveRecord';
 const error=new native.ErroNativoRm(text,'RM_UNCLASSIFIED_REJECTION',400);
 const r=respostaErroPagamento({erro:error,etapa:'criacao_movimento',criacaoIncerta:true});
 assert.equal(r.status,400);assert.equal(r.body.origem,'TOTVS');assert.equal(r.body.message,r.body.error);
 for(const value of ['9.99.999999','ITEM FICTICIO','000123456','S�rie 7','Produto n�o permitido'])assert.ok(r.body.message.includes(value),value);
 assert.ok(!r.body.message.includes('at RM.'));assert.ok(error.diagnosticoNativo.includes('at RM.Fixture'));
 assert.equal(native.mensagemNegocioRm('at RM.Fixture.SaveRecord'),undefined);
 assert.equal(native.mensagemNegocioRm('At least one item is required.'),'At least one item is required.');
});

test('redação remove valores sensíveis sem eliminar causa, nomes SQL e identificadores operacionais',()=>{
 const text='Produto 12345678901 não permitido em TMOV.IDPRD.\nSenha: passwordFixture; token=tokenFixture; Authorization: Bearer bearerFixture\n'+
  'CPF: 12345678909; CNPJ: 12345678000199; conta: 1234-5; agência: 4321; email private@example.test\n'+
  'ConnectionString=Server=host;Database=db;User Id=userFixture;Password=connectionFixture\n'+
  '<password>xmlFixture</password>\n<script>alert(1)</script>';
 const clean=native.sanitizarTextoErroRm(text);
 for(const value of ['passwordFixture','tokenFixture','bearerFixture','12345678909','12345678000199','1234-5','4321','private@example.test','userFixture','connectionFixture','xmlFixture','<script>','alert(1)'])assert.ok(!clean.includes(value),value);
 assert.ok(clean.includes('Produto 12345678901 não permitido em TMOV.IDPRD.'));assert.ok(clean.includes('[OCULTO]'));
 assert.equal(native.mensagemNegocioRm('Conta bancária indisponível.'),'Conta bancária indisponível.');
});

test('senha configurada e sua credencial Basic são retiradas mesmo quando retorno não tem rótulo',()=>{
 const oldUser=process.env.USERNAME_TOTVS,oldPassword=process.env.PASSWORD_TOTVS;
 try{
  process.env.USERNAME_TOTVS='fixtureUser';process.env.PASSWORD_TOTVS='fixturePassword';
  const token=Buffer.from('fixtureUser:fixturePassword').toString('base64');
  const clean=native.sanitizarTextoErroRm(`Erro para produto 987654321: fixturePassword ${token}`);
  assert.ok(!clean.includes('fixturePassword'));assert.ok(!clean.includes(token));assert.ok(clean.includes('produto 987654321'));
 }finally{
  if(oldUser===undefined)delete process.env.USERNAME_TOTVS;else process.env.USERNAME_TOTVS=oldUser;
  if(oldPassword===undefined)delete process.env.PASSWORD_TOTVS;else process.env.PASSWORD_TOTVS=oldPassword;
 }
});

test('corpos HTTP SOAP e JSON preservam mensagens, sem serializar config/headers ou datasets financeiros',()=>{
 const soap='<s:Envelope xmlns:s="soap"><s:Body><s:Fault><faultcode>s:Server</faultcode><faultstring>O campo IDPRD não foi informado.</faultstring></s:Fault></s:Body></s:Envelope>';
 for(const data of [soap,{Message:'O campo IDPRD não foi informado.',ExceptionMessage:'Confira o cadastro do item.',config:{password:'neverSerialize'}}]){
  const error=native.erroHttpRm({response:{status:500,data},config:{headers:{Authorization:'neverSerialize'}}});
  assert.ok(error instanceof native.ErroNativoRm);assert.ok(error.mensagemNativa.includes('IDPRD'));
  assert.ok(!JSON.stringify(error).includes('neverSerialize'));
 }
 assert.equal(native.extrairTextoErroRm('<DataSet><FLAN><NOME>PRIVATE_PERSON</NOME><VALORORIGINAL>1</VALORORIGINAL></FLAN></DataSet>'),undefined);
 assert.equal(native.erroHttpRm({code:'ETIMEDOUT',message:'secretLocalError'}),undefined);
 assert.equal(native.extrairTextoErroRm({config:{message:'neverSerialize'},headers:{message:'neverSerialize'}}),undefined);
});

test('limites são explícitos e a mensagem não perde o diagnóstico por superar300 caracteres',()=>{
 const text='Erro nativo de referência. '+ 'Confira o parâmetro do item. '.repeat(40);
 const message=native.mensagemNegocioRm(text);assert.ok(message.length>300);assert.equal(message.trim(),text.trim());
 assert.ok(native.sanitizarTextoErroRm('x'.repeat(17000)).endsWith('[retorno truncado]'));
});

test('erro bancário nativo mantém o motivo após o prefixo de movimento confirmado',()=>{
 const r=respostaErroPagamento({erro:new native.ErroNativoRm('A filial do lançamento difere da filial dos dados bancários.\n=====\nat RM.Fixture','RM_UNCLASSIFIED_REJECTION',400),
  etapa:'gravacao_vinculo',criacaoIncerta:false,pgConfirmado:'9001'});
 assert.equal(r.status,400);assert.equal(r.body.PG,'9001');assert.equal(r.body.efeito,'MOVIMENTO_CONFIRMADO');
 assert.match(r.body.message,/movimento 9001 já está gravado/);assert.match(r.body.message,/filial do lançamento difere/);
});
test('XML financeiro embutido é retirado da mensagem/log sem eliminar o erro ao redor',()=>{
 const xml='<DataSet><FLAN><HISTORICO>CONTEUDO_FINANCEIRO_SINTETICO</HISTORICO><CODIGOBARRA>12345678901234567890123456789012345678901234</CODIGOBARRA></FLAN></DataSet>';
 for(const body of [xml,xml.replaceAll('<','&lt;').replaceAll('>','&gt;'),xml.replaceAll('<','&amp;lt;').replaceAll('>','&amp;gt;')]){
  const error=native.erroHttpRm({response:{status:500,data:{Message:'Falha no XML: '+body+' Confira o item.'}}});
  const r=respostaErroPagamento({erro:error,etapa:'gravacao_vinculo',criacaoIncerta:false,pgConfirmado:'9001'});
  const combined=JSON.stringify([error,r]);
  assert.ok(r.body.message.includes('Falha no XML:'));assert.ok(r.body.message.includes('Confira o item.'));
  for(const value of ['CONTEUDO_FINANCEIRO_SINTETICO','12345678901234567890123456789012345678901234','HISTORICO','CODIGOBARRA'])assert.ok(!combined.includes(value),value);
  assert.ok(error.diagnosticoNativo.includes('[XML FINANCEIRO OCULTO]'));
 }
});
test('DOCTYPE HTML é texto inerte com causa preservada e DTD de XML continua recusado',()=>{
 const html='<!DOCTYPE html><html><body>Falha ao validar a série.<script>privateScript()</script></body></html>';
 const error=native.erroHttpRm({response:{status:500,data:html}});
 assert.equal(error.mensagemNativa,'Falha ao validar a série.');assert.ok(!error.diagnosticoNativo.includes('privateScript'));
 assert.equal(native.extrairTextoErroRm('<!DOCTYPE erro [<!ENTITY private SYSTEM "http://private.invalid">]><erro>&private;</erro>'),undefined);
 const financial='<!DOCTYPE html><html><body>Falha. <DataSet><FLAN><HISTORICO>PRIVATE_FINANCIAL</HISTORICO></FLAN></DataSet></body></html>';
 assert.ok(!native.erroHttpRm({response:{status:500,data:financial}}).diagnosticoNativo.includes('PRIVATE_FINANCIAL'));
});
test('redação de cookie e conexão entre aspas conserva o motivo nativo depois do valor',()=>{
 for(const quote of ['"',"'"]){
  for(const text of [
   `Cookie: ${quote}sid=SEGREDO_SINTETICO${quote}; Produto não permitido para este tipo de movimento.`,
   `ConnectionString=${quote}Server=localhost;Password=SENHA_SINTETICA${quote}; O campo IDPRD é obrigatório.`,
  ]){
   const safe=native.sanitizarTextoErroRm(text);
   assert.ok(!safe.includes('SEGREDO_SINTETICO'));assert.ok(!safe.includes('SENHA_SINTETICA'));
   assert.match(safe,/Produto não permitido|campo IDPRD é obrigatório/);assert.ok(safe.includes('[OCULTO]'));
  }
 }
 const plain=native.sanitizarTextoErroRm('Cookie: sid=SECRET; other=SECOND_SECRET; Produto não permitido.');
 assert.ok(!plain.includes('SECRET'));assert.ok(plain.includes('Produto não permitido.'));
});
