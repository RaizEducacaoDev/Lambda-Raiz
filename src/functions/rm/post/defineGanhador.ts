import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as RM from '../../../utils/classRm';

const ConfigManagerRm = new RM.ConfigManagerRm();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        console.log('Iniciando definição do ganhador...');
        
        const campos = JSON.parse(event.body as string);

        const CODCOLIGADA = campos.codigoDaColigada === '1' ? campos.codigoDaColigada2 : campos.codigoDaColigada;

        const CODFILIAL = campos.codigoDaColigada === '1' ? campos.codigoDaFilial2 : campos.codigoDaFilial

        console.log(`Definindo ganhador para coligada: ${CODCOLIGADA}, filial: ${CODFILIAL}, cotação: ${campos.cotacao}`);
        
        const resultado = await ConfigManagerRm.defineGanhador(
            CODCOLIGADA as string, 
            campos.cotacao as string, 
            CODFILIAL as string
        );

        if (resultado) {
            console.log(`Ganhador definido com sucesso para cotação ${campos.cotacao}`);
            return formatResponse(200, { 
                message: 'Ganhador definido com sucesso',
                cotacao: campos.cotacao,
                coligada: CODCOLIGADA,
                filial: CODFILIAL
            });
        } else {
            console.error('Falha ao definir ganhador');
            return formatResponse(400, { 
                message: 'Erro ao definir ganhador',
                error: 'Falha na operação defineGanhador'
            });
        }
    } catch (error) {
        console.error('Erro durante o processamento:', error);
        return formatResponse(500, {  
            message: 'Erro interno no servidor',  
            error: error instanceof Error ? error.message : String(error) 
        });
    }
};