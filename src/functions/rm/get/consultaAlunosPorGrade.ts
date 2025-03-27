import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classRm';
import * as XML from '../../../utils/xml';
import axios from 'axios';

const ConfigManagerRm = new CLASSES.ConfigManagerRm();

export const handler: APIGatewayProxyHandler = async (event) => {

    
    try {
        // Loga o início do processamento da requisição
        console.log('[INFO] Iniciando processamento da requisição.');

        // Obtém os parâmetros da query string da requisição
        const queryParams = event.queryStringParameters;
        console.log('[INFO] Parâmetros recebidos:', queryParams);
        
        // Formata o parâmetro 'p', substituindo '%' por ';'
        let formatParametro = ((queryParams?.p ?? '') as string).replaceAll('%', ';');
        console.log('[INFO] Parâmetro formatado:', formatParametro);


        const baseURL = ConfigManagerRm.getUrl(); // URL base do serviço TOTVS
        const endpoint = ':8051/api/framework/v1/consultaSQLServer/RealizaConsulta/'; // Endpoint da API
        const parametros = `RAIZA.0016/0/S?parameters=${queryParams?.p || 'MARCA=%'}`; // Monta os parâmetros dinâmicos
        console.log('[INFO] URL construída:', baseURL + endpoint + parametros);

        const apiURL = baseURL + endpoint + parametros;

        console.log('[INFO] Enviando requisição para a API TOTVS...');
        // Realiza a requisição GET para o serviço TOTVS
        const response = await axios.get(apiURL, {
            headers: {
                'Authorization': `Basic ${ConfigManagerRm.getCredentials()}`, // Autenticação básica
                'Content-Type': 'application/json', // Tipo de conteúdo JSON
            },
        });

        console.log('[INFO] Resposta da API recebida:', response.data);

        // Verifica se há dados na resposta
        if (response.data.length !== 0) {
            console.log('[INFO] Dados encontrados na resposta.');
            return formatResponse(200, { message: 'Consulta realizada com sucesso.', data: response.data });
        } else {
            console.warn('[WARN] Nenhuma informação encontrada na resposta.');
            return formatResponse(402, { message: 'Nenhuma informação encontrada.', data: [] });
        }
    } catch (error) {
        // Loga o erro ocorrido
        console.error('[ERROR] Erro ao consultar o serviço TOTVS:', error);
        return formatResponse(500, { message: 'Erro interno no servidor.', error: error instanceof Error ? error.message : String(error) });
    }
};