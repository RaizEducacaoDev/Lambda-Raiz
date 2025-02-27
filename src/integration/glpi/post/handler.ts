import 'source-map-support/register';
import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/apiGateway';
import { formatJSONResponse } from '@libs/apiGateway';
import { middyfy } from '@libs/lambda';
import schema from '@libs/schema';
import axios from 'axios';
import * as FUNCTIONS from 'src/utilities/functions'
import * as CLASSES from 'src/utilities/classes'
// import btoa from 'btoa';
// import { upperCase } from 'lodash';

const configManager = new CLASSES.ConfigManagerGlpi();
const userToken = configManager.getUserToken(process.env.Stage)
const appToken = configManager.getAppToken(process.env.Stage)
const retorno = formatJSONResponse({});

const admissao: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event, ctx) => {
    try {
        const sessionToken = await configManager.getSessionToken(process.env.Stage);

        let campos = event.body
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

        switch (ticketRaizTI) {
            case '':
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


                const urlCriacaoDeTicket = `${configManager.getUrl(process.env.Stage)}Ticket?session_token=${sessionToken}`; //Alterar na produção
                let respostaDaCriacao = await axios.post(urlCriacaoDeTicket, payload, {
                    headers: {
                        'Content-Type': 'application/json',
                        'user_token': userToken,
                        'App-Token': appToken
                    }
                });

                ticketRaizTI = respostaDaCriacao.data['id']
                retorno.body = JSON.stringify(respostaDaCriacao.data);
                return retorno
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

                const urlUpdate = `${configManager.getUrl(process.env.Stage)}TicketFollowup`

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


                retorno.body = JSON.stringify({ id: ticketRaizTI });
                ctx.succeed(retorno);
                return retorno
        }
    } catch (error) {
        console.log(error)
        if(error[1]){
            retorno.body = JSON.stringify({message: error[0], error: error[1]});
        } else {
            retorno.body = JSON.stringify({message: "Não foi possível abrir um Ticket no GLPI, acione o time de Suporte", error: error.message});
        }
        retorno.statusCode = 500;
        return retorno
    }

}
exports.admissao = middyfy(admissao);

const desligamento: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event, ctx) => {
    try {
        const sessionToken = await configManager.getSessionToken(process.env.Stage);

        let campos = event.body
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
                let chapas = FUNCTIONS.transformToObjectChapas(campos.chapas as string)
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

        const urlCriacaoDeTicket = `${configManager.getUrl(process.env.Stage)}Ticket?session_token=${sessionToken}`
        let resposta = await axios.post(urlCriacaoDeTicket, payload, {
            headers: {
                'Content-Type': 'application/json',
                'user_token': userToken,
                'App-Token': appToken
            }
        });

        retorno.body = JSON.stringify(resposta.data);
        ctx.succeed(retorno);
        return retorno
    } catch (error) {
        console.log(error)
        if(error[1]){
            retorno.body = JSON.stringify({message: error[0], error: error[1]});
        } else {
            retorno.body = JSON.stringify({message: "Não foi possível abrir um Ticket no GLPI, acione o time de Suporte", error: error.message});
        }
        retorno.statusCode = 500;
        return retorno
    }

}
exports.desligamento = middyfy(desligamento);

const movimentacao: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event, ctx) => {
    try {
        const sessionToken = await configManager.getSessionToken(process.env.Stage);

        let campos = event.body
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

        const urlCriacaoDeTicket = `${configManager.getUrl(process.env.Stage)}Ticket?session_token=${sessionToken}`
        let resposta = await axios.post(urlCriacaoDeTicket, payload, {
            headers: {
                'Content-Type': 'application/json',
                'user_token': userToken,
                'App-Token': appToken
            }
        });

        retorno.body = JSON.stringify(resposta.data);
        ctx.succeed(retorno);
        return retorno
    } catch (error) {
        console.log(error)
        if(error[1]){
            retorno.body = JSON.stringify({message: error[0], error: error[1]});
        } else {
            retorno.body = JSON.stringify({message: "Não foi possível abrir um Ticket no GLPI, acione o time de Suporte", error: error.message});
        }
        retorno.statusCode = 500;
        return retorno
    }

}
exports.movimentacao = middyfy(movimentacao);

const aberturaDeChamados: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event, ctx) => {
    try {
        console.log(event.body)
        const sessionToken = await configManager.getSessionToken(process.env.Stage);

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

        const urlCriacaoDeTicket = `${configManager.getUrl(process.env.Stage)}Ticket?session_token=${sessionToken}`
        let resposta = await axios.post(urlCriacaoDeTicket, payload, {
            headers: {
                'Content-Type': 'application/json',
                'user_token': userToken,
                'App-Token': appToken
            }
        });

        retorno.body = JSON.stringify(resposta.data);
        ctx.succeed(retorno);
        return retorno
    } catch (error) {
        console.log(error)
        if(error[1]){
            retorno.body = JSON.stringify({message: error[0], error: error[1]});
        } else {
            retorno.body = JSON.stringify({message: "Não foi possível abrir um Ticket no GLPI, acione o time de Suporte", error: error.message});
        }
        retorno.statusCode = 500;
        return retorno
    }

}
exports.aberturaDeChamados = middyfy(aberturaDeChamados);
