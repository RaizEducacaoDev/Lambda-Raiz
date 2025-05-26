import * as XML from './xml';
import * as DATE from './date';

export function xmlMovAD(campos: any, CODCOLIGADA: string, CODFILIAL: string) : string {
    try {
    
        var cData = '';
        cData += '<![CDATA['
            cData += '<MovMovimento>'
                cData += '<TMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('CODFILIAL', CODFILIAL)
                    cData += XML.montaTag('CODLOC', campos.localDeEstoque)
                    cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                    cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataInstancia))
                    cData += XML.montaTag('DATASAIDA', DATE.toISOSimple(campos.dataInstancia))
                    cData += XML.montaTag('CODCPG', campos.codigoDaFormaPagamento)
                    cData += XML.montaTag('VALORLIQUIDO', campos.valorTotal)
                    cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto)
                    cData += XML.montaTag('CODCOLCFO', '0')
                    cData += XML.montaTag('HISTORICOCURTO', campos.informacoes)
                cData += '</TMOV>'
                cData += '<TMOVPAGTO>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDSEQPAGTO', '-1');
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('IDLAN', '-1');
                    cData += XML.montaTag('DATAVENCIMENTO', DATE.toISOSimple(campos.dataDeVencimento));
                    cData += XML.montaTag('VALOR', campos.valorTotal);
                cData += '</TMOVPAGTO>'
                cData += '<TITMMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('NSEQITMMOV', '1');
                    cData += XML.montaTag('IDPRD', '8');
                    cData += XML.montaTag('QUANTIDADE', '1');
                    cData += XML.montaTag('PRECOUNITARIO', campos.valorTotal);
                    cData += XML.montaTag('CODCOLTBORCAMENTO', '0');
                    cData += XML.montaTag('CODTBORCAMENTO', '02.23.00001');
                cData += '</TITMMOV>'
                cData += '<TMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('TICKET', campos.ticketRaiz);
                    cData += XML.montaTag('LINKDOCUMENTO', (campos.linkDaSolicitacao).slice(0, 255));
                cData += '</TMOVCOMPL>'
            cData += '</MovMovimento>'
        cData += ']]>';

        return cData;

    } catch (error) {
        console.log(error);
        throw error; 
    }

}

export function xmlMovNM(campos: any, CODCOLIGADA: string, CODFILIAL: string) {
    try {
        let listaDeItens = campos.itens as object[];
        let listaDeParcelas = campos.parcelas as object[];
    
        var cData = '';
        cData += '<![CDATA['
            cData += '<MovMovimento>'
                cData += '<TMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('CODFILIAL', CODFILIAL)
                    cData += XML.montaTag('CODLOC', campos.localDeEstoque)
                    cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                    cData += XML.montaTag('NUMEROMOV', (campos.numeroDaNF).slice(0, 9))
                    cData += XML.montaTag('SERIE', campos.serie)
                    cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeEmissao))
                    cData += XML.montaTag('DATASAIDA', DATE.toISOSimple(campos.dataInstancia))
                    cData += XML.montaTag('CHAVEACESSONFE', campos.chaveDeAcesso.replace(/\s+/g, ''))
                    cData += XML.montaTag('CODCPG', campos.codigoDaFormaPagamento)
                    cData += XML.montaTag('VALORLIQUIDO', campos.valorTotal)
                    cData += XML.montaTag('FRETECIFOUFOB', campos.tipoDeFrete)
                    cData += XML.montaTag('VALORFRETE', campos.valorDoFrete)
                    cData += XML.montaTag('VALORDESP', campos.outrasDespesas)
                    cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto)
                    cData += XML.montaTag('CODCOLCFO', '0')
                    cData += XML.montaTag('HISTORICOCURTO', campos.informacoes)
                cData += '</TMOV>'
                for (let j = 0; j < listaDeParcelas.length; j++) {
                    let valorDaParcela = (listaDeParcelas[j] as { valorDaParcela: string }).valorDaParcela;
                    let vencimentoDaParcela = (listaDeParcelas[j] as { vencimentoDaParcela: string }).vencimentoDaParcela;

                    cData += '<TMOVPAGTO>'
                        cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                        cData += XML.montaTag('IDSEQPAGTO', '-1');
                        cData += XML.montaTag('IDMOV', '-1');
                        cData += XML.montaTag('IDLAN', '-1');
                        cData += XML.montaTag('DATAVENCIMENTO', DATE.toISOSimple(vencimentoDaParcela));
                        cData += XML.montaTag('VALOR', valorDaParcela);
                    cData += '</TMOVPAGTO>'
                }
                for (let i = 0; i < listaDeItens.length; i++) {
                    let codigoDaNatureza = (listaDeItens[i] as { codigoDaNatureza: string }).codigoDaNatureza;
                    let codigoDoItem = (listaDeItens[i] as { codigoDoItem: string }).codigoDoItem;
                    let qtdDoItem = (listaDeItens[i] as { qtdDoItem: string }).qtdDoItem;
                    let valorDoItem = (listaDeItens[i] as { valorDoItem: string }).valorDoItem;
            
                    cData += '<TITMMOV>'
                        cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                        cData += XML.montaTag('IDMOV', '-1');
                        cData += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                        cData += XML.montaTag('IDPRD', codigoDoItem);
                        cData += XML.montaTag('QUANTIDADE', qtdDoItem);
                        cData += XML.montaTag('PRECOUNITARIO', valorDoItem); // PRECO UNITARIO
                        cData += XML.montaTag('CODCOLTBORCAMENTO', '0');
                        cData += XML.montaTag('CODTBORCAMENTO', codigoDaNatureza);
                    cData += '</TITMMOV>'
                }
                cData += '<TMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('TICKET', campos.ticketRaiz);
                    cData += XML.montaTag('LINKDOCUMENTO', (campos.linkDaSolicitacao).slice(0, 255));
                cData += '</TMOVCOMPL>'
            cData += '</MovMovimento>'
        cData += ']]>';

        return cData;

    } catch (error) {
        console.log(error);
        throw error; 
    }

}

export function xmlMovNS(campos: any, CODCOLIGADA: string, CODFILIAL: string) {
    try {
        let listaDeItens = campos.itens as object[];
        let listaDeParcelas = campos.parcelas as object[];
        let listaDeTributos = campos.tributos as object[];

        let tributos = ''

        listaDeTributos.forEach((tributo, indice) => {
            tributos += '<TTRBITMMOV>';
                tributos += XML.montaTag('CODCOLIGADA', CODCOLIGADA); 
                tributos += XML.montaTag('IDMOV', '-1');  
                tributos += XML.montaTag('NSEQITMMOV', (indice + 1).toString());   
                tributos += XML.montaTag('CODTRB', (tributo as { codigoDoTributo: string }).codigoDoTributo);
                tributos += XML.montaTag('CODTRBBASE', (tributo as { codigoDoTributo: string }).codigoDoTributo);
                tributos += XML.montaTag('BASEDECALCULO', (tributo as { valorDaAliquota: string }).valorDaAliquota);
                tributos += XML.montaTag('BASEDECALCULOCALCULADA', (tributo as { valorDaAliquota: string }).valorDaAliquota);
                tributos += XML.montaTag('CODRETENCAO',  (tributo as { codigoDeRetencao: string }).codigoDeRetencao);
            tributos += '</TTRBITMMOV>';
        });
    
        var cData = '';
        cData += '<![CDATA['
            cData += '<MovMovimento>'
                    cData += '<TMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('CODFILIAL', CODFILIAL)
                    cData += XML.montaTag('CODLOC', campos.localDeEstoque)
                    cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                    cData += XML.montaTag('NUMEROMOV', (campos.numeroDaNF).slice(0, 9))
                    cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeEmissao))
                    cData += XML.montaTag('DATASAIDA', DATE.toISOSimple(campos.dataInstancia))
                    cData += XML.montaTag('VALOREXTRA1', campos.maoDeObra);
                    cData += XML.montaTag('CODCPG', campos.codigoDaFormaPagamento)
                    cData += XML.montaTag('VALORLIQUIDO', campos.valorTotal)
                    cData += XML.montaTag('IDNAT', campos.idDaNaturezaFiscal)
                    // <CODMUNSERVICO>00100</CODMUNSERVICO>
                    // <CODETDMUNSERV>RJ</CODETDMUNSERV>
                    cData += XML.montaTag('CODIGOIRRF', campos.tributosCodigoDaReceita)
                    cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto)
                    cData += XML.montaTag('CODCOLCFO', '0')
                    cData += XML.montaTag('HISTORICOCURTO', campos.informacoes)
                cData += '</TMOV>'
                for (let j = 0; j < listaDeParcelas.length; j++) {
                    let valorDaParcela = (listaDeParcelas[j] as { valorDaParcela: string }).valorDaParcela;
                    let vencimentoDaParcela = (listaDeParcelas[j] as { vencimentoDaParcela: string }).vencimentoDaParcela;

                    cData += '<TMOVPAGTO>'
                        cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                        cData += XML.montaTag('IDSEQPAGTO', '-1');
                        cData += XML.montaTag('IDMOV', '-1');
                        cData += XML.montaTag('IDLAN', '-1');
                        cData += XML.montaTag('DATAVENCIMENTO', DATE.toISOSimple(vencimentoDaParcela));
                        cData += XML.montaTag('VALOR', valorDaParcela);
                    cData += '</TMOVPAGTO>'
                }
                for (let i = 0; i < listaDeItens.length; i++) {
                    let codigoDaNatureza = (listaDeItens[i] as { codigoDaNatureza: string }).codigoDaNatureza;
                    let codigoDoItem = (listaDeItens[i] as { codigoDoItem: string }).codigoDoItem;
                    let qtdDoItem = (listaDeItens[i] as { qtdDoItem: string }).qtdDoItem;
                    let valorDoItem = (listaDeItens[i] as { valorDoItem: string }).valorDoItem;
            
                    cData += '<TITMMOV>'
                        cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                        cData += XML.montaTag('IDMOV', '-1');
                        cData += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                        cData += XML.montaTag('IDPRD', codigoDoItem);
                        cData += XML.montaTag('QUANTIDADE', qtdDoItem);
                        cData += XML.montaTag('PRECOUNITARIO', valorDoItem);                        
                        cData += XML.montaTag('CODCOLTBORCAMENTO', '0');
                        cData += XML.montaTag('CODTBORCAMENTO', codigoDaNatureza);
                    cData += '</TITMMOV>'
                    cData += tributos
                }
                cData += '<TMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('TICKET', campos.ticketRaiz);
                    cData += XML.montaTag('LINKDOCUMENTO', (campos.linkDaSolicitacao).slice(0, 255));
                cData += '</TMOVCOMPL>'
            cData += '</MovMovimento>'
        cData += ']]>';

        return cData;

    } catch (error) {
        console.log(error);
        throw error; 
    }

}

export function xmlMovFF(campos: any, CODCOLIGADA: string, CODFILIAL: string) {
    try {
        let listaDeItens = campos.itens as object[];
    
        var cData = '';
        cData += '<![CDATA['
        cData += '<MovMovimento>'
            cData += '<TMOV>'
                cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                cData += XML.montaTag('IDMOV', '-1')
                cData += XML.montaTag('CODFILIAL', CODFILIAL)
                cData += XML.montaTag('CODLOC', campos.localDeEstoque)
                cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                cData += XML.montaTag('NUMEROMOV', '-1')
                cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataInstancia))
                cData += XML.montaTag('DATASAIDA', DATE.toISOSimple(campos.dataInstancia))
                cData += XML.montaTag('CODCPG', '001')
                cData += XML.montaTag('VALORLIQUIDO', campos.valorTotal)
                cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto)
                cData += XML.montaTag('CODCOLCFO', '0')
                cData += XML.montaTag('HISTORICOCURTO', campos.informacoes)
            cData += '</TMOV>'
            cData += '<TMOVPAGTO>'
                cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                cData += XML.montaTag('IDSEQPAGTO', '-1');
                cData += XML.montaTag('IDMOV', '-1');
                cData += XML.montaTag('IDLAN', '-1');
                cData += XML.montaTag('IDFORMAPAGTO', '2');
                cData += XML.montaTag('DATAVENCIMENTO', DATE.toISOSimple(campos.dataDeVencimento));
                cData += XML.montaTag('VALOR', campos.valorTotal);
            cData += '</TMOVPAGTO>'

            for (let i = 0; i < listaDeItens.length; i++) {
                let codigoDaNatureza = (listaDeItens[i] as { codigoDaNatureza: string }).codigoDaNatureza;
                let codigoDoItem = (listaDeItens[i] as { codigoDoItem: string }).codigoDoItem;
                let qtdDoItem = (listaDeItens[i] as { qtdDoItem: string }).qtdDoItem;
                let valorDoItem = (listaDeItens[i] as { valorDoItem: string }).valorDoItem;

                cData += '<TITMMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                    cData += XML.montaTag('IDPRD', codigoDoItem);
                    cData += XML.montaTag('QUANTIDADE', qtdDoItem);
                    cData += XML.montaTag('PRECOUNITARIO', valorDoItem);
                    cData += XML.montaTag('CODCOLTBORCAMENTO', '0');
                    cData += XML.montaTag('CODTBORCAMENTO', codigoDaNatureza);
                cData += '</TITMMOV>'
            }

            cData += '<TMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('TICKET', campos.ticketRaiz);
                    cData += XML.montaTag('LINKDOCUMENTO', (campos.linkDaSolicitacao).slice(0, 255));
            cData += '</TMOVCOMPL>'
        cData += '</MovMovimento>'
    cData += ']]>';

    return cData;
        
    } catch (error) {
        console.log(error);
        throw error; 
    }

}

export function xmlMovRE(campos: any, CODCOLIGADA: string, CODFILIAL: string) {
    try {
        let listaDeItens = campos.itens as object[];
    
        var cData = '';
        cData += '<![CDATA['
            cData += '<MovMovimento>'
                cData += '<TMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('CODFILIAL', CODFILIAL)
                    cData += XML.montaTag('CODLOC', campos.localDeEstoque)
                    cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                    cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataInstancia))
                    cData += XML.montaTag('DATASAIDA', DATE.toISOSimple(campos.dataInstancia))
                    cData += XML.montaTag('CODCPG', '001')
                    cData += XML.montaTag('VALORLIQUIDO', campos.valorTotal)
                    cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto)
                    cData += XML.montaTag('CODCOLCFO', '0')
                    cData += XML.montaTag('HISTORICOCURTO', campos.informacoes)
                cData += '</TMOV>'
                cData += '<TMOVPAGTO>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDSEQPAGTO', '-1');
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('IDLAN', '-1');
                    cData += XML.montaTag('DATAVENCIMENTO', DATE.toISOSimple(campos.dataDeVencimento));
                    cData += XML.montaTag('VALOR', campos.valorTotal);
                cData += '</TMOVPAGTO>'
                for (let i = 0; i < listaDeItens.length; i++) {
                    let codigoDaNatureza = (listaDeItens[i] as { codigoDaNatureza: string }).codigoDaNatureza;
                    let codigoDoItem = (listaDeItens[i] as { codigoDoItem: string }).codigoDoItem;
                    let qtdDoItem = (listaDeItens[i] as { qtdDoItem: string }).qtdDoItem;
                    let valorDoItem = (listaDeItens[i] as { valorDoItem: string }).valorDoItem;
            
                    cData += '<TITMMOV>'
                        cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                        cData += XML.montaTag('IDMOV', '-1');
                        cData += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                        cData += XML.montaTag('IDPRD', codigoDoItem);
                        cData += XML.montaTag('QUANTIDADE', qtdDoItem);
                        cData += XML.montaTag('PRECOUNITARIO', valorDoItem);
                        cData += XML.montaTag('CODCOLTBORCAMENTO', '0');
                        cData += XML.montaTag('CODTBORCAMENTO', codigoDaNatureza);
                    cData += '</TITMMOV>'
                }
                cData += '<TMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('TICKET', campos.ticketRaiz)
                cData += '</TMOVCOMPL>'
            cData += '</MovMovimento>'
        cData += ']]>';

        return cData;

    } catch (error) {
        console.log(error);
        throw error; 
    }

}

export function xmlMovTM(campos: any, CODCOLIGADA: string, CODFILIAL: string) {
    try {
        //let listaDeItens = campos.itens as object[];

        var listaDeItens = [{
            codigoDaNatureza: '02.07.00072',
            codigoDoItem:'116181',
            qtdDoItem:'1',
            valorDoItem: campos.valorTotal,
            totalDoItem: campos.valorTotal
        }];

        let listaDeParcelas = campos.parcelas as object[];
    
        var cData = '';
        cData += '<![CDATA['
            cData += '<MovMovimento>'
                cData += '<TMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('CODFILIAL', CODFILIAL)
                    cData += XML.montaTag('CODLOC', campos.localDeEstoque)
                    cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                    cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                    cData += XML.montaTag('NUMEROMOV', (campos.numeroDaNF).slice(0, 9))
                    cData += XML.montaTag('SERIE', campos.serie)
                    cData += XML.montaTag('CHAVEACESSONFE', campos.chaveDeAcesso.replace(/\s+/g, ''))
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeEmissao))
                    cData += XML.montaTag('DATASAIDA', DATE.toISOSimple(campos.dataInstancia))
                    cData += XML.montaTag('CODCPG', campos.codigoDaFormaPagamento)
                    cData += XML.montaTag('VALORLIQUIDO', campos.valorTotal)
                    cData += XML.montaTag('FRETECIFOUFOB', campos.tipoDeFrete)
                    cData += XML.montaTag('VALORFRETE', campos.valorDoFrete)
                    cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto)
                    cData += XML.montaTag('CODCOLCFO', '0')
                    cData += XML.montaTag('HISTORICOCURTO', campos.informacoes)
                cData += '</TMOV>'
                for (let j = 0; j < listaDeParcelas.length; j++) {
                    let valorDaParcela = (listaDeParcelas[j] as { valorDaParcela: string }).valorDaParcela;
                    let vencimentoDaParcela = (listaDeParcelas[j] as { vencimentoDaParcela: string }).vencimentoDaParcela;

                    cData += '<TMOVPAGTO>'
                        cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                        cData += XML.montaTag('IDSEQPAGTO', '-1');
                        cData += XML.montaTag('IDMOV', '-1');
                        cData += XML.montaTag('IDLAN', '-1');
                        cData += XML.montaTag('DATAVENCIMENTO', DATE.toISOSimple(vencimentoDaParcela));
                        cData += XML.montaTag('VALOR', valorDaParcela);
                    cData += '</TMOVPAGTO>'
                }
                for (let i = 0; i < listaDeItens.length; i++) {
                    let codigoDaNatureza = (listaDeItens[i] as { codigoDaNatureza: string }).codigoDaNatureza;
                    let codigoDoItem = (listaDeItens[i] as { codigoDoItem: string }).codigoDoItem;
                    let qtdDoItem = (listaDeItens[i] as { qtdDoItem: string }).qtdDoItem;
                    let valorDoItem = (listaDeItens[i] as { valorDoItem: string }).valorDoItem;
            
                    cData += '<TITMMOV>'
                        cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                        cData += XML.montaTag('IDMOV', '-1');
                        cData += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                        cData += XML.montaTag('IDPRD', codigoDoItem);
                        cData += XML.montaTag('QUANTIDADE', qtdDoItem);
                        cData += XML.montaTag('PRECOUNITARIO', valorDoItem);
                        cData += XML.montaTag('CODCOLTBORCAMENTO', '0');
                        cData += XML.montaTag('CODTBORCAMENTO', codigoDaNatureza);
                    cData += '</TITMMOV>'
                }
                cData += '<TMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('TICKET', campos.ticketRaiz);
                    cData += XML.montaTag('LINKDOCUMENTO', (campos.linkDaSolicitacao).slice(0, 255));
                    cData += XML.montaTag('REMETENTE', campos.remetente);
                    cData += XML.montaTag('INICIOPRESTACAO', campos.inicioDaPrestacao);
                    cData += XML.montaTag('DESTINATARIO', campos.destinatario);
                    cData += XML.montaTag('TERMINOPRESTACAO', campos.terminoDaPrestacao);
                cData += '</TMOVCOMPL>'
            cData += '</MovMovimento>'
        cData += ']]>';

        return cData;

    } catch (error) {
        console.log(error);
        throw error; 
    }

}

export function xmlMovCC(campos: any, CODCOLIGADA: string, CODFILIAL: string) {
    try {
        var idPrd = ''
        var codigoDaNatureza = ''

        if (campos.codigoDoMovimento == '1.2.09'){
            idPrd = '17' 
            codigoDaNatureza = '02.07.00048' 
        } else if (campos.codigoDoMovimento == '1.2.10'){
            idPrd = '7575' 
            codigoDaNatureza = '02.07.00047' 
        } else if (campos.codigoDoMovimento == '1.2.11'){
            idPrd = '5251' 
            codigoDaNatureza = '02.07.00051' 
        } else if (campos.codigoDoMovimento == '1.2.12'){
            idPrd = '5563' 
            codigoDaNatureza = '02.07.00055'             
        }
    
        var cData = '';
        cData += '<![CDATA['
            cData += '<MovMovimento>'
                cData += '<TMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('CODFILIAL', CODFILIAL)
                    cData += XML.montaTag('CODLOC', campos.localDeEstoque)
                    cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                    cData += XML.montaTag('NUMEROMOV', (campos.numeroDaNF).slice(0, 9))
                    cData += XML.montaTag('SERIE', '1')
                    cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeEmissao))
                    cData += XML.montaTag('DATASAIDA', DATE.toISOSimple(campos.dataInstancia))
                    cData += XML.montaTag('CODCPG', '001')
                    cData += XML.montaTag('VALORLIQUIDO', campos.valorTotal)
                    cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto)
                    cData += XML.montaTag('CODCOLCFO', '0')
                    cData += XML.montaTag('HISTORICOCURTO', campos.informacoes)
                cData += '</TMOV>'
                cData += '<TMOVPAGTO>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDSEQPAGTO', '-1');
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('IDLAN', '-1');
                    cData += XML.montaTag('DATAVENCIMENTO', DATE.toISOSimple(campos.dataDeVencimento));
                    cData += XML.montaTag('VALOR', campos.valorTotal);
                cData += '</TMOVPAGTO>'
                cData += '<TITMMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('NSEQITMMOV', '1');
                    cData += XML.montaTag('IDPRD', idPrd);
                    cData += XML.montaTag('QUANTIDADE', '1');
                    cData += XML.montaTag('PRECOUNITARIO', campos.valorTotal);
                    cData += XML.montaTag('CODCOLTBORCAMENTO', '0');
                    cData += XML.montaTag('CODTBORCAMENTO', codigoDaNatureza);
                cData += '</TITMMOV>'
                cData += '<TMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('TICKET', campos.ticketRaiz);
                    cData += XML.montaTag('LINKDOCUMENTO', (campos.linkDaSolicitacao).slice(0, 255));
                cData += '</TMOVCOMPL>'
            cData += '</MovMovimento>'
        cData += ']]>';

        return cData;

    } catch (error) {
        console.log(error);
        throw error; 
    }

}

export function xmlMovAPJ(campos: any, CODCOLIGADA: string, CODFILIAL: string) {
    try {
        var listaDeItens = [{
            codigoDaNatureza: '02.09.00001',
            codigoDoItem:'113849',
            qtdDoItem:'1',
            valorDoItem: campos.valorPagamento,
            totalDoItem: campos.valorPagamento
        }];

        if(campos.contemIPTU == "Sim"){
            listaDeItens.push({
                codigoDaNatureza: '02.09.00002',
                codigoDoItem: '11',
                qtdDoItem: '1',
                valorDoItem: campos.valorDoIPTU,
                totalDoItem: campos.valorDoIPTU
            })
        }
        if(campos.contemCondominio == "Sim"){
            listaDeItens.push({
                codigoDaNatureza: '02.09.00006',
                codigoDoItem:'5659',
                qtdDoItem:'1',
                valorDoItem: campos.valorDoCondominio,
                totalDoItem: campos.valorDoCondominio
            })
        }
        if(campos.contemTaxaDeIncendio == "Sim"){
            listaDeItens.push({
                codigoDaNatureza: '02.09.00004',
                codigoDoItem:'1.02.000100',
                qtdDoItem:'1',
                valorDoItem: campos.valorTaxaDeIncendio,
                totalDoItem: campos.valorTaxaDeIncendio
            })
        }
    
        var cData = '';
        cData += '<![CDATA['
            cData += '<MovMovimento>'
                cData += '<TMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('CODFILIAL', CODFILIAL)
                    cData += XML.montaTag('CODLOC', campos.localDeEstoque)
                    cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                    cData += XML.montaTag('NUMEROMOV', (campos.numeroDaNF).slice(0, 9))
                    cData += XML.montaTag('SERIE', 'ALPJ')
                    cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeEmissao))
                    cData += XML.montaTag('DATASAIDA', DATE.toISOSimple(campos.dataInstancia))
                    cData += XML.montaTag('CODCPG', '001')
                    cData += XML.montaTag('VALORLIQUIDO', campos.valorTotal)
                    cData += XML.montaTag('CODIGOIRRF', campos.tributosCodigoDaReceita)
                    cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto)
                    cData += XML.montaTag('CODCOLCFO', '0')
                    cData += XML.montaTag('HISTORICOCURTO', campos.informacoes)
                cData += '</TMOV>'
                cData += '<TMOVPAGTO>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDSEQPAGTO', '-1');
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('IDLAN', '-1');
                    cData += XML.montaTag('DATAVENCIMENTO', DATE.toISOSimple(campos.dataDeVencimento));
                    cData += XML.montaTag('VALOR', campos.valorTotal);
                cData += '</TMOVPAGTO>'
                for (let i = 0; i < listaDeItens.length; i++) {
                    let codigoDaNatureza = (listaDeItens[i] as { codigoDaNatureza: string }).codigoDaNatureza;
                    let codigoDoItem = (listaDeItens[i] as { codigoDoItem: string }).codigoDoItem;
                    let qtdDoItem = (listaDeItens[i] as { qtdDoItem: string }).qtdDoItem;
                    let valorDoItem = (listaDeItens[i] as { valorDoItem: string }).valorDoItem;
            
                    cData += '<TITMMOV>'
                        cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                        cData += XML.montaTag('IDMOV', '-1');
                        cData += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                        cData += XML.montaTag('IDPRD', codigoDoItem);
                        cData += XML.montaTag('QUANTIDADE', qtdDoItem);
                        cData += XML.montaTag('PRECOUNITARIO', valorDoItem);
                        cData += XML.montaTag('CODCOLTBORCAMENTO', '0');
                        cData += XML.montaTag('CODTBORCAMENTO', codigoDaNatureza);
                    cData += '</TITMMOV>'
                }
                cData += '<TMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('TICKET', campos.ticketRaiz);
                    cData += XML.montaTag('LINKDOCUMENTO', (campos.linkDaSolicitacao).slice(0, 255));
                cData += '</TMOVCOMPL>'
            cData += '</MovMovimento>'

        cData += ']]>';

        return cData;

    } catch (error) {
        console.log(error);
        throw error; 
    }

}

export function xmlMovAPF(campos: any, CODCOLIGADA: string, CODFILIAL: string) {
    try {
        var listaDeItens = [{
            codigoDaNatureza: '02.09.00001',
            codigoDoItem:'113849',
            qtdDoItem:'1',
            valorDoItem: campos.valorPagamento,
            totalDoItem: campos.valorPagamento
        }];

        if(campos.contemIPTU == "Sim"){
            listaDeItens.push({
                codigoDaNatureza: '02.09.00002',
                codigoDoItem: '11',
                qtdDoItem: '1',
                valorDoItem: campos.valorDoIPTU,
                totalDoItem: campos.valorDoIPTU
            })
        }
        if(campos.contemCondominio == "Sim"){
            listaDeItens.push({
                codigoDaNatureza: '02.09.00006',
                codigoDoItem:'5659',
                qtdDoItem:'1',
                valorDoItem: campos.valorDoCondominio,
                totalDoItem: campos.valorDoCondominio
            })
        }
        if(campos.contemTaxaDeIncendio == "Sim"){
            listaDeItens.push({
                codigoDaNatureza: '02.09.00004',
                codigoDoItem:'5709',
                qtdDoItem:'1',
                valorDoItem: campos.valorTaxaDeIncendio,
                totalDoItem: campos.valorTaxaDeIncendio
            })
        }
    
        var cData = '';
        cData += '<![CDATA['
            cData += '<MovMovimento>'
                cData += '<TMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('CODFILIAL', CODFILIAL)
                    cData += XML.montaTag('CODLOC', campos.localDeEstoque)
                    cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                    cData += XML.montaTag('NUMEROMOV', campos.numeroDaNF)
                    cData += XML.montaTag('SERIE', 'AL')
                    cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeEmissao))
                    cData += XML.montaTag('DATASAIDA', DATE.toISOSimple(campos.dataInstancia))
                    cData += XML.montaTag('CODCPG', '001')
                    cData += XML.montaTag('VALORLIQUIDO', campos.valorTotal)
                    cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto)
                    cData += XML.montaTag('CODCOLCFO', '0')
                    cData += XML.montaTag('HISTORICOCURTO', campos.informacoes)
                cData += '</TMOV>'
                cData += '<TMOVPAGTO>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDSEQPAGTO', '-1');
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('IDLAN', '-1');
                    cData += XML.montaTag('DATAVENCIMENTO', DATE.toISOSimple(campos.dataDeVencimento));
                    cData += XML.montaTag('VALOR', campos.valorTotal);
                cData += '</TMOVPAGTO>'
                for (let i = 0; i < listaDeItens.length; i++) {
                    let codigoDaNatureza = (listaDeItens[i] as { codigoDaNatureza: string }).codigoDaNatureza;
                    let codigoDoItem = (listaDeItens[i] as { codigoDoItem: string }).codigoDoItem;
                    let qtdDoItem = (listaDeItens[i] as { qtdDoItem: string }).qtdDoItem;
                    let valorDoItem = (listaDeItens[i] as { valorDoItem: string }).valorDoItem;
            
                    cData += '<TITMMOV>'
                        cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                        cData += XML.montaTag('IDMOV', '-1');
                        cData += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                        cData += XML.montaTag('IDPRD', codigoDoItem);
                        cData += XML.montaTag('QUANTIDADE', qtdDoItem);
                        cData += XML.montaTag('PRECOUNITARIO', valorDoItem);
                        cData += XML.montaTag('CODCOLTBORCAMENTO', '0');
                        cData += XML.montaTag('CODTBORCAMENTO', codigoDaNatureza);
                    cData += '</TITMMOV>'
                }
                cData += '<TMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('MULTIPLO', 'N');
                    cData += XML.montaTag('TICKET', campos.ticketRaiz);
                    cData += XML.montaTag('LINKDOCUMENTO', (campos.linkDaSolicitacao).slice(0, 255));
                cData += '</TMOVCOMPL>'
            cData += '</MovMovimento>'
        cData += ']]>';

        return cData;

    } catch (error) {
        console.log(error);
        throw error; 
    }

}

export function xmlMovRF(campos: any, CODCOLIGADA: string, CODFILIAL: string) {
    try {
        let listaDeItens = campos.itens as object[];
    
        var cData = '';
        cData += '<![CDATA['
            cData += '<MovMovimento>'
                cData += '<TMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('CODFILIAL', CODFILIAL)
                    cData += XML.montaTag('CODLOC', campos.localDeEstoque)
                    cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                    cData += XML.montaTag('NUMEROMOV', (campos.numeroDaNF).slice(0, 9))
                    cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeEmissao))
                    cData += XML.montaTag('DATASAIDA', DATE.toISOSimple(campos.dataInstancia))
                    cData += XML.montaTag('CODCPG', campos.codigoDaFormaPagamento)
                    cData += XML.montaTag('VALORLIQUIDO', campos.valorTotal)
                    cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto)
                    cData += XML.montaTag('CODCOLCFO', '0')
                    cData += XML.montaTag('HISTORICOCURTO', campos.informacoes)
                cData += '</TMOV>'
                cData += '<TMOVPAGTO>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDSEQPAGTO', '-1');
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('IDLAN', '-1');
                    cData += XML.montaTag('DATAVENCIMENTO', DATE.toISOSimple(campos.dataDeVencimento));
                    cData += XML.montaTag('VALOR', campos.valorTotal);
                cData += '</TMOVPAGTO>'
                for (let i = 0; i < listaDeItens.length; i++) {
                    let codigoDaNatureza = (listaDeItens[i] as { codigoDaNatureza: string }).codigoDaNatureza;
                    let codigoDoItem = (listaDeItens[i] as { codigoDoItem: string }).codigoDoItem;
                    let qtdDoItem = (listaDeItens[i] as { qtdDoItem: string }).qtdDoItem;
                    let valorDoItem = (listaDeItens[i] as { valorDoItem: string }).valorDoItem;
            
                    cData += '<TITMMOV>'
                        cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                        cData += XML.montaTag('IDMOV', '-1');
                        cData += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                        cData += XML.montaTag('IDPRD', codigoDoItem);
                        cData += XML.montaTag('QUANTIDADE', qtdDoItem);
                        cData += XML.montaTag('PRECOUNITARIO', valorDoItem);
                        cData += XML.montaTag('CODCOLTBORCAMENTO', '0');
                        cData += XML.montaTag('CODTBORCAMENTO', codigoDaNatureza);
                    cData += '</TITMMOV>'
                }
                cData += '<TMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('TICKET', campos.ticketRaiz);
                    cData += XML.montaTag('LINKDOCUMENTO', (campos.linkDaSolicitacao).slice(0, 255));
                    cData += XML.montaTag('REMETENTE', campos.remetente);
                    cData += XML.montaTag('INICIOPRESTACAO', campos.inicioDaPrestacao);
                    cData += XML.montaTag('DESTINATARIO', campos.destinatario);
                    cData += XML.montaTag('TERMINOPRESTACAO', campos.terminoDaPrestacao);
                cData += '</TMOVCOMPL>'
            cData += '</MovMovimento>'
        cData += ']]>';

        return cData;

    } catch (error) {
        console.log(error);
        throw error; 
    }

}

export function xmlMovRFF(campos: any, CODCOLIGADA: string, CODFILIAL: string) {
    try {
    
        var cData = '';
        cData += '<![CDATA['
            cData += '<MovMovimento>'
                cData += '<TMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('CODFILIAL', CODFILIAL)
                    cData += XML.montaTag('CODLOC', campos.localDeEstoque)
                    cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                    cData += XML.montaTag('NUMEROMOV', '-1')
                    cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeEmissao))
                    cData += XML.montaTag('DATASAIDA', DATE.toISOSimple(campos.dataInstancia))
                    cData += XML.montaTag('CODCPG', '001')
                    cData += XML.montaTag('VALORLIQUIDO', campos.valorTotal)
                    cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto)
                    cData += XML.montaTag('CODCOLCFO', '0')
                    cData += XML.montaTag('HISTORICOCURTO', campos.informacoes)
                cData += '</TMOV>'
                cData += '<TMOVPAGTO>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDSEQPAGTO', '-1');
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('IDLAN', '-1');
                    cData += XML.montaTag('DATAVENCIMENTO', DATE.toISOSimple(campos.dataDeVencimento));
                    cData += XML.montaTag('VALOR', campos.valorTotal);
                cData += '</TMOVPAGTO>'
                cData += '<TITMMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('NSEQITMMOV', '1');
                    cData += XML.montaTag('IDPRD', '7143');
                    cData += XML.montaTag('QUANTIDADE', '1');
                    cData += XML.montaTag('PRECOUNITARIO', campos.valorTotal);
                    cData += XML.montaTag('CODCOLTBORCAMENTO', '0');
                    cData += XML.montaTag('CODTBORCAMENTO', '02.08.00021');
                cData += '</TITMMOV>'
                cData += '<TMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('TICKET', campos.ticketRaiz);
                    cData += XML.montaTag('LINKDOCUMENTO', (campos.linkDaSolicitacao).slice(0, 255));
                    cData += XML.montaTag('REMETENTE', campos.remetente);
                    cData += XML.montaTag('INICIOPRESTACAO', campos.inicioDaPrestacao);
                    cData += XML.montaTag('DESTINATARIO', campos.destinatario);
                    cData += XML.montaTag('TERMINOPRESTACAO', campos.terminoDaPrestacao);
                cData += '</TMOVCOMPL>'
            cData += '</MovMovimento>'
        cData += ']]>';

        return cData;

    } catch (error) {
        console.log(error);
        throw error; 
    }

}
