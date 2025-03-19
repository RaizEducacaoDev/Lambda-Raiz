import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classRm';

const ConfigManagerRm = new CLASSES.ConfigManagerRm();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const campos = JSON.parse(event.body as string);

        const CODCOLIGADA = campos.codigoDaColigada === '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';
    
        let file = await ConfigManagerRm.getQuadroComparativo(campos.cotacao as string, CODCOLIGADA as string, `Cotação - Ticket ${campos.ticketRaiz}.pdf`);
    
        if(file){
            return formatResponse(200, { file });
        } else {
            return formatResponse(400, { message: 'Internal Server Error', error: 'Erro ao buscar o arquivo' });
        }
    } catch (error) {
        return formatResponse(500, {  message: 'Internal Server Error',  error: error instanceof Error ? error.message : String(error) });
    }
};