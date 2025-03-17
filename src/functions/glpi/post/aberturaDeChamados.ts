import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classGlpi';
import axios from 'axios';

const configManager = new CLASSES.ConfigManagerGlpi();

export const handler: APIGatewayProxyHandler = async () => {
    try {
        //const campos = JSON.parse(event.body as string);
        const sessionToken = await configManager.getSessionToken(process.env.STAGE || 'dev');
        const userToken = await configManager.getUserToken(process.env.STAGE || 'dev');
        const appToken = await configManager.getAppToken(process.env.STAGE || 'dev');

        //let campos = event.body
        let solicitante = await configManager.buscaIdDoUsuario('antonio.silva@raizeducacao.com.br', sessionToken as string)
        let titulo = 'ALTERAÇÃO DE E-MAIL'
        let payload

        let content = `teste`;

        if(solicitante == 15){
            payload = {
                input: {
                    name: titulo,
                    content: content,
                    itilcategories_id: 14,
                    _groups_id_requester: solicitante
                    //locations_id: 98, // Alterar na Produção para (98)
                }
            };
        } else {
            payload = {
                input: {
                    name: titulo,
                    content: content,
                    itilcategories_id: 14,
                    _users_id_requester: solicitante
                    //locations_id: 98, // Alterar na Produção para (98)
                }
            };
        }

        const urlCriacaoDeTicket = `${configManager.getUrl(process.env.STAGE || 'dev')}Ticket?session_token=${sessionToken}`
        let resposta = await axios.post(urlCriacaoDeTicket, payload, {
            headers: {
                'Content-Type': 'application/json',
                'user_token': userToken,
                'App-Token': appToken
            }
        });

        let result = resposta.data
        return formatResponse(200, { result });
    } catch (error) {
        console.error(error);
        if (Array.isArray(error) && error[1]) {
            return formatResponse(500, { message: error[0], error: error[1] });
        } else {
            return formatResponse(500, { message: "Não foi possível abrir um Ticket no GLPI, acione o time de Suporte",  error: error instanceof Error ? error.message : String(error) });
        }
    }
};