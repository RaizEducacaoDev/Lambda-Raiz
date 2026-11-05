const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const load=require('./load-ts.cjs');
const {selarDiagnostico226530,capturarDiagnostico226530}=load(path.resolve('src/functions/rm/post/pagamentoDiagnosticoSeguro.ts'));
const now=Date.parse('2026-11-05T19:00:00Z');
test('native diagnostic remains authenticated, decryptable and absent from log plaintext',()=>{
 const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 const pub=pair.publicKey.export({type:'spki',format:'pem'});
 const body='Falha na série; segredo de teste que não deve aparecer nos logs.\n'+('linha sintética\n'.repeat(13));
 const sealed=selarDiagnostico226530(body,pub,now),other=selarDiagnostico226530(body,pub,now);
 assert.ok(!JSON.stringify(sealed).includes('segredo de teste'));
 assert.notEqual(sealed.iv,other.iv);assert.notEqual(sealed.ciphertext,other.ciphertext);
 const key=crypto.privateDecrypt({key:pair.privateKey,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(sealed.wrappedKey,'base64'));
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(sealed.iv,'base64'));
 decipher.setAAD(Buffer.from('rm-native-226530-11-v1'));decipher.setAuthTag(Buffer.from(sealed.tag,'base64'));
 assert.equal(Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext,'base64')),decipher.final()]).toString('utf8'),body);
 assert.equal(sealed.responseSha256,crypto.createHash('sha256').update(body).digest('hex'));
 const bad=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(sealed.iv,'base64'));
 bad.setAAD(Buffer.from('different-ticket'));bad.setAuthTag(Buffer.from(sealed.tag,'base64'));
 bad.update(Buffer.from(sealed.ciphertext,'base64'));assert.throws(()=>bad.final());
});
test('observation is scoped to exact ticket, company and expiry',()=>{
 const logs=[];
 for(const [ticket,col,time] of [['226531','11',now],['226530','10',now],['226530','11',Date.parse('2026-11-05T21:00:00Z')],['226530','11',NaN]]){
  capturarDiagnostico226530('test diagnostic',ticket,col,x=>logs.push(x),time);
 }
 assert.equal(logs.length,0);
 capturarDiagnostico226530('test diagnostic','226530','11',x=>logs.push(x),now);
 assert.equal(logs.length,1);assert.equal(logs[0].ticket,226530);assert.equal(logs[0].coligada,11);
 assert.equal(Buffer.from(logs[0].wrappedKey,'base64').length,384);
});
test('empty and oversized native responses are not captured, measured in bytes',()=>{
 const logs=[];
 for(const text of ['', ' ', 'x'.repeat(16385),'ã'.repeat(8193)])capturarDiagnostico226530(text,'226530','11',x=>logs.push(x),now);
 assert.equal(logs.length,0);
 capturarDiagnostico226530('x'.repeat(16384),'226530','11',x=>logs.push(x),now);assert.equal(logs.length,1);
});
test('observation failures never throw or change the caller result',()=>{
 assert.doesNotThrow(()=>capturarDiagnostico226530('diagnóstico','226530','11',()=>{throw Error('sink failed');},now));
});
