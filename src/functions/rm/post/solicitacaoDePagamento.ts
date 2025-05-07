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

        // const ESTOQUE = campos.codigoDaColigada == '1'
        //     ? `${(campos.filial2 as string).split(" - ")[0]}.001`
        //     : `${(campos.filial as string).split(" - ")[0]}.001`;
        
        const HISTORICOCURTO = campos.informacoes;
        
        const CODCOLIGADA = campos.codigoDaColigada == '1'
        ? campos.codigoDaColigada2 || ''
        : campos.codigoDaColigada || '';
        
        const CODFILIAL = campos.codigoDaColigada == '1'
        ? campos.codigoDaFilial2 || ''
        : campos.codigoDaFilial || '';
        
        const ESTOQUE = await configManagerRm.getLOC(CODCOLIGADA as string, CODFILIAL as string);
        const CODTMV = campos.codigoDoMovimento;

        const SERIE = campos.serie;

        // const OC = campos.ordemDeCompra;

        // const AD = campos.adiantamento;
        // // const valorTotal = UTILS.moedaParaFloat(campos.valorTotal);
        // const valorTotal = campos.valorTotal;

        // //let listaDeItens = XML.criaItensSC(campos.itens as string)
        // let listaDeItens = campos.itens as object[];
        // const tributos = ['ICMS', 'IPI'];

        console.log('[RM-LOG] Gerando XML para movimento tipo:', campos.codigoDoMovimento);
        let cData = '';

        switch (campos.codigoDoMovimento) {
            case '1.2.06':
                cData = MOV.xmlMovAD(campos, CODCOLIGADA, CODFILIAL, SERIE, CODTMV, ESTOQUE, HISTORICOCURTO);
                break;
            case '1.2.01':
                cData = MOV.xmlMovNM(campos, CODCOLIGADA, CODFILIAL, SERIE, CODTMV, ESTOQUE, HISTORICOCURTO);
                break;
            case '1.2.03':
                cData = MOV.xmlMovNS(campos, CODCOLIGADA, CODFILIAL, SERIE, CODTMV, ESTOQUE, HISTORICOCURTO);
                break;
            case '1.2.29':
                cData = MOV.xmlMovFF(campos, CODCOLIGADA, CODFILIAL, SERIE, CODTMV, ESTOQUE, HISTORICOCURTO);
                break;
            case '1.2.07':
                cData = MOV.xmlMovRE(campos, CODCOLIGADA, CODFILIAL, SERIE, CODTMV, ESTOQUE, HISTORICOCURTO);
                break;
            case '1.2.25':
                cData = MOV.xmlMovTM(campos, CODCOLIGADA, CODFILIAL, SERIE, CODTMV, ESTOQUE, HISTORICOCURTO);
                break;
            case '1.2.17':
                cData = MOV.xmlMovAPJ(campos, CODCOLIGADA, CODFILIAL, SERIE, CODTMV, ESTOQUE, HISTORICOCURTO);
                break;
            case '1.2.08':
                cData = MOV.xmlMovAPF(campos, CODCOLIGADA, CODFILIAL, SERIE, CODTMV, ESTOQUE, HISTORICOCURTO);
                break;
            case '1.2.16':
                cData = MOV.xmlMovRF(campos, CODCOLIGADA, CODFILIAL, SERIE, CODTMV, ESTOQUE, HISTORICOCURTO);
                break;
            case '001':
                cData = MOV.xmlMovPAD(campos, CODCOLIGADA, CODFILIAL, SERIE, CODTMV, ESTOQUE, HISTORICOCURTO);
                break;
            case '1.2.28':
                cData = MOV.xmlMovRFF(campos, CODCOLIGADA, CODFILIAL, SERIE, CODTMV, ESTOQUE, HISTORICOCURTO);
                break;
            default:
                cData = MOV.xmlMovCC(campos, CODCOLIGADA, CODFILIAL, SERIE, CODTMV, ESTOQUE, HISTORICOCURTO);
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
            return formatResponse(200, { PG });
        } else {
            const matchResult = result.match(/^[^\r\n]+/);
            if (!matchResult) {
                throw new Error('Failed to extract error message from result');
            }
            const error = matchResult[0];
            return formatResponse(400, { message: 'Internal Server Error', error: error });
        }
    } catch (error) {
        console.error('[RM-ERRO] Falha no processamento:', error);
        return formatResponse(500, {  message: 'Internal Server Error',  error: error instanceof Error ? error.message : String(error) });
    }
};