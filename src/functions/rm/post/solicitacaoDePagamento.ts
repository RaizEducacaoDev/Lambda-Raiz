import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as wsDataserver from '../../../utils/wsDataserver';
import * as MOV from '../../../utils/xmlMoviments';

const dataServer = new wsDataserver.wsDataserver();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const campos = JSON.parse(event.body as string);

        const ESTOQUE = campos.codigoDaColigada == '1'
            ? `${(campos.filial2 as string).split(" - ")[0]}.001`
            : `${(campos.filial as string).split(" - ")[0]}.001`;

        const HISTORICOCURTO = campos.informacoes;

        const CODCOLIGADA = campos.codigoDaColigada == '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        const CODFILIAL = campos.codigoDaColigada == '1'
            ? campos.codigoDaFilial2 || ''
            : campos.codigoDaFilial || '';

        const CODTMV = campos.codigoDoMovimento;

        const SERIE = campos.serie;

        // const OC = campos.ordemDeCompra;

        // const AD = campos.adiantamento;
        // // const valorTotal = UTILS.moedaParaFloat(campos.valorTotal);
        // const valorTotal = campos.valorTotal;

        // //let listaDeItens = XML.criaItensSC(campos.itens as string)
        // let listaDeItens = campos.itens as object[];
        // const tributos = ['ICMS', 'IPI'];

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

        let result = await dataServer.saveRecord(cData, 'MovMovimentoTBCData', `CODCOLIGADA=${CODCOLIGADA};CODUSUARIO=p_heflo`);

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
        return formatResponse(500, {  message: 'Internal Server Error',  error: error instanceof Error ? error.message : String(error) });
    }
};