import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';

export const handler: APIGatewayProxyHandler = async (event) => {
   var params = event.queryStringParameters || {};
   var a = parseFloat(params.a ||'0');
   var b = parseFloat(params.b ||'0');
   var body = event.body ? JSON.parse(event.body) : {};
    var soma: any = null;

    if (body.operacao) {
        if (body.operacao === 'sum') {
            soma = a + b;
        }
    } else {
        soma = 'não foi realizada nenhuma operação';
    } 
   return formatResponse(200, { 
   message: 'Serviço de Teste de Soma Funcionando Corretamente.', 
   result: soma
  
  });
       
};