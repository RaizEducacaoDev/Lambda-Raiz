import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classRm';
import * as XML from '../../../utils/xml';
import axios from 'axios';

const ConfigManagerRm = new CLASSES.ConfigManagerRm();

export const handler: APIGatewayProxyHandler = async (event) => {
    const queryParams = event.queryStringParameters;

    if (!queryParams) {
        return formatResponse(400, { message: 'Parâmetros de consulta são obrigatórios.' });
    }

    const baseURL = ConfigManagerRm.getUrl();
    const endpoint = ':8051/api/framework/v1/consultaSQLServer/RealizaConsulta/';
    const parametros = `${queryParams.cc}/0/${queryParams.cs}?parameters=${queryParams.p}`;

    try {
        const apiURL = baseURL + endpoint + parametros; // URL da API

        const response = await axios.get(apiURL, {
            headers: {
                'Authorization': `Basic ${ConfigManagerRm.getCredentials()}`,
                'Content-Type': 'application/json',
            },
        });
        if (response.data.length !== 0) {
        return formatResponse(200, { message: 'Consulta realizada com sucesso.', data: response.data });
        }
        else{
            return formatResponse(402, { message: 'Nenhuma informação encontrada.', data: [] });
        }
    } catch (error) {
        return formatResponse(500, { message: 'Erro interno no servidor.', error: error instanceof Error ? error.message : String(error) });
    }
};