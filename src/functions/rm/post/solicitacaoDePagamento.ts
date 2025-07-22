import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as wsDataserver from '../../../utils/wsDataserver';
import * as XML from '../../../utils/xml';
import * as DATE from '../../../utils/date';

const dataServer = new wsDataserver.wsDataserver();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const campos = JSON.parse(event.body as string);
        console.info('[RM-INFO] Campos recebidos:', JSON.stringify(campos, null, 2));

        const PG = campos.idDoMovimento || campos.movimentoExistente;
        if (PG && campos.atividadeAtual != 'validarPrestacaoContas') {
            return formatResponse(200, { PG });
        }

        const CODCOLIGADA = campos.codigoDaColigada === '1' ? campos.codigoDaColigada2 : campos.codigoDaColigada || '';
        const CODFILIAL = campos.codigoDaColigada === '1' ? campos.codigoDaFilial2 : campos.codigoDaFilial || '';

        const codigos = {
            AD: '1.2.06',
            RE: '1.2.07',
            FF: '1.2.29',
            RFF: '1.2.28',
            PG: {
                TM: '1.2.25',
                CC: { A: '1.2.09', E: '1.2.10', T: '1.2.11', G: '1.2.12' },
                NF: { Material: '1.2.01', Serviço: '1.2.03' },
                OG: {
                    FR: '1.2.16',
                    AL: { 'PJ': '1.2.17', 'PF': '1.2.08' }
                }
            }
        } as const;

        const obterCodigoMovimento = () => {
            const tipoDaSolicitacao = campos.tipoDaSolicitacao || '';
            const tipoDoPagamento = campos.tipoDoPagamento || '';
            const contasDeConsumo = campos.contasDeConsumo || '';
            const tipoDeItem = campos.tipoDeItem || '';
            const outrosGastos = campos.outrosGastos || '';
            const tipoDoLocador = campos.tipoDoLocador || '';
            const atividadeAtual = campos.atividadeAtual || '';

            if (!tipoDaSolicitacao) {
                throw new Error('O tipo da solicitação é obrigatório');
            }

            if (atividadeAtual === 'validarPrestacaoContas') {
                if (tipoDaSolicitacao === 'AD' && tipoDeItem) {
                    const codigo = codigos.PG.NF[tipoDeItem as keyof typeof codigos.PG.NF];
                    if (codigo) {
                        return codigo;
                    }
                }

                if (tipoDaSolicitacao === 'FF') {
                    const codigo = codigos.RFF;
                    if (codigo) {
                        return codigo;
                    }
                }
            }

            if (tipoDaSolicitacao !== 'PG') {
                const codigo = codigos[tipoDaSolicitacao as keyof typeof codigos];
                if (!codigo) {
                    throw new Error(`Tipo da solicitação é inválido: "${tipoDaSolicitacao}"`);
                }
                return codigo;
            }


            const tiposDePagamento = {
                'TM': () => codigos.PG.TM,
                'CC': () => {
                    if (!contasDeConsumo) {
                        throw new Error('Tipo da conta é obrigátorio para pagamentos do tipo "CONTA DE CONSUMO"');
                    }
                    const codigo = codigos.PG.CC[contasDeConsumo as keyof typeof codigos.PG.CC];
                    if (!codigo) {
                        throw new Error(`Conta de consumo inválida: "${contasDeConsumo}"`);
                    }
                    return codigo;
                },
                'NF': () => {
                    if (!tipoDeItem) {
                        throw new Error('Tipo de item é obrigatório para pagamentos do tipo "NOTA FISCAL"');
                    }
                    const codigo = codigos.PG.NF[tipoDeItem as keyof typeof codigos.PG.NF];
                    if (!codigo) {
                        throw new Error(`Tipo de item é inválido: "${tipoDeItem}"`);
                    }
                    return codigo;
                },
                'padrao': () => {
                    if (outrosGastos === 'FR') {
                        return codigos.PG.OG.FR;
                    }
                    if (!tipoDoLocador) {
                        throw new Error('Tipo do locador é obrigatório para pagamentos do tipo "ALUGUEL"');
                    }
                    const codigo = codigos.PG.OG.AL[tipoDoLocador as keyof typeof codigos.PG.OG.AL];
                    if (!codigo) {
                        throw new Error(`Tipo do locador é inválido: "${tipoDoLocador}"`);
                    }
                    return codigo;
                }
            };

            const handler = tiposDePagamento[tipoDoPagamento as keyof typeof tiposDePagamento] || tiposDePagamento.padrao;
            return handler();
        };

        const CODTMV = obterCodigoMovimento();

        const construirSecaoXML = (tag: string, conteudo: string[]) =>
            `<${tag}>${conteudo.join('')}</${tag}>`;

        const isMovimentoSimples = ['1.2.06', '1.2.07', '1.2.29'].includes(CODTMV.toString());
        const isMovimentoComFrete = ['1.2.01', '1.2.25'].includes(CODTMV.toString());
        const isMovimentoComTributo = ['1.2.03'].includes(CODTMV.toString());
        const isMovimentoComMunicipio = [
            "1.949.02", "2.949.02",
            "1.949.03", "2.949.03",
            "1.949.04", "2.949.04",
            "1.949.05", "2.949.05",
            "1.949.06", "2.949.06",
            "1.949.07", "2.949.07",
            "1.949.08", "2.949.08",
            "1.949.09", "2.949.09",
            "1.949.10", "2.949.10",
            "1.949.11", "2.949.11",
            "1.949.12", "2.949.12",
            "1.949.13", "2.949.13",
            "1.949.14", "2.949.14",
            "1.949.15", "2.949.15",
            "1.949.16", "2.949.16",
            "1.949.17", "2.949.17",
            "1.949.18", "2.949.18",
            "1.949.19", "2.949.19",
            "1.949.20", "2.949.20",
            "1.949.21", "2.949.21",
            "1.949.22", "2.949.22"
        ].includes(campos.codigoDaNaturezaFiscal);

        const tagIf = (cond: boolean, tag: [string, any]) => cond ? [tag] : [];

        const tagsMovimento = [
            ['CODCOLIGADA', CODCOLIGADA],
            ['IDMOV', '-1'],
            ['CODFILIAL', CODFILIAL],
            ['CODLOC', campos.localDeEstoque],
            ['CODCFO', (campos.atividadeAtual === 'validarPrestacaoContas' && CODTMV !== '1.2.28' ? campos.codigoDoFornecedor2 : campos.codigoDoFornecedor)],
            ...tagIf(!isMovimentoSimples, ['NUMEROMOV', (campos.numeroDaNF).slice(0, 9)]),
            ...tagIf(isMovimentoComFrete, ['SERIE', campos.serie]),
            ['CODTMV', CODTMV.toString()],
            ['DATAEMISSAO', (CODTMV.toString() === '1.2.06' || CODTMV.toString() === '1.2.07' || CODTMV.toString() === '1.2.29' || CODTMV.toString() === '1.2.28' ? DATE.toISOSimple(campos.dataDeEntrada) : DATE.toISOSimple(campos.dataDeEmissao))],
            ['DATASAIDA', DATE.toISOSimple(campos.dataDeEntrada)],
            ...tagIf(isMovimentoComFrete, ['CHAVEACESSONFE', campos.chaveDeAcesso.replace(/\s+/g, '')]),
            ['CODCPG', (campos.codigoDaFormaPagamento ? campos.codigoDaFormaPagamento : '001')],
            ['VALORLIQUIDO', campos.valorTotal],
            ...tagIf(isMovimentoComFrete, ['FRETECIFOUFOB', campos.tipoDeFrete]),
            ...tagIf(isMovimentoComFrete, ['VALORFRETE', campos.valorDoFrete === '9' || !campos.valorDoFrete ? '0' : campos.valorDoFrete]),
            ...tagIf(CODTMV.toString() === '1.2.01', ['VALORDESP', campos.outrasDespesas]),
            ...tagIf(CODTMV.toString() === '1.2.03', ['VALOREXTRA1', campos.outrasDespesas]),
            ...tagIf(isMovimentoComTributo, ['IDNAT', campos.idDaNaturezaFiscal]),
            ...tagIf(isMovimentoComTributo, ['CODIGOIRRF', campos.tributosCodigoDaReceita]),
            ...tagIf(isMovimentoComMunicipio, ['CODETDMUNSERV', campos.codigoDoEstado]),
            ...tagIf(isMovimentoComMunicipio, ['CODMUNSERVICO', campos.codigoDoMunicipio]),
            ['CODCCUSTO', campos.codigoDoCentroDeCusto],
            ['CODCOLCFO', '0'],
            ['HISTORICOCURTO', campos.informacoes],
        ].map(([tag, valor]) => XML.montaTag(tag, valor));

        const itens: { coligadaDaNatureza: string; codigoDaNatureza: string; codigoDoItem: string; qtdDoItem: string; valorDoItem: string; desconto: string; }[] = [];

        const configuracoesItem = {
            '1.2.06': { natureza: '02.23.00001', codigo: '8' },
            '1.2.09': { natureza: '02.07.00048', codigo: '17' },
            '1.2.10': { natureza: '02.07.00047', codigo: '7575' },
            '1.2.11': { natureza: '02.07.00051', codigo: '5251' },
            '1.2.12': { natureza: '02.07.00055', codigo: '5563' },
            '1.2.25': { natureza: '02.07.00072', codigo: '116181' },
            '1.2.28': { natureza: '02.08.00021', codigo: '7143' },
        };

        if (configuracoesItem[CODTMV as keyof typeof configuracoesItem]) {
            const config = configuracoesItem[CODTMV as keyof typeof configuracoesItem];
            itens.push({
                codigoDaNatureza: config.natureza,
                coligadaDaNatureza: "0",
                codigoDoItem: config.codigo,
                qtdDoItem: '1',
                valorDoItem: campos.valorTotal,
                desconto: '0'
            });
        } else if (CODTMV === '1.2.08' || CODTMV === '1.2.17') {
            itens.push({
                codigoDaNatureza: '02.09.00001',
                coligadaDaNatureza: "0",
                codigoDoItem: '113849',
                qtdDoItem: '1',
                valorDoItem: campos.valorPagamento,
                desconto: '0'
            });
            const taxasAdicionais = [
                { natureza: '02.09.00002', codigo: '11', valor: 'valorDoIPTU' },
                { natureza: '02.09.00006', codigo: '5659', valor: 'valorDoCondominio' },
                { natureza: '02.09.00004', codigo: '5709', valor: 'valorTaxaDeIncendio' },
                { natureza: '02.07.00047', codigo: '7575', valor: 'valorContaDeEnergia' },
                { natureza: '02.07.00048', codigo: '17', valor: 'valorContaDeAgua' },
                { natureza: '02.07.00055', codigo: '5563', valor: 'ValorContaDeGas' }
            ];

            taxasAdicionais.forEach(taxa => {
                const valor = campos[taxa.valor as keyof typeof campos];
                const valorNumerico = parseFloat(valor.replace(/\./g, '').replace(',', '.'));

                if (valorNumerico > 0) {
                    itens.push({
                        codigoDaNatureza: taxa.natureza,
                        coligadaDaNatureza: "0",
                        codigoDoItem: taxa.codigo,
                        qtdDoItem: '1',
                        valorDoItem: valor,
                        desconto: '0'
                    });
                }
            });
        } else {
            itens.push(...campos.itens);
        }

        const tagsItemMovimento = itens?.map((item, index) => {
            const itemTags = [
                ['CODCOLIGADA', CODCOLIGADA],
                ['IDMOV', '-1'],
                ['NSEQITMMOV', (index + 1).toString()],
                ['IDPRD', item.codigoDoItem],
                ['QUANTIDADE', item.qtdDoItem],
                ['PRECOUNITARIO', item.valorDoItem],
                ['VALORDESC', item.desconto],
                ['CODCOLTBORCAMENTO', (item.coligadaDaNatureza ? item.coligadaDaNatureza : '0')],
                ['CODTBORCAMENTO', item.codigoDaNatureza]
            ].map(([tag, valor]) => XML.montaTag(tag, valor));
            return construirSecaoXML('TITMMOV', itemTags);
        }).join('') || '';

        const tagsComplementoMovimento = [
            ['CODCOLIGADA', CODCOLIGADA],
            ['IDMOV', '-1'],
            ['TICKET', campos.ticketRaiz],
            ['LINKDOCUMENTO', (campos.linkDaSolicitacao || '').slice(0, 255)],
            ...tagIf(CODTMV.toString() === '1.2.25', ['REMETENTE', (campos.remetente || '').replace(/\s+/g, '')]),
            ...tagIf(CODTMV.toString() === '1.2.25', ['INICIOPRESTACAO', (campos.inicioDaPrestacao || '').replace(/\s+/g, '')]),
            ...tagIf(CODTMV.toString() === '1.2.25', ['DESTINATARIO', (campos.destinatario || '').replace(/\s+/g, '')]),
            ...tagIf(CODTMV.toString() === '1.2.25', ['TERMINOPRESTACAO', (campos.terminoDaPrestacao || '').replace(/\s+/g, '')]),
        ].map(([tag, valor]) => XML.montaTag(tag, valor));

        interface Tributo {
            codigoDoTributo: string;
            baseDeCalculo: string;
            aliquota: string;
            valorDaAliquota: string;
        }

        const construirSecaoTributos = (campos.tributos as Tributo[])
            .map((tributo, indice) => {
                const tags = [
                    ['CODCOLIGADA', CODCOLIGADA],
                    ['IDMOV', '-1'],
                    ['NSEQITMMOV', '1'],
                    ['CODTRB', tributo.codigoDoTributo],
                    ['CODTRBBASE', tributo.codigoDoTributo],
                    ['BASEDECALCULO', tributo.baseDeCalculo],
                    ['ALIQUOTA', tributo.aliquota],
                    ['VALOR', tributo.valorDaAliquota],
                    ['EDITADO', '1']
                ].map(([tag, valor]) => XML.montaTag(tag, valor)).join('');

                return `<TTRBITMMOV>${tags}</TTRBITMMOV>`;
            })
            .join('');

        const construirSecaoPagamento = () => {
            if ((CODTMV === '1.2.01' || CODTMV === '1.2.03' || CODTMV === '1.2.25') && campos.listaDeParcelas?.length > 0) {
                return campos.listaDeParcelas.map((parcela: { valorDaParcela: string, vencimentoDaParcela: string }) => {
                    const tagsParcela = [
                        ['CODCOLIGADA', CODCOLIGADA],
                        ['IDMOV', '-1'],
                        ['IDSEQPAGTO', '-1'],
                        ['IDLAN', '-1'],
                        ['DATAVENCIMENTO', DATE.toISOSimple(parcela.vencimentoDaParcela)],
                        ['VALOR', parcela.valorDaParcela]
                    ].map(([tag, valor]) => XML.montaTag(tag, valor));
                    return construirSecaoXML('TMOVPAGTO', tagsParcela);
                }).join('');
            }

            const tagsMovimentoPagamento = [
                ['CODCOLIGADA', CODCOLIGADA],
                ['IDMOV', '-1'],
                ['IDSEQPAGTO', '-1'],
                ['IDLAN', '-1'],
                ...tagIf(CODTMV.toString() === '1.2.29', ['IDFORMAPAGTO', '2']),
                ['DATAVENCIMENTO', DATE.toISOSimple(campos.dataDeVencimento)],
                ['VALOR', campos.valorTotal]
            ].map(([tag, valor]) => XML.montaTag(tag, valor));
            return construirSecaoXML('TMOVPAGTO', tagsMovimentoPagamento);
        };

        let cData = '<![CDATA[<MovMovimento>';
        cData += '<TMOV>';
        tagsMovimento.forEach(tag => { cData += tag; });
        cData += '</TMOV>';
        cData += construirSecaoPagamento();
        cData += tagsItemMovimento;

        if (isMovimentoComTributo) {
            cData += construirSecaoTributos;
        }

        cData += '<TMOVCOMPL>';
        tagsComplementoMovimento.forEach(tag => { cData += tag; });
        cData += '</TMOVCOMPL>';
        cData += '</MovMovimento>]]>';

        if (!cData) {
            throw new Error('Falha ao gerar XML de movimento');
        }

        let result = await dataServer.saveRecord(cData, 'MovMovimentoTBCData', `CODCOLIGADA=${CODCOLIGADA};CODUSUARIO=p_heflo`);

        if (!(result).includes('=')) {
            let PG = result.split(';')[1]
            return formatResponse(200, { PG });
        } else {
            const matchResult = result.match(/^[\s\S]*?(?=^=+)/m);
            if (!matchResult) {
                throw new Error('Falha ao extrair mensagem de erro do resultado');
            }
            const error = matchResult[0];
            const cleanError = error.replace(/&#xD;|\r|\n/g, ' ');

            const hasProduto = /produto/i.test(cleanError);
            const hasData = /data/i.test(cleanError);
            const hasMetta = /data/i.test(cleanError);
            const splitMessage = cleanError.split(':');

            let errorMessage;
            const mainErrorMatch = cleanError.match(/^(.*?)(?:=+|at RM\.|$)/s);
            if (mainErrorMatch && mainErrorMatch[1]) {
                errorMessage = mainErrorMatch[1].trim();
            } else if (hasProduto) {
                errorMessage = cleanError.trim();
            } else if (hasMetta) {
                const dateErrorMatch = cleanError.match(/METTA240\.\s*- (.*)/);
                errorMessage = dateErrorMatch ? dateErrorMatch[1].trim() : cleanError.trim();
            } else if (hasData) {
                const dateErrorMatch = cleanError.match(/:(.*?)[.]/);
                errorMessage = dateErrorMatch ? dateErrorMatch[1].trim() : cleanError.trim();
            } else if (splitMessage.length > 2) {
                errorMessage = splitMessage[1].trim() + ': ' + splitMessage[2].trim();
            } else {
                errorMessage = cleanError.includes(':') ? (cleanError.split(':')[1].trim()) : cleanError.trim();
            }

            console.warn('[RM-WARN] ', errorMessage);
            return formatResponse(400, { message: 'Erro ao gravar no TOTVS', error: "TOTVS: " + errorMessage });
        }
    } catch (error) {
        console.error('[RM-ERRO] ', error);
        return formatResponse(500, { message: 'Erro interno do servidor', error: "TICKET: " + (error instanceof Error ? error.message : String(error)) });
    }
};
