import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as wsDataserver from '../../../utils/wsDataserver';
import * as CLASSES from '../../../utils/classRm';
const { parseStringPromise, Builder } = require("xml2js");

var ConfigManagerRm = new CLASSES.ConfigManagerRm();

const dataServer = new wsDataserver.wsDataserver();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const campos = JSON.parse(event.body as string);
        const itens = campos.itens;
        const CODMOV = campos.MOVIMENTO;

        const CODCOLIGADA = campos.codigoDaColigada == '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        const CODFILIAL = campos.codigoDaColigada == '1'
            ? campos.codigoDaFilial2 || ''
            : campos.codigoDaFilial || '';

        var data = [];
        var novaMovimentacao: {
            ID: number;
            IDORC: string | null;
            TIPO: string | null;
            VALOR: string | null;
            SOLICITACAO: string | null;
            DESCRICAO: string | null;
        } = {
            ID: 0,
            IDORC: null,
            TIPO: null,
            VALOR: null,
            SOLICITACAO: null,
            DESCRICAO: null
        };

        let result: any = null;
        let record: any = null;
        let obj: any = null;

        if (CODMOV == '1.2.06' || CODMOV == '1.2.08' || CODMOV == '1.2.17' || CODMOV == '1.2.09' || CODMOV == '1.2.10' || CODMOV == '1.2.11' || CODMOV == '1.2.12') {
            var natureza = ''

            if (CODMOV == '1.2.06') {
                natureza = '02.23.00001';
            } else if (CODMOV == '1.2.08' || CODMOV == '1.2.17') {
                natureza = '02.09.00001';
            } else if (CODMOV == '1.2.9') {
                natureza = '02.07.00048';
            } else if (CODMOV == '1.2.10') {
                natureza = '02.07.00047';
            } else if (CODMOV == '1.2.11') {
                natureza = campos.tipoDoTelefone == 'F'
                    ? "02.07.00049"
                    : "02.07.00050";
            } else if (CODMOV == '1.2.12') {
                natureza = '02.07.00055";';
            }
            novaMovimentacao.TIPO = "E";
            novaMovimentacao.SOLICITACAO = campos.SOLICITACAO;
            novaMovimentacao.DESCRICAO = campos.DESCRICAO;
            novaMovimentacao.VALOR = campos.VALORDOPAGAMENTO;

            let result = await ConfigManagerRm.consultaSQL('TICKET.RAIZ.0039', `CODCOLIGADA=${CODCOLIGADA};CODFILIAL=${CODFILIAL};CODTBORCAMENTO=${natureza}`);
            novaMovimentacao.IDORC = result[0].ID;

            record = await dataServer.readReacord(result[0].ID, 'RMSPRJ3873536Server', ``);
            obj = await parseStringPromise(record);

            // Formatar valores existentes para o padrão 1000,00
            if (obj.PRJ3873536.ZMDMOVIMENTACOESORC) {
                obj.PRJ3873536.ZMDMOVIMENTACOESORC.forEach((mov: any) => {
                    if (mov.VALOR) {
                        const valorNumerico = parseFloat(mov.VALOR);
                        mov.VALOR = valorNumerico.toFixed(2).replace('.', ',');
                    }
                });
            }
        } else {
            // Agrupar itens por IDORCAMENTO e somar valores
            const grupos = itens.reduce((acc: any, item: any) => {
                const key = item.IDORCAMENTO;
                if (!acc[key]) {
                    acc[key] = {
                        ...item,
                        VALOR: 0,
                        SOLICITACAO: item.SOLICITACAO,
                        DESCRICAO: item.DESCRICAO
                    };
                }
                acc[key].VALOR += parseFloat(item.VALOR);
                return acc;
            }, {});

            // Processar cada grupo
            for (const grupo of Object.values(grupos)) {
                record = await dataServer.readReacord((grupo as { IDORCAMENTO: string }).IDORCAMENTO, 'RMSPRJ3873536Server', ``);
                obj = await parseStringPromise(record);

                // Formatar valores existentes para o padrão 1000,00
                if (obj.PRJ3873536.ZMDMOVIMENTACOESORC) {
                    obj.PRJ3873536.ZMDMOVIMENTACOESORC.forEach((mov: any) => {
                        if (mov.VALOR) {
                            const valorNumerico = parseFloat(mov.VALOR);
                            mov.VALOR = valorNumerico.toFixed(2).replace('.', ',');
                        }
                    });
                }

                const movimentacoes = obj.PRJ3873536.ZMDMOVIMENTACOESORC || [];

                novaMovimentacao.ID = movimentacoes.length + 1;
                novaMovimentacao.TIPO = "E";
                novaMovimentacao.SOLICITACAO = (grupo as { SOLICITACAO: string }).SOLICITACAO;
                novaMovimentacao.DESCRICAO = (grupo as { DESCRICAO: string }).DESCRICAO;
                novaMovimentacao.VALOR = ((grupo as { VALOR: number }).VALOR).toFixed(2).replace('.', ',');

            }

        }

        if (!obj.PRJ3873536.ZMDMOVIMENTACOESORC) {
            obj.PRJ3873536.ZMDMOVIMENTACOESORC = [];
        }

        obj.PRJ3873536.ZMDMOVIMENTACOESORC.push(novaMovimentacao);
        const builder = new Builder({ headless: true });
        var xmlFinal = builder.buildObject(obj);

        if (!record) {
            throw new Error('Falha ao gerar XML de movimento');
        }

        result = await dataServer.saveRecord(`<![CDATA[${xmlFinal}]]>`, 'RMSPRJ3873536Server', ``);

        if (!(result).includes('=')) {
            data.push(result)
        } else {
            const matchResult = result.match(/^[^\r\n]+/);
            if (!matchResult) {
                throw new Error('Failed to extract error message from result');
            }
            const error = matchResult[0];
            return formatResponse(400, { message: 'Internal Server Error', error: error });
        }

        if (data.length > 0) {
            data.push(["Sucesso"])
            return formatResponse(200, { data });
        } else {
            return formatResponse(400, { message: 'Internal Server Error', error: 'No data processed' });
        }

    } catch (error) {
        return formatResponse(500, { message: 'Internal Server Error', error: error instanceof Error ? error.message : String(error) });
    }
}