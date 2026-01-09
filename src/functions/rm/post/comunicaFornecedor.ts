import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as DATE from '../../../utils/date';
import * as CLASSES from '../../../utils/classRm';

const ConfigManagerRm = new CLASSES.ConfigManagerRm();

export const handler: APIGatewayProxyHandler = async (event) => {
    const campos = JSON.parse(event.body as string);

    try {
        const CODCOLIGADA = campos.codigoDaColigada === '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        const CODFILIAL = campos.codigoDaColigada === '1'
            ? campos.codigoDaFilial2 || ''
            : campos.codigoDaFilial || '';

        const TIPOCOTACAO = campos.tipoDaCotacao === "WEB"
            ? campos.tipoDaCotacao
            : "Email";

        const dataLimiteDeResposta = DATE.toISO(campos.dataLimiteDeResposta as string);

        await ConfigManagerRm.postComunicaFornecedor(CODCOLIGADA, CODFILIAL, campos.cotacao, campos.regerarSenha, campos.fornecedores, dataLimiteDeResposta, TIPOCOTACAO, campos.relatorio);

        return formatResponse(200, { message: 'Comunicação realizada com sucesso' });
    } catch (error) {
        return formatResponse(500, { message: 'Internal Server Error', error: error instanceof Error ? error.message : String(error) });
    }

};