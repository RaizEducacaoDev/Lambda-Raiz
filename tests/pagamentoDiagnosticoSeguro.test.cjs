const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {diagnosticarRetornoRm,tipoErroSeguro,resumirMensagemNegocioRm}=require('./load-ts.cjs')(path.resolve(__dirname,'../src/functions/rm/post/pagamentoDiagnosticoSeguro.ts'));

test('diagnóstico multilinha só emite allowlist, sem XML, banco, documento, nome, email ou headers',()=>{
 const sensitive=['private@example.test','123.456.789-09','ACCOUNT_918273645','PRIVATE_HOLDER_NAME','Bearer_PRIVATE_TOKEN','XML_PRIVATE_VALUE'];
 const result=`O campo CODTRB é obrigatório.\r\nFornecedor ${sensitive[3]} documento ${sensitive[1]}\nEmail ${sensitive[0]}, conta ${sensitive[2]}\rAuthorization: ${sensitive[4]}\n<CHAVE>${sensitive[5]}</CHAVE>\n=====\nat RM.Fixture System.Data.SqlClient.SqlException`;
 const diagnostic=diagnosticarRetornoRm(result),serialized=JSON.stringify(diagnostic);
 assert.equal(diagnostic.reasonCode,'RM_REQUIRED_FIELD');assert.equal(diagnostic.reasonSource,'allowlist_v1');
 assert.deepEqual(diagnostic.mentionedFields,['CODTRB']);assert.deepEqual(diagnostic.nativeErrorTypes,['SqlException']);
 assert.equal(diagnostic.lineCount,7);assert.equal(diagnostic.length,result.length);
 assert.equal(diagnostic.responseSha256,createHash('sha256').update(result).digest('hex'));
 for(const value of sensitive){assert.equal(serialized.includes(value),false);assert.equal(serialized.includes(value.toUpperCase()),false);}
 assert.equal(serialized.includes('<CHAVE>'),false);assert.equal(serialized.includes('Authorization'),false);
 assert.deepEqual(Object.keys(diagnostic).sort(),['category','reasonCode','reasonSource','responseSha256','length','lineCount','mentionedFields','nativeErrorTypes'].sort());
});

test('padrões classificados são categorias fixas, sem copiar constraint, coluna arbitrária ou mensagem',()=>{
 const cases=[
  ['The INSERT statement conflicted with the FOREIGN KEY constraint FK_PRIVATE_VALUE. Campo IDNAT.','RM_INVALID_REFERENCE'],
  ['Violation of UNIQUE KEY. Duplicate key ACCOUNT_PRIVATE.','RM_DUPLICATE_RECORD'],
  ['Campo SERIE não foi informado.','RM_REQUIRED_FIELD'],
  ['Período contábil fechado para lançamento.','RM_PERIOD_CLOSED'],
  ['Usuário não possui permissão de acesso.','RM_PERMISSION_DENIED'],
  ['Data de emissão inválida.','RM_INVALID_DATE'],
  ['Input string was not in a correct format.','RM_INVALID_FORMAT'],
  ['System.Data.SqlClient.SqlException: PRIVATE_VALUE.','RM_SQL_EXCEPTION'],
 ];
 for(const [raw,reason]of cases){const result=diagnosticarRetornoRm(raw);assert.equal(result.reasonCode,reason,reason);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);}
});

test('rejeição de número e série documentada pela TOTVS é classificada como duplicidade',()=>{
 // Primary source: TOTVS article115008352887 (TXMOVCFX). This is a documented
 // fixture, not the discarded historical response from ticket226374.
 const raw='Já Existe Nota do Emitente com este Número e Série. Verifique os parâmetros numeração desta série.\r\n=====\r\nat RM.Mov.Fixture.SaveRecord';
 const result=diagnosticarRetornoRm(raw);
 assert.equal(result.reasonCode,'RM_DUPLICATE_RECORD');
 assert.equal(result.category,'rm_rejection_or_diagnostic');
 assert.deepEqual(result.mentionedFields,['SERIE']);
});

test('marcador documentado aceita acentos, caixa e quebras de linha sem ampliar para qualquer menção de série',()=>{
 for(const phrase of ['Já Existe Nota do Emitente com este Número e Série.',
  'ja existe nota do emitente com este numero e serie',
  'Já\r\nExiste\tNota do Emitente com este\nNúmero e\rSérie.']){
  assert.equal(diagnosticarRetornoRm(phrase+'\n=====\nat RM.Fixture').reasonCode,'RM_DUPLICATE_RECORD');
 }
 for(const phrase of ['Série não cadastrada.', 'Série inválida.', 'Já existe cadastro bancário para este fornecedor.',
  'Nota do emitente com número e série deve ser informada.', 'Não existe nota do emitente com este número e série.',
  'Já existe nota do emitente com este número e SerieExtra.']){
  assert.equal(diagnosticarRetornoRm(phrase+'\n=====\nat RM.Fixture').reasonCode,'RM_UNCLASSIFIED_REJECTION',phrase);
 }
});

test('1389 caracteres,14 linhas e SERIE não identificam a mensagem histórica; diagnóstico não copia valores sensíveis',()=>{
 const sensitive=['PRIVATE_HOLDER','PRIVATE_DOCUMENT','private@example.test','ACCOUNT_PRIVATE','PRIVATE_PIX','Bearer_PRIVATE_TOKEN'];
 const lines=['Já Existe Nota do Emitente com este Número e Série.',
  'Verifique os parâmetros numeração desta série.',
  ...sensitive.slice(0,4),'<CHAVE>'+sensitive[4]+'</CHAVE>','Authorization: '+sensitive[5],
  '=====','at RM.Fixture.SaveRecord','at RM.Fixture.Process','at RM.Fixture.Validate',
  'at RM.Fixture.Commit','at RM.Fixture.Execute'];
 const raw=lines.join('\r\n').padEnd(1389,'x');
 const result=diagnosticarRetornoRm(raw);
 assert.equal(result.length,1389);assert.equal(result.lineCount,14);
 assert.equal(result.reasonCode,'RM_DUPLICATE_RECORD');assert.deepEqual(result.mentionedFields,['SERIE']);
 assert.equal(result.responseSha256,createHash('sha256').update(raw).digest('hex'));
 for(const value of sensitive)assert.equal(JSON.stringify(result).includes(value),false);
 const other=diagnosticarRetornoRm(['Série não cadastrada.',...lines.slice(1)].join('\r\n').padEnd(1389,'x'));
 assert.deepEqual([other.length,other.lineCount,other.mentionedFields],[result.length,result.lineCount,result.mentionedFields]);
 assert.equal(other.reasonCode,'RM_UNCLASSIFIED_REJECTION');assert.notEqual(other.responseSha256,result.responseSha256);
 assert.deepEqual(Object.keys(result).sort(),['category','reasonCode','reasonSource','responseSha256','length','lineCount','mentionedFields','nativeErrorTypes'].sort());
 assert.equal(result.reasonSource,'allowlist_v1');
});

test('resposta1586chars preserva impressão digital estável e motivo desconhecido permanece explícito',()=>{
 const raw='Diagnóstico específico PRIVATE_NATIVE_MESSAGE\r\n=====\nat RM.Fixture'.padEnd(1586,'x');
 const result=diagnosticarRetornoRm(raw);assert.equal(result.length,1586);assert.equal(result.reasonCode,'RM_UNCLASSIFIED_REJECTION');
 assert.match(result.responseSha256,/^[a-f0-9]{64}$/);assert.deepEqual(result,diagnosticarRetornoRm(raw));
 assert.notEqual(result.responseSha256,diagnosticarRetornoRm(raw+' ').responseSha256);
 assert.equal(JSON.stringify(result).includes('PRIVATE_NATIVE_MESSAGE'),false);
});

test('chave de outra coligada e resultado inesperado têm códigos fixos sem liberar criação',()=>{
 assert.equal(diagnosticarRetornoRm('99;9001',true).reasonCode,'RM_PRIMARY_KEY_COMPANY_MISMATCH');
 const raw='PRIVATE_NATIVE_RESPONSE';assert.equal(diagnosticarRetornoRm(raw).reasonCode,'RM_UNEXPECTED_RESULT');
 assert.equal(JSON.stringify(diagnosticarRetornoRm(raw)).includes(raw),false);
});

test('nome de exceção arbitrário nunca é refletido no diagnóstico seguro',()=>{
 const error=Object.assign(Error('PRIVATE_MESSAGE'),{name:'PRIVATE_ACCOUNT_OR_PERSON'});
 assert.equal(tipoErroSeguro(error),'UnknownError');assert.equal(tipoErroSeguro({name:'TimeoutError'}),'UnknownError');
 assert.equal(tipoErroSeguro(Object.assign(Error('PRIVATE_MESSAGE'),{name:'TimeoutError'})),'TimeoutError');
});

test('mensagem de negócio mantém primeira linha de série ou duplicidade sem stack ou outras linhas',()=>{
 for(const frase of ['Série não cadastrada.', 'A série informada não está vinculada ao tipo de movimento.',
  'Já Existe Nota do Emitente com este Número e Série.', 'O campo SERIE é obrigatório.',
  'Série 1 inválida para o documento.', 'Invalid series for this document.']){
  for(const fim of ['\r\n=====\r\nat RM.Fixture.SaveRecord', ' ===== at RM.Fixture.SaveRecord',
   '\nprivate@example.test CPF 123.456.789-09', ' at RM.Fixture.SaveRecord']){
   assert.equal(resumirMensagemNegocioRm(frase+fim),frase);
  }
 }
 assert.equal(resumirMensagemNegocioRm(' \n\tSérie\tinválida.&#xD;at RM.Fixture'),'Série inválida.');
 assert.equal(resumirMensagemNegocioRm('Série inválida.&#13;at RM.Fixture'),'Série inválida.');
});

test('mensagem com email, CPF, CNPJ, conta, agência ou PIX é descartada antes de ser exibida',()=>{
 for(const linha of ['Série inválida para private@example.test.', 'Documento 123.456.789-09 inválido.',
  'Documento 12.345.678/0001-90 inválido.', 'Documento 12345678909 inválido.',
  'Série inválida para conta 1234-5.', 'Série inválida agência 1234.',
  'Série inválida chave PIX privada.', 'Conta bancária indisponível.',
  'Série inválida CNPJ oculto.', 'Documento 123 456 789 inválido.']){
  assert.equal(resumirMensagemNegocioRm(linha),undefined,linha);
 }
});

test('mensagem técnica, estrutura, headers, credenciais, SQL, URL e tokens não são refletidos',()=>{
 for(const linha of ['<erro>Série inválida.</erro>', '{"message":"Série inválida."}', '[Série inválida.]', '"Série inválida."',
  'Série inválida <script>alert(1)</script>', 'Série inválida &lt;secret&gt;',
  'Authorization: Bearer privateToken Serie inválida.', 'Série inválida. Senha: privada.',
  'Série inválida cookie privado.', 'Série inválida client secret privado.',
  'Campo Content-Type: text/plain inválido.', 'Campo X-Trace: private inválido.',
  'Série inválida. SELECT CODNAT FROM DNATUREZA.', 'System.Data.SqlClient.SqlException: Série inválida.',
  'Série inválida FOREIGN KEY FK_PRIVATE.', 'Série inválida http://private.invalid/credentials',
  'Série inválida www.private.test', 'Série inválida private.internal', 'Série inválida private.example', 'Série inválida 10.0.0.1',
  'Série inválida C:/private/credentials', 'Série inválida C:\\private\\credentials',
  'Série inválida U0VDUkVUX0tFWV9QUklWQVRF', 'Série inválida U0VDUkVU', 'Série inválida c2VjcmV0',
  'Série inválida eyJhbGciOiJIUzI1NiJ9.private.signature',
  'Série inválida abcdef0123456789abcdef0123456789', 'Série inválida abcdefabcdefabcdef', 'Série inválida Bearer_PRIVATE_TOKEN',
  'Série inválida.\u202Eprivate', 'Série inválida.\u0000private', 'Série inválida.\u200Btoken']){
  assert.equal(resumirMensagemNegocioRm(linha),undefined,linha);
 }
 for(const valor of ['', '   ', 'PRIVATE_NATIVE_RESPONSE', '1;9001', 'at RM.Fixture.SaveRecord', null, undefined, {}]){
  assert.equal(resumirMensagemNegocioRm(valor),undefined);
 }
});

test('truncamento respeita300 caracteres e não oculta dados sensíveis depois do limite',()=>{
 const longa='Série inválida para o documento. '+ 'Revise os parâmetros fiscais da operação. '.repeat(12);
 const resumo=resumirMensagemNegocioRm(longa);
 assert.ok(resumo.length<=300);assert.ok(resumo.endsWith('…'));assert.ok(longa.startsWith(resumo.slice(0,-1)));
 assert.equal(resumirMensagemNegocioRm(longa+' Email private@example.test'),undefined);
 assert.equal(resumirMensagemNegocioRm(longa+' Senha privada'),undefined);
 assert.equal(resumirMensagemNegocioRm('Série inválida. '.repeat(10000)),undefined);
});

test('mensagem de apresentação não altera o contrato nem persiste texto no diagnóstico',()=>{
 const raw='Série não cadastrada.\n=====\nat RM.Fixture.SaveRecord';
 const antes=diagnosticarRetornoRm(raw);
 assert.equal(resumirMensagemNegocioRm(raw),'Série não cadastrada.');
 assert.deepEqual(diagnosticarRetornoRm(raw),antes);
 assert.equal(JSON.stringify(antes).includes('Série não cadastrada.'),false);
 assert.deepEqual(Object.keys(antes).sort(),['category','reasonCode','reasonSource','responseSha256','length','lineCount','mentionedFields','nativeErrorTypes'].sort());
});
