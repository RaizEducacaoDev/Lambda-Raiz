import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classRm';
import * as XML from '../../../utils/xml';
import axios from 'axios';

const ConfigManagerRm = new CLASSES.ConfigManagerRm();

export const handler: APIGatewayProxyHandler = async (event) => {
    // Obtém os parâmetros da query string da requisição
    const queryParams = event.queryStringParameters;
    console.log('Parâmetros recebidos:', queryParams);

    let formatParametro = ((queryParams?.p ?? '') as string).replaceAll('%', ';');


    const baseURL = ConfigManagerRm.getUrl(); // URL base do serviço TOTVS
    const endpoint = ':8051/api/framework/v1/consultaSQLServer/RealizaConsulta/'; // Endpoint da API
    const parametros = `RAIZA0016/0/S?parameters=${formatParametro}`; // Monta os parâmetros dinâmicos
    
    console.log('URL construída:', baseURL + endpoint + parametros);

    try {
        const apiURL = baseURL + endpoint + parametros;

        // Realiza a requisição GET para o serviço TOTVS
        const response = await axios.get(apiURL, {
            headers: {
                'Authorization': `Basic ${ConfigManagerRm.getCredentials()}`, // Autenticação básica
                'Content-Type': 'application/json', // Tipo de conteúdo JSON
            },
        });

        console.log('Resposta da API:', response.data);

        // Verifica se há dados na resposta
        if (response.data.length !== 0) {
            return formatResponse(200, { message: 'Consulta realizada com sucesso.', data: response.data });
        } else {
            console.warn('Nenhuma informação encontrada.');
            return formatResponse(402, { message: 'Nenhuma informação encontrada.', data: [] });
        }
    } catch (error) {
        // Loga o erro para facilitar a depuração
        console.error('Erro ao consultar o serviço TOTVS:', error);
        return formatResponse(500, { message: 'Erro interno no servidor.', error: error instanceof Error ? error.message : String(error) });
    }
};