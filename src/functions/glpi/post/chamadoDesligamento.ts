import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classGlpi';
import * as FUNCTIONS from '../../../utils/function';
import * as OBJ from '../../../utils/json';
import axios from 'axios';

const configManager = new CLASSES.ConfigManagerGlpi();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const sessionToken = await configManager.getSessionToken(process.env.STAGE || 'dev');
        const userToken = await configManager.getUserToken(process.env.STAGE || 'dev');
        const appToken = await configManager.getAppToken(process.env.STAGE || 'dev');

        const campos = JSON.parse(event.body as string);

        let solicitante = campos.idDoUsuarioGLPI ? parseInt(campos.idDoUsuarioGLPI as string) : await configManager.buscaIdDoUsuario(campos.emailDoSolicitante as string, sessionToken as string)
        let nomeCompletoDoDesligado = FUNCTIONS.valorNaoDefinido(campos.nomeCompletoDoDesligado)
        let coligada = FUNCTIONS.valorNaoDefinido(campos.coligadaDoColaboradorDesligado)
        let unidadeFilial = FUNCTIONS.valorNaoDefinido(campos.filialDoColaboradorDesligado)
        let areaDeAtuacao = FUNCTIONS.valorNaoDefinido(campos.areaDeAtuacao)
        let cargoDoColaboradorDesligado = FUNCTIONS.valorNaoDefinido(campos.cargoDoColaboradorDesligado)
        let ultimoDiaDoAvisoPrevio = FUNCTIONS.valorNaoDefinido(campos.ultimoDiaDoAvisoPrevio)
        let dataDeDesligamento = FUNCTIONS.valorNaoDefinido(campos.dataDeDesligamento)
        let cancelarAcessos = FUNCTIONS.valorNaoDefinido(campos.cancelarAcessos)
        let possuiMaisChapas = FUNCTIONS.valorNaoDefinido(campos.possuiMaisChapas)
        let content = ''
        let titulo = 'RECOLHIMENTO DE COMPUTADOR'
        let payload

        switch (possuiMaisChapas) {
            case 'Sim':
                let chapas = OBJ.transformToObjectChapas(campos.chapas as string)
                content = `
                    <p style="text-align: center;">
                        Olá,<br>
                        Solicitamos o recolhimento do computador do colaborador abaixo:<br>
                        Coligada: <strong>${coligada}</strong><br>
                        Unidade/Filial: <strong>${unidadeFilial}</strong><br>
                        Área de Atuação: <strong>${areaDeAtuacao}</strong><br>
                        Nome Completo: <strong>${nomeCompletoDoDesligado}</strong><br>
                        Cargo do Colaborador: <strong>${cargoDoColaboradorDesligado}</strong><br>
                        Data do Último Dia do Aviso Prévio: <strong>${ultimoDiaDoAvisoPrevio}</strong><br> 
                        Data de Desligamento: <strong>${dataDeDesligamento}</strong><br>
                        Cancelar os Acessos do Colaborador: <strong>${cancelarAcessos}</strong><br>
                        Possui Mais de Uma Chapa: SIM<br><br>
                        LISTA COM AS CHAPAS A SEREM DESLIGADAS<br><br>
                `
                for (let i = 0; i < chapas.length; i++) {
                    content += `CHAPA: <strong>${chapas[i]["chapa"]}</strong> | CARGO: <strong>${chapas[i]["cargo"]}</strong><br>`
                }

                content += "<br>Atenciosamente,<br>"
                content += "Raiz Educação<br></p>"
                break;
            default:
                content = `
                    <p style="text-align: center;">
                        Olá,<br>
                        Solicitamos o recolhimento do computador do colaborador abaixo:<br>
                        Coligada: <strong>${coligada}</strong><br>
                        Unidade/Filial: <strong>${unidadeFilial}</strong><br>
                        Área de Atuação: <strong>${areaDeAtuacao}</strong><br>
                        Nome Completo: <strong>${nomeCompletoDoDesligado}</strong><br>
                        Cargo do Colaborador: <strong>${cargoDoColaboradorDesligado}</strong><br>
                        Data do Último Dia do Aviso Prévio: <strong>${ultimoDiaDoAvisoPrevio}</strong><br> 
                        Data de Desligamento: <strong>${dataDeDesligamento}</strong><br>
                        Cancelar os Acessos do Colaborador: <strong>${cancelarAcessos}</strong><br>
                        Possui Mais de Uma Chapa: NÃO<br>
                        Atenciosamente,<br>
                        Raiz Educação
                    </p>`;
                break;

        }
        
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
        if (Array.isArray(error) && error[1]) {
            return formatResponse(500, { message: error[0], error: error[1] });
        } else {
            return formatResponse(500, { message: "Não foi possível abrir um Ticket no GLPI, acione o time de Suporte",  error: error instanceof Error ? error.message : String(error) });
        }
    }
};