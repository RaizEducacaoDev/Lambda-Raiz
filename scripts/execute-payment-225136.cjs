// One explicitly authorized execution, using the production repository and service.
// Native diagnostics are encrypted for local investigation, never logged in clear.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const load=require('../tests/load-ts.cjs'),cache=new Map();
const mod=p=>load(path.resolve('src/functions/rm/post/'+p+'.ts'),{},cache);
const {executarPagamentoSeguro}=mod('solicitacaoDePagamentoSeguro');
const {handlerLegado}=mod('solicitacaoDePagamentoLegado');
const {DynamoPagamento}=mod('pagamentoV2Idempotencia');
const {TransportePagamentoV2,PrazoPagamento}=mod('pagamentoV2Rm');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
if(input.ticketRaiz!=='225136'||input.codigoDaColigada2!=='1'||input.codigoDaFilial2!=='1'||input.codigoDoFornecedor!=='0000157430'||input.numeroDaNF!=='18'||input.valorTotal!=='20.000,00'||input.idpgto!=='1'||input.CODCOLPGTO!=='1'||input.idDoMovimento||input.movimentoExistente)throw Error('FIXED_TARGET_MISMATCH');
const out='.ticket225136-execution';fs.mkdirSync(out,{recursive:true});
const started=Date.now(),context={getRemainingTimeInMillis:()=>Math.max(0,30000-(Date.now()-started))};
const rm=new TransportePagamentoV2(new PrazoPagamento(context.getRemainingTimeInMillis));
const save=rm.saveRecord.bind(rm),responses=[];let creationCalls=0;
const publicKey=fs.readFileSync('scripts/payment-225136-investigation-public.pem');
function preserve(){
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(responses),'utf8'),cipher.final()]);
 fs.writeFileSync(out+'/native-diagnostics.encrypted.json',JSON.stringify({key:crypto.publicEncrypt({key:publicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}));
}
rm.saveRecord=async(xml,server,context)=>{
 if(server==='MovMovimentoTBCData'&&++creationCalls>1)throw Error('SECOND_CREATION_FORBIDDEN');
 if(!['MovMovimentoTBCData','FinLanDataBR'].includes(server)||!/(?:^|;)CODCOLIGADA=1(?:;|$)/.test(context))throw Error('SAVE_SCOPE_MISMATCH');
 const begin=Date.now();
 try {const result=await save(xml,server,context);responses.push({server,result,durationMs:Date.now()-begin,xmlSha256:crypto.createHash('sha256').update(xml).digest('hex')});preserve();return result;}
 catch(e){responses.push({server,transportError:e.name,durationMs:Date.now()-begin});preserve();throw e;}
};
(async()=>{
 const result=await executarPagamentoSeguro(input,context,(fields,transport)=>handlerLegado({body:JSON.stringify(fields)},{transporte:transport,getLOC:transport.buscarEstoque}),{repositorio:new DynamoPagamento(process.env.PAGAMENTO_IDPGTO_TABLE),rm});
 const report={observedUtc:new Date().toISOString(),ticket:225136,creationCalls,statusCode:result.statusCode,result:JSON.parse(result.body),durationMs:Date.now()-started};
 fs.writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(JSON.stringify({errorType:e.name,code:'CONTROLLED_EXECUTION_FAILED'}));process.exitCode=1;});
