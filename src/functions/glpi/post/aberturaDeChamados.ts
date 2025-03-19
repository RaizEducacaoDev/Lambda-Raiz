// Handler para abertura de tickets no GLPI
// Responsável por criar novos chamados na plataforma
import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classGlpi';
import axios from 'axios';

const configManager = new CLASSES.ConfigManagerGlpi();

export const handler: APIGatewayProxyHandler = async () => {
    try {
        // TODO: Implementar parser dos campos da requisição
        // (event.body currently not used - mantido para futura implementação)
        const sessionToken = await configManager.getSessionToken(process.env.STAGE || 'dev');
        const userToken = await configManager.getUserToken(process.env.STAGE || 'dev');
        const appToken = await configManager.getAppToken(process.env.STAGE || 'dev');

        //let campos = event.body
        let solicitante = await configManager.buscaIdDoUsuario('antonio.silva@raizeducacao.com.br', sessionToken as string)
        let titulo = 'ALTERAÇÃO DE E-MAIL'
        let payload

        // TODO: Melhorar conteúdo do ticket com template HTML
        // (atualmente usando conteúdo estático para testes)
        let content = `teste`;

        // Lógica de grupo/usuário requester
        // TODO: Extrair para método separado na classe ConfigManager
        if (solicitante == 15) {
            payload = {
                input: {
                    name: titulo,
                    content: content,
                    itilcategories_id: 14,
                    _groups_id_requester: solicitante
                    // locations_id: 98, // PRODUÇÃO: Descomentar e configurar conforme ambiente
                }
            };
        } else {
            payload = {
                input: {
                    name: titulo,
                    content: content,
                    itilcategories_id: 14,
                    _users_id_requester: solicitante
                    // locations_id: 98, // PRODUÇÃO: Descomentar e configurar conforme ambiente
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
            // TODO: Incluir detalhes técnicos do erro para análise
            // (considerar logging estruturado com AWS CloudWatch)
            return formatResponse(500, {
                message: "Falha na criação do ticket GLPI",
                error: error instanceof Error ? error.message : String(error),
                glpi_api_error: (error as any)?.response?.data // Capture specific GLPI API details
            });
        }
    }
};