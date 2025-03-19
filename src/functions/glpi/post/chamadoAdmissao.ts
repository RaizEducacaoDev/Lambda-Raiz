// Handler para criação de tickets de Admissão no GLPI
// Responsável por: Novas contratações e requisição de equipamentos
import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classGlpi';
import * as FUNCTIONS from '../../../utils/function';
import axios from 'axios';

// Gerenciador de configuração para conexão com GLPI
const configManager = new CLASSES.ConfigManagerGlpi();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        // Obtenção dos tokens de autenticação para API GLPI
        const sessionToken = await configManager.getSessionToken(process.env.STAGE || 'dev');
        const userToken = await configManager.getUserToken(process.env.STAGE || 'dev');
        const appToken = await configManager.getAppToken(process.env.STAGE || 'dev');

        const campos = JSON.parse(event.body as string);
        let ticketRaizTI = campos.ticketRaizTI
        let solicitante = campos.idDoUsuarioGLPI ? parseInt(campos.idDoUsuarioGLPI as string) : await configManager.buscaIdDoUsuario(campos.emailDoSolicitante as string, sessionToken as string)
        let coligada = campos.coligada
        let nomeDaPessoaAdmitida = FUNCTIONS.valorNaoDefinido(campos.nomeDaPessoaAdmitida)
        let unidadeAlocacao = FUNCTIONS.valorNaoDefinido(campos.unidadeAlocacao)
        let setor = FUNCTIONS.valorNaoDefinido(campos.setor)
        let cargoDoColaborador = FUNCTIONS.valorNaoDefinido(campos.cargoDoColaborador)
        let motivoDaAberturaDaVaga = FUNCTIONS.valorNaoDefinido(campos.motivoDaAberturaDaVaga)
        let dataDeInicio = (campos.dataDeInicio !== '')
            ? campos.dataDeInicio : (campos.dataDaAdmissao !== '')
                ? campos.dataDaAdmissao : 'AINDA NÃO DEFINIDO';
        let nomeDaPessoaSubstituida = FUNCTIONS.valorNaoDefinido(campos.nomeDaPessoaSubstituida)
        let content = ''
        let titulo = ''
        let payload

        // Lógica principal para criação/atualização de tickets
        switch (ticketRaizTI) {
            // Caso novo ticket (sem ID raiz)
            case '':
                // Verifica se é requisição de compra de equipamento para coligada 1
                if ((motivoDaAberturaDaVaga == 'Aumento de quadro' || motivoDaAberturaDaVaga == "AUMENTO DE QUADRO") && coligada == '1') {
                    titulo = "COMPRA DE COMPUTADOR"
                    content = `
                        <p style="text-align: center;">
                            Olá,<br>
                            Solicitamos a compra de computador para o colaborador abaixo:<br>
                            Nome da Pessoa Admitida: <strong>${nomeDaPessoaAdmitida}</strong><br>
                            Unidade Alocacao: <strong>${unidadeAlocacao}</strong><br>
                            Setor: <strong>${setor}</strong><br>
                            Cargo do Colaborador: <strong>${cargoDoColaborador}</strong><br>
                            Tipo da Admissão: <strong>${motivoDaAberturaDaVaga}</strong><br>
                            Data Prevista para Inicio: <strong>${dataDeInicio}</strong><br>
                            Atenciosamente,<br>
                            Raiz Educação
                        </p>
                    `;
                } else {
                    titulo = "CRIAÇÃO DE ACESSOS"
                    content = `
                        <p style="text-align: center;">
                            Olá,<br>
                            Solicitamos a criação de acessos para o colaborador abaixo:<br>
                            Nome da Pessoa Admitida: <strong>${nomeDaPessoaAdmitida}</strong><br>
                            Unidade Alocacao: <strong>${unidadeAlocacao}</strong><br>
                            Setor: <strong>${setor}</strong><br>
                            Cargo do Colaborador: <strong>${cargoDoColaborador}</strong><br>
                            Tipo da Admissão: <strong>${motivoDaAberturaDaVaga}</strong><br>
                            Nome do Substituido: <strong>${nomeDaPessoaSubstituida}</strong><br>
                            Data Prevista para Inicio: <strong>${dataDeInicio}</strong><br>
                            Atenciosamente,<br>
                            Raiz Educação
                        </p>
                    `;
                }

                // Define payload conforme tipo de solicitante (grupo ou usuário)
                if (solicitante == 15) {
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


                // URL para criação de tickets na API GLPI
                const urlCriacaoDeTicket = `${configManager.getUrl(process.env.STAGE || 'dev')}Ticket?session_token=${sessionToken}`;
                let respostaDaCriacao = await axios.post(urlCriacaoDeTicket, payload, {
                    headers: {
                        'Content-Type': 'application/json',
                        'user_token': userToken,
                        'App-Token': appToken
                    }
                });

                ticketRaizTI = respostaDaCriacao.data['id']
                let result = respostaDaCriacao.data
                return formatResponse(200, { result });
            default:
                content = `
                    <p style="text-align: center;">
                        Olá novamente,<br>
                        Gostaria de solicitar a CRIAÇÃO DE ACESSOS do colaborador em questão.<br>
                        Atenciosamente,<br>
                        Nome da Pessoa Admitida: <strong>${nomeDaPessoaAdmitida}</strong><br>
                        Data Prevista para Inicio: <strong>${dataDeInicio}</strong><br>
                        Raiz Educação
                    </p>
                `;

                payload = {
                    input: {
                        tickets_id: ticketRaizTI,
                        content: content,
                        is_private: 0
                    }
                }

                const urlUpdate = `${configManager.getUrl(process.env.STAGE || 'dev')}TicketFollowup`

                // Verifica se é requisição de compra de equipamento para coligada 1
                if ((motivoDaAberturaDaVaga == 'Aumento de quadro' || motivoDaAberturaDaVaga == "AUMENTO DE QUADRO") && coligada == '1') {
                    await axios.post(urlUpdate, payload, {
                        headers: {
                            'Content-Type': 'application/json',
                            'session-token': sessionToken,
                            'user_token': userToken,
                            'App-Token': appToken
                        }
                    }).then(response => {
                        console.log('Update realizado com sucesso:', response.data);
                    }).catch(error => {
                        console.error('Erro ao realizar o update:', error);
                    });
                }

                return formatResponse(200, { id: ticketRaizTI });
        }
    } catch (error) {
        if (Array.isArray(error) && error[1]) {
            return formatResponse(500, { message: error[0], error: error[1] });
        } else {
            return formatResponse(500, { message: "Não foi possível abrir um Ticket no GLPI, acione o time de Suporte",  error: error instanceof Error ? error.message : String(error) });
        }
    }
};