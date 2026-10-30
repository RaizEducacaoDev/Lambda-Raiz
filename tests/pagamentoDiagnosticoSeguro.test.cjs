const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {diagnosticarRetornoRm,tipoErroSeguro}=require('./load-ts.cjs')(path.resolve(__dirname,'../src/functions/rm/post/pagamentoDiagnosticoSeguro.ts'));

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
