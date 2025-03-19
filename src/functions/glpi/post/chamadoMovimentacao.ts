// Handler para movimentações de colaboradores no GLPI
// Responsável por: Alterações de e-mail e dados cadastrais
import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classGlpi';
import * as FUNCTIONS from '../../../utils/function';
import axios from 'axios';

// Configuração para integração com API GLPI
const configManager = new CLASSES.ConfigManagerGlpi();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        // Obtenção dos tokens de autenticação
        const sessionToken = await configManager.getSessionToken(process.env.STAGE || 'dev');
        const userToken = await configManager.getUserToken(process.env.STAGE || 'dev');
        const appToken = await configManager.getAppToken(process.env.STAGE || 'dev');

        const campos = JSON.parse(event.body as string);

        let solicitante = campos.idDoUsuarioGLPI ? parseInt(campos.idDoUsuarioGLPI as string) : await configManager.buscaIdDoUsuario(campos.emailDoSolicitante as string, sessionToken as string)
        let emailAtualDoFuncionario = FUNCTIONS.valorNaoDefinido(campos.emailAtualDoFuncionario)
        let filialAtualDoFuncionario = FUNCTIONS.valorNaoDefinido(campos.filialAtualDoFuncionario)
        let filialPropostaAoFuncionario = FUNCTIONS.valorNaoDefinido(campos.filialPropostaAoFuncionario)
        let nomeCompletoDoFuncionario = FUNCTIONS.valorNaoDefinido(campos.nomeCompletoDoFuncionario)
        let cargoAtualDoFuncionario = FUNCTIONS.valorNaoDefinido(campos.cargoAtualDoFuncionario)
        let cargoPropostoAoFuncionario = FUNCTIONS.valorNaoDefinido(campos.cargoPropostoAoFuncionario)
        let diretoriaSetorAtual = FUNCTIONS.valorNaoDefinido(campos.diretoriaSetorAtual)
        let diretoriaSetorProposto = FUNCTIONS.valorNaoDefinido(campos.diretoriaSetorProposto)
        let dataDeInicioDaMovimentacao = FUNCTIONS.valorNaoDefinido(campos.dataDeInicioDaMovimentacao)
        let titulo = 'ALTERAÇÃO DE E-MAIL'
        let payload

        // Construção do conteúdo HTML para o ticket
        let content = `
            <p style="text-align: center;">
                Olá,<br>
                Solicitamos a alteração de e-mail para o colaborador abaixo:<br>
                Nome Completo: <strong>${nomeCompletoDoFuncionario}</strong><br>
                E-mail Atual: <strong>${emailAtualDoFuncionario}</strong><br>
                Empresa/Unidade Atual: <strong>${filialAtualDoFuncionario}</strong><br>
                Diretoria/Setor Atual: <strong>${diretoriaSetorAtual}</strong><br> 
                Cargo Atual: <strong>${cargoAtualDoFuncionario}</strong><br>
                Empresa/Unidade Proposta: <strong>${filialPropostaAoFuncionario}</strong><br>
                Diretoria/Setor Proposto: <strong>${diretoriaSetorProposto}</strong><br>
                Cargo Proposto: <strong>${cargoPropostoAoFuncionario}</strong><br>
                Data de Inicio da Movimentação: <strong>${dataDeInicioDaMovimentacao}</strong><br>
                Atenciosamente,<br>
                Raiz Educação
            </p>
        `;

        // Define payload conforme tipo de solicitante (grupo ou usuário)
        if(solicitante == 15){
            payload = {
                input: {
                    name: titulo,
                    content: content,
                    itilcategories_id: 14,  // Categoria: Infraestrutura/TI
                    _groups_id_requester: solicitante
                    //locations_id: 98,  // PRODUÇÃO: ID da localização Raiz Educação
                }
            };
        } else {
            payload = {
                input: {
                    name: titulo,
                    content: content,
                    itilcategories_id: 14,
                    _users_id_requester: solicitante
                    //locations_id: 98,  // PRODUÇÃO: ID da localização Raiz Educação
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