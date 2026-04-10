import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as wsDataserver from '../../../utils/wsDataserver';
import { toISOSimple, getNow } from '../../../utils/date';
import { montaTag } from '../../../utils/xml';

const dataServer = new wsDataserver.wsDataserver();

function formatBRCurrency(value: string): string {
    return !value ? '0,00' : value.includes(',') ? value : value.replace('.', ',');
}

function addDaysToDate(dateStr: string, days: string): string {
    if (!dateStr || !days) return dateStr;
    const [dia, mes, ano] = dateStr.split('/').map(Number);
    const date = new Date(ano, mes - 1, dia);
    date.setDate(date.getDate() + parseInt(days));
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}T23:59:59`;
}

interface Produto {
    IDPRD: string;
    QUANTIDADE: string;
}

interface Fornecedor {
    CODCFO: string;
}

interface OrcamentoItem {
    CODCFO: string;
    VALPRAZOENTREGA: string;
    VALPRAZOVALIDADE: string;
    FRETECIFOUFOB: string;
    DESPESA: string;
    VALORFRETE: string;
    IDPRD: string;
    VALCOTACAO: string;
    PRAZOENTREGA: string;
    DESCONTO: string;
    QUANTIDADE: string;
}

interface OrcamentoComprasBody {
    CODCOTACAO: string;
    CODCOLIGADA: string;
    CODCOLIGADAENTREGA: string;
    CODFILIAL: string;
    CODFILIALENTREGA: string;
    TIPOSOLICITACAO: string;
    CODCPG: string;
    IDMOV: string;
    CODCCUSTO: string;
    USUARIOCOMPRADOR: string;
    CODLOCAL: string;
    DATACOTACAO: string;
    produtos: Produto[];
    fornecedores: Fornecedor[];
    orcamentos: OrcamentoItem[];
}

function gerarTCCOTACAO(codCotacao: string, CODCOLIGADA: string): string {
    return '<TCCOTACAO>' + montaTag('CODCOTACAO', codCotacao) + montaTag('CODCOLIGADA', CODCOLIGADA) + '</TCCOTACAO>';
}

function gerarTCCOTACAOITMMOV(dados: any, produto: Produto, nseq: number, CODCOLIGADA: string, CODFILIAL: string, CODTMV: string): string {
    return '<TCCOTACAOITMMOV>' +
        montaTag('CODCOTACAO', dados.CODCOTACAO) +
        montaTag('IDMOV', dados.IDMOV) +
        montaTag('NSEQITMMOV', nseq.toString()) +
        montaTag('CODCOLIGADA', CODCOLIGADA) +
        montaTag('CODCOLMOV', CODCOLIGADA) +
        montaTag('TIPOMOVCOMPRAS', "1") +
        montaTag('QUANTIDADE', produto.QUANTIDADE) +
        montaTag('PRECOUNITARIO', "0") +
        montaTag('CODUND', "UN") +
        montaTag('CODFILIAL', CODFILIAL) +
        montaTag('IDPRD', produto.IDPRD) +
        montaTag('SERIE', "SC") +
        montaTag('MOVIMPRESSO', "0") +
        montaTag('DOCIMPRESSO', "0") +
        montaTag('FATIMPRESSA', "0") +
        montaTag('CODTMV', CODTMV) +
        montaTag('TROCAMARCA', "1") +
        '</TCCOTACAOITMMOV>';
}

function gerarTCORCAMENTO(dados: any, codCfo: string, primeiroItem: OrcamentoItem, CODCOLIGADA: string): string {
    return '<TCORCAMENTO>' +
        montaTag('CODCOTACAO', dados.CODCOTACAO) +
        montaTag('CODCOLIGADA', CODCOLIGADA) +
        montaTag('CODCFO', codCfo) +
        montaTag('CODCOLCFO', '0') +
        montaTag('VALPRAZOENTREGA', primeiroItem.PRAZOENTREGA) +
        montaTag('DATENTREGA', addDaysToDate(dados.DATACOTACAO, primeiroItem.PRAZOENTREGA)) +
        montaTag('VALPRAZOVALIDADE', primeiroItem.VALPRAZOVALIDADE) +
        montaTag('CODCPG', dados.CODCPG) +
        montaTag('CODCPGNEGOCIADA', dados.CODCPG) +
        montaTag('TELCONTATO', '') +
        montaTag('DTHULTENVIO', getNow()) +
        montaTag('VALTRB', '-1,00') +
        montaTag('VALFRETE', '0,0000') +
        montaTag('FRETECIFOUFOB', primeiroItem.FRETECIFOUFOB) +
        montaTag('STEMAILPEDORC', '1') +
        montaTag('STEMAILORDCOMPRA', '0') +
        montaTag('STEMAILQUADROCOMP', '0') +
        montaTag('CODMOEDA', 'R$') +
        montaTag('DESPESA', formatBRCurrency(primeiroItem.DESPESA)) +
        montaTag('VALORFRETE', formatBRCurrency(primeiroItem.VALORFRETE)) +
        montaTag('FORMACOMUNICACAO', '0') +
        montaTag('VALORDESOCRC', formatBRCurrency(primeiroItem.DESCONTO)) +
        montaTag('PERCDESCORC', '0,0000') +
        montaTag('VALORDESCNEG', formatBRCurrency(primeiroItem.DESCONTO)) +
        montaTag('PERCDESCNEG', '0,0000') +
        montaTag('VALICMSST', '0,0000') +
        montaTag('DATAENTREGAORC', addDaysToDate(dados.DATACOTACAO, primeiroItem.PRAZOENTREGA)) +
        montaTag('ALIQFIXADIFERENCIAL', '0') +
        montaTag('DECLINADO', '0') +
        '</TCORCAMENTO>';
}

function gerarTCITMORCAMENTO(dados: any, orcamento: OrcamentoItem, nseq: number, CODCOLIGADA: string): string {
    const dataEntregaCalculada = addDaysToDate(dados.DATACOTACAO, orcamento.PRAZOENTREGA);
    return '<TCITMORCAMENTO>' +
        montaTag('CODCOTACAO', dados.CODCOTACAO) +
        montaTag('CODCOLIGADA', CODCOLIGADA) +
        montaTag('CODCOLCFO', '0') +
        montaTag('CODCFO', orcamento.CODCFO) +
        montaTag('IDPRD', orcamento.IDPRD) +
        montaTag('IDMOV', dados.IDMOV) +
        montaTag('NSEQITMMOV', nseq.toString()) +
        montaTag('QTDEFETIVADA', '0,0000') +
        montaTag('VALCOTACAO', formatBRCurrency(orcamento.VALCOTACAO)) +
        montaTag('VALNEGOCIADO', formatBRCurrency(orcamento.VALCOTACAO)) +
        montaTag('CODUND', 'UN') +
        montaTag('VALTRB', '0,0000') +
        montaTag('STSITEM', '0') +
        montaTag('VALTOTCOTACAO', '0,0000') +
        montaTag('DESCONTO', '0') +
        montaTag('PERCDESCONTO', '0,0000') +
        montaTag('DESCONTONEGOCIADO', '0') +
        montaTag('PERCDESCONTONEGOCIADO', '0,0000') +
        montaTag('CODCPG', dados.CODCPG) +
        montaTag('DATAENTREGA', dataEntregaCalculada) +
        montaTag('DESPESA', '0,0000') +
        montaTag('CODCPGNEGOCIADA', dados.CODCPG) +
        montaTag('CODMOEDA', 'R$') +
        montaTag('VALORDESPITMORC', '0,0000') +
        montaTag('VALORDESPITMNEG', '0,0000') +
        montaTag('PERCDESPITMNEG', '0,0000') +
        montaTag('PRAZOENTREGA', orcamento.PRAZOENTREGA) +
        montaTag('PERCICMSITMORC', '0,0000') +
        montaTag('VALTOTCOTACAONEG', '0,0000') +
        montaTag('VALICMSST', '0,00') +
        montaTag('CODCOLMOV', CODCOLIGADA) +
        montaTag('CFOITEMVENCEDORCOT', '1') +
        montaTag('CFOITEMVENCEDORNEG', '1') +
        // montaTag('VALHOMOGENEOCOTADO', '0,0000') +
        // montaTag('VALHOMOGENEONEGOCIADO', '0,0000') +
        montaTag('VALEQUALIZADOCOT', formatBRCurrency(orcamento.VALCOTACAO)) +
        montaTag('VALEQUALIZADONEG', formatBRCurrency(orcamento.VALCOTACAO)) +
        montaTag('QUANTIDADE', orcamento.QUANTIDADE) +
        montaTag('MARGEMICMSST', '0,0000') +
        montaTag('QUANTIDADEORC', orcamento.QUANTIDADE) +
        montaTag('CODUNDORC', 'UN') +
        montaTag('QUANTIDADENEG', orcamento.QUANTIDADE) +
        montaTag('CODUNDNEG', 'UN') +
        montaTag('FRETECIFOUFOBPARADIGMA', '0') +
        montaTag('VALFRETEPARADIGMA', '0,0000') +
        '</TCITMORCAMENTO>';
}

function gerarTCITMORCAMENTOAGRUPADO(dados: any, orcamento: OrcamentoItem, nseq: number, CODCOLIGADA: string): string {
    const dataEntregaCalculada = addDaysToDate(dados.DATACOTACAO, orcamento.PRAZOENTREGA);
    return '<TCITMORCAMENTOAGRUPADO>' +
        montaTag('CODCOTACAO', dados.CODCOTACAO) +
        montaTag('CODCOLIGADA', CODCOLIGADA) +
        montaTag('CODCOLCFO', '0') +
        montaTag('CODCFO', orcamento.CODCFO) +
        montaTag('IDPRD', orcamento.IDPRD) +
        montaTag('QTDEFETIVADA', '0,0000') +
        montaTag('VALCOTACAO', formatBRCurrency(orcamento.VALCOTACAO)) +
        montaTag('VALNEGOCIADO', formatBRCurrency(orcamento.VALCOTACAO)) +
        montaTag('CODUND', 'UN') +
        montaTag('VALTRB', '0,0000') +
        montaTag('STSITEM', '0') +
        montaTag('VALTOTCOTACAO', '0,0000') +
        montaTag('DESCONTO', '0,0000') +
        montaTag('PERCDESCONTO', '0,0000') +
        montaTag('DESCONTONEGOCIADO', '0,0000') +
        montaTag('PERCDESCONTONEGOCIADO', '0,0000') +
        montaTag('CODCPG', dados.CODCPG) +
        montaTag('DATAENTREGA', dataEntregaCalculada) +
        montaTag('DESPESA', '0,0000') +
        montaTag('CODCPGNEGOCIADA', dados.CODCPG) +
        montaTag('CODMOEDA', 'R$') +
        montaTag('VALORDESPITMORC', '0,0000') +
        montaTag('VALORDESPITMNEG', '0,0000') +
        montaTag('PERCDESPITMNEG', '0,0000') +
        montaTag('PRAZOENTREGA', orcamento.PRAZOENTREGA) +
        montaTag('PERCICMSITMORC', '0,0000') +
        montaTag('VALTOTCOTACAONEG', '0,0000') +
        montaTag('VALICMSST', '0,00') +
        montaTag('CFOITEMVENCEDORCOT', '1') +
        montaTag('CFOITEMVENCEDORNEG', '1') +
        // montaTag('VALHOMOGENEOCOTADO', '0,0000') +
        // montaTag('VALHOMOGENEONEGOCIADO', '0,0000') +
        montaTag('VALEQUALIZADOCOT', formatBRCurrency(orcamento.VALCOTACAO)) +
        montaTag('VALEQUALIZADONEG', formatBRCurrency(orcamento.VALCOTACAO)) +
        montaTag('QUANTIDADE', orcamento.QUANTIDADE) +
        montaTag('MARGEMICMSST', '0,0000') +
        montaTag('QUANTIDADEORC', orcamento.QUANTIDADE) +
        montaTag('CODUNDORC', 'UN') +
        montaTag('QUANTIDADENEG', orcamento.QUANTIDADE) +
        montaTag('CODUNDNEG', 'UN') +
        montaTag('FRETECIFOUFOBPARADIGMA', '0') +
        montaTag('VALFRETEPARADIGMA', '0,0000') +
        montaTag('CODCOLMOV', CODCOLIGADA) +
        montaTag('IDMOV', dados.IDMOV) +
        montaTag('NSEQITMMOV', nseq.toString()) +
        '</TCITMORCAMENTOAGRUPADO>';
}

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const dados: OrcamentoComprasBody = JSON.parse(event.body as string);
        console.info('[RM-INFO] Dados recebidos:', JSON.stringify(dados, null, 2));

        const CODCOLIGADA = dados.CODCOLIGADA === "1" ? dados.CODCOLIGADAENTREGA : dados.CODCOLIGADA;
        const CODFILIAL = dados.CODCOLIGADA === "1" ? dados.CODFILIALENTREGA : dados.CODFILIAL;
        const CODTMV = dados.TIPOSOLICITACAO === "Material" ? "1.1.03" : "1.1.04";

        const produtoSeqMap = new Map<string, number>();
        dados.produtos.forEach((produto, index) => produtoSeqMap.set(produto.IDPRD, index + 1));

        const orcamentosPorFornecedor = new Map<string, OrcamentoItem[]>();
        dados.orcamentos.forEach(orcamento => {
            if (!orcamentosPorFornecedor.has(orcamento.CODCFO)) {
                orcamentosPorFornecedor.set(orcamento.CODCFO, []);
            }
            orcamentosPorFornecedor.get(orcamento.CODCFO)!.push(orcamento);
        });

        let cData = '<![CDATA[<CmpCotacao>';

        cData += gerarTCCOTACAO(dados.CODCOTACAO, CODCOLIGADA);

        dados.produtos.forEach((produto, index) => {
            cData += gerarTCCOTACAOITMMOV(dados, produto, index + 1, CODCOLIGADA, CODFILIAL, CODTMV);
        });

        orcamentosPorFornecedor.forEach((itensFornecedor, codcfo) => {
            const primeiroItem = itensFornecedor[0];
            cData += gerarTCORCAMENTO(dados, codcfo, primeiroItem, CODCOLIGADA);

            itensFornecedor.forEach(orcamento => {
                const nseq = produtoSeqMap.get(orcamento.IDPRD) || 1;
                cData += gerarTCITMORCAMENTO(dados, orcamento, nseq, CODCOLIGADA);
            });
        });

        orcamentosPorFornecedor.forEach((itensFornecedor) => {
            itensFornecedor.forEach(orcamento => {
                const nseq = produtoSeqMap.get(orcamento.IDPRD) || 1;
                cData += gerarTCITMORCAMENTOAGRUPADO(dados, orcamento, nseq, CODCOLIGADA);
            });
        });

        cData += '</CmpCotacao>]]>';

        console.info('[RM-INFO] XML gerado:', cData);

        const contexto = `CODCOLIGADA=${CODCOLIGADA};CODUSUARIO=p_heflo`;
        let result = await dataServer.saveRecord(cData, 'CmpCotacaoData', contexto);

        if (!(result).includes('=')) {
            return formatResponse(200, { 
                CODCOTACAO: dados.CODCOTACAO, 
                message: 'Orçamento de compras salvo com sucesso',
                result: result
            });
        } else {
            const matchResult = result.match(/^[\s\S]*?(?=^=+)/m);
            if (!matchResult) {
                throw new Error('Falha ao extrair mensagem de erro do resultado');
            }
            const error = matchResult[0];
            const cleanError = error.replace(/&#xD;|\r|\n/g, ' ');

            const hasProduto = /produto/i.test(cleanError);
            const hasData = /data/i.test(cleanError);
            const hasMetta = /METTA/i.test(cleanError);
            const splitMessage = cleanError.split(':');

            let errorMessage;
            const mainErrorMatch = cleanError.match(/^(.*?)(?:=+|at RM\.|$)/s);
            if (mainErrorMatch && mainErrorMatch[1]) {
                errorMessage = mainErrorMatch[1].trim();
            } else if (hasProduto) {
                errorMessage = cleanError.trim();
            } else if (hasMetta) {
                const dateErrorMatch = cleanError.match(/METTA\d+\.\s*- (.*)/);
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
            return formatResponse(400, { message: 'Erro ao salvar orçamento de compras no TOTVS', error: "TOTVS: " + errorMessage });
        }
    } catch (error) {
        console.error('[RM-ERRO] ', error);
        return formatResponse(500, { message: 'Erro interno do servidor', error: "TICKET: " + (error instanceof Error ? error.message : String(error)) });
    }
};
