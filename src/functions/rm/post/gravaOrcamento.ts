import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as wsDataserver from '../../../utils/wsDataserver';
const { parseStringPromise, Builder } = require("xml2js");

const dataServer = new wsDataserver.wsDataserver();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const itens = JSON.parse(event.body as string).itens;

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
        let data = [];
        for (const grupo of Object.values(grupos)) {
            let record = await dataServer.readReacord((grupo as { IDORCAMENTO: string }).IDORCAMENTO, 'RMSPRJ3873536Server', ``);
            const obj = await parseStringPromise(record);

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
            let novaMovimentacao = {
                ID: movimentacoes.length + 1,
                IDORC: (grupo as { IDORCAMENTO: string }).IDORCAMENTO,
                TIPO: "I",
                VALOR: ((grupo as { VALOR: number }).VALOR).toFixed(2).replace('.', ','),
                SOLICITACAO: (grupo as { SOLICITACAO: string }).SOLICITACAO,
                DESCRICAO: (grupo as { DESCRICAO: string }).DESCRICAO
            };

            if (!obj.PRJ3873536.ZMDMOVIMENTACOESORC) {
                obj.PRJ3873536.ZMDMOVIMENTACOESORC = [];
            }

            obj.PRJ3873536.ZMDMOVIMENTACOESORC.push(novaMovimentacao);
            const builder = new Builder({ headless: true });
            const xmlFinal = builder.buildObject(obj);

            if (!record) {
                throw new Error('Falha ao gerar XML de movimento');
            }

            let result = await dataServer.saveRecord(`<![CDATA[${xmlFinal}]]>`, 'RMSPRJ3873536Server', ``);

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

        }

        if (data.length > 0) {
            let data = ["Sucesso"]
            return formatResponse(200, { data });
        } else {
            // Remove reference to undefined 'result' variable since data array is empty
            return formatResponse(400, { message: 'Internal Server Error', error: 'No data processed' });
            // This code block should be removed since matchResult is not defined in this scope
            // Remove unreachable code since this line will never be executed
        }

    } catch (error) {
        return formatResponse(500, { message: 'Internal Server Error', error: error instanceof Error ? error.message : String(error) });
    }
}