import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as wsDataserver from '../../../utils/wsDataserver';
import * as MOV from '../../../utils/xmlMoviments';
import { ConfigManagerRm } from '../../../utils/classRm';

const dataServer = new wsDataserver.wsDataserver();
const configManagerRm = new ConfigManagerRm();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        console.log('[RM-LOG] Iniciando processamento da solicitação de pagamento');
        const campos = JSON.parse(event.body as string);
        console.log(`[RM-LOG] Parâmetros recebidos: ${JSON.stringify(campos)}`);
        
        const CODCOLIGADA = campos.codigoDaColigada == '1'
        ? campos.codigoDaColigada2 || ''
        : campos.codigoDaColigada || '';
        
        const CODFILIAL = campos.codigoDaColigada == '1'
        ? campos.codigoDaFilial2 || ''
        : campos.codigoDaFilial || '';

        console.log('[RM-LOG] Gerando XML para movimento tipo:', campos.codigoDoMovimento);
        let cData = '';

        if (campos.idDoMovimento != '') {
            console.log(`[RM-LOG] Returning existing movement ID: ${campos.idDoMovimento}`);
            let PG = campos.idDoMovimento;
            return formatResponse(200, {PG});
        } else if(campos.movimentoExistente != '') {
            console.log(`[RM-LOG] Returning existing movement: ${campos.movimentoExistente}`);
            let PG = campos.movimentoExistente;
            return formatResponse(200, {PG});
        }

        switch (campos.codigoDoMovimento) {
            case '1.2.06':
                cData = MOV.xmlMovAD(campos, CODCOLIGADA, CODFILIAL);
                break;
            case '1.2.01':
                cData = MOV.xmlMovNM(campos, CODCOLIGADA, CODFILIAL);
                break;
            case '1.2.03':
                cData = MOV.xmlMovNS(campos, CODCOLIGADA, CODFILIAL);
                break;
            case '1.2.29':
                cData = MOV.xmlMovFF(campos, CODCOLIGADA, CODFILIAL);
                break;
            case '1.2.07':
                cData = MOV.xmlMovRE(campos, CODCOLIGADA, CODFILIAL);
                break;
            case '1.2.25':
                cData = MOV.xmlMovTM(campos, CODCOLIGADA, CODFILIAL);
                break;
            case '1.2.17':
                cData = MOV.xmlMovAPJ(campos, CODCOLIGADA, CODFILIAL);
                break;
            case '1.2.08':
                cData = MOV.xmlMovAPF(campos, CODCOLIGADA, CODFILIAL);
                break;
            case '1.2.16':
                cData = MOV.xmlMovRF(campos, CODCOLIGADA, CODFILIAL);
                break;
            case '1.2.28':
                cData = MOV.xmlMovRFF(campos, CODCOLIGADA, CODFILIAL);
                break;
            default:
                cData = MOV.xmlMovCC(campos, CODCOLIGADA, CODFILIAL);
                break;
        }

        if (!cData) {
            throw new Error('Falha ao gerar XML de movimento');
        }

        console.log('[RM-LOG] XML gerado com sucesso. Enviando para o DataServer');
        let result = await dataServer.saveRecord(cData, 'MovMovimentoTBCData', `CODCOLIGADA=${CODCOLIGADA};CODUSUARIO=p_heflo`);
        console.log('[RM-LOG] Resposta do DataServer:', result.substring(0, 100));

        if (!(result).includes('=')) {
            let PG = result.split(';')[1]
            return formatResponse(200, {PG});
        } else {
            const matchResult = result.match(/^[^\r\n]+/);
            if (!matchResult) {
                throw new Error('Failed to extract error message from result');
            }
            const error = matchResult[0];
            console.warn('[RM-WARN] Falha no processamento:', error);
            return formatResponse(400, { message: 'Internal Server Error', error: error });
        }
    } catch (error) {
        console.error('[RM-ERRO] Falha no processamento:', error);
        return formatResponse(500, {  message: 'Internal Server Error',  error: error instanceof Error ? error.message : String(error) });
    }
};