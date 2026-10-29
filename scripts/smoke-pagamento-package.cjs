const assert=require('node:assert/strict');
const path=require('node:path');
const mod=require(path.resolve('.build/package-preview/src/functions/rm/post/solicitacaoDePagamento.js'));
const http=require('node:http'),https=require('node:https');
let calls=0;
for(const api of [http,https])for(const key of ['request','get'])api[key]=()=>{calls++;throw Error('Network forbidden in package smoke test');};
(async()=>{
  const context={getRemainingTimeInMillis:()=>30000};
  const root={tipoDaSolicitacao:'PG',codigoDaColigada2:'31',codigoDaFilial2:'1',codigoDoFornecedor:'0000173261',ticketRaiz:'999999990001'};
  for(const fields of [{...root},{...root,idpgto:'2',CODCOLPGTO:'1'},{...root,idpgto:'2',IDPGTO:'3',CODCOLPGTO:'31'}]){
    const result=await mod.handler({body:JSON.stringify(fields)},context);assert.equal(result.statusCode,422);
  }
  assert.equal(calls,0);console.log(JSON.stringify({packageImported:true,invalidPaymentCases:3,networkCalls:calls}));
})().catch(err=>{console.error(err);process.exitCode=1;});
