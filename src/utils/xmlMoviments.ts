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
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISO(campos.dataInstancia))
                    cData += XML.montaTag('DATASAIDA', DATE.toISO(campos.dataInstancia))
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
                    cData += XML.montaTag('DATASAIDA', DATE.toISO(campos.dataInstancia))
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
                    cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                    cData += XML.montaTag('NUMEROMOV', (campos.numeroDaNF).slice(0, 9))
                    cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeEmissao))
                    cData += XML.montaTag('DATASAIDA', DATE.toISO(campos.dataInstancia))
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
                cData += XML.montaTag('CODLOCDESTINO', campos.localDeEstoque)
                cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                cData += XML.montaTag('NUMEROMOV', '-1')
                cData += XML.montaTag('SERIE', campos.serie)
                cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                cData += XML.montaTag('TIPO', 'A')
                cData += XML.montaTag('MOVIMPRESSO', '0')
                cData += XML.montaTag('DOCIMPRESSO', '0')
                cData += XML.montaTag('FATIMPRESSA', '0')
                cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeVencimento))
                cData += XML.montaTag('COMISSAOREPRES', '0.0000')
                cData += XML.montaTag('CODCPG', campos.codigoDaFormaPagamento)
                cData += XML.montaTag('VALORBRUTO', campos.valorTotal)
                cData += XML.montaTag('VALORLIQUIDO', campos.valorTotal)
                cData += XML.montaTag('VALOROUTROS', campos.valorTotal)
                cData += XML.montaTag('PERCENTUALFRETE', '0.0000')
                cData += XML.montaTag('VALORFRETE', '0.0000')
                cData += XML.montaTag('PERCENTUALDESC', '0.0000')
                cData += XML.montaTag('VALORDESC', '0.0000')
                cData += XML.montaTag('PERCENTUALDESP', '0.0000')
                cData += XML.montaTag('VALORDESP', '0.0000')
                cData += XML.montaTag('PERCCOMISSAO', '0.0000')
                cData += XML.montaTag('CODMEN', '01')
                cData += XML.montaTag('PESOLIQUIDO', '0.0000')
                cData += XML.montaTag('PESOBRUTO', '0.0000')
                cData += XML.montaTag('IDMOVLCTFLUXUS', '-1')
                cData += XML.montaTag('CODMOEVALORLIQUIDO', 'R$')
                cData += XML.montaTag('DATAMOVIMENTO', DATE.getNow())
                cData += XML.montaTag('GEROUFATURA', '0')
                cData += XML.montaTag('NUMEROLCTABERTO', '1')
                cData += XML.montaTag('CODCFOAUX', campos.codigoDoFornecedor)
                cData += XML.montaTag('VALORRECEBIDO', campos.valorTotal)
                cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto)
                cData += XML.montaTag('CODVEN1', campos.codigoDoComprador)
                cData += XML.montaTag('PERCCOMISSAOVEN2', '0.0000')
                cData += XML.montaTag('CODCOLCFO', '0')
                cData += XML.montaTag('CODUSUARIO', 'p_heflo')
                cData += XML.montaTag('CODFILIALDESTINO', CODFILIAL)
                cData += XML.montaTag('GERADOPORLOTE', '0')
                cData += XML.montaTag('STATUSEXPORTCONT', '0')
                cData += XML.montaTag('GEROUCONTATRABALHO', '0')
                cData += XML.montaTag('GERADOPORCONTATRABALHO', '0')
                cData += XML.montaTag('HORULTIMAALTERACAO', DATE.toISOSimple(campos.dataDeVencimento))
                cData += XML.montaTag('INDUSOOBJ', '0.00')
                cData += XML.montaTag('INTEGRADOBONUM', '0')
                cData += XML.montaTag('FLAGPROCESSADO', '0')
                cData += XML.montaTag('ABATIMENTOICMS', '0.0000')
                cData += XML.montaTag('HORARIOEMISSAO', DATE.toISOSimple(campos.dataDeVencimento))
                cData += XML.montaTag('USUARIOCRIACAO', 'p_heflo')
                cData += XML.montaTag('STSEMAIL', '0.0000')
                cData += XML.montaTag('VALORBRUTOINTERNO', campos.valorTotal)
                cData += XML.montaTag('VINCULADOcampos.localDeEstoqueFL', '0.0000')
                cData += XML.montaTag('VRBASEINSSOUTRAEMPRESA', '0.0000')
                cData += XML.montaTag('VALORDESCCONDICIONAL', '0.0000')
                cData += XML.montaTag('VALORDESPCONDICIONAL', '0.0000')
                cData += XML.montaTag('INTEGRADOAUTOMACAO', '0.0000')
                cData += XML.montaTag('INTEGRAAPLICACAO', 'T')
                cData += XML.montaTag('RECIBONFESTATUS', '0')
                cData += XML.montaTag('VALORMERCADORIAS', '0.0000')
                cData += XML.montaTag('USARATEIOVALORFIN', '1')
                cData += XML.montaTag('CODCOLCFOAUX', '0')
                cData += XML.montaTag('VALORRATEIOLAN', campos.valorTotal)
                cData += XML.montaTag('RATEIOCCUSTODEPTO', campos.valorTotal)
                cData += XML.montaTag('VALORBRUTOORIG', campos.valorTotal)
                cData += XML.montaTag('VALORLIQUIDOORIG', campos.valorTotal)
                cData += XML.montaTag('VALOROUTROSORIG', campos.valorTotal)
                cData += XML.montaTag('VALORRATEIOLANORIG', campos.valorTotal)
                cData += XML.montaTag('HISTORICOCURTO', campos.informacoes)
                cData += XML.montaTag('FLAGCONCLUSAO', '0')
                cData += XML.montaTag('STATUSPARADIGMA', 'N')
                cData += XML.montaTag('STATUSINTEGRACAO', 'N')
                cData += XML.montaTag('PERCCOMISSAOVEN3', '0.0000')
                cData += XML.montaTag('PERCCOMISSAOVEN4', '0.0000')
                cData += XML.montaTag('CODCOLIGADA1', CODCOLIGADA)
                cData += XML.montaTag('IDMOVHST', '-1')
            cData += '</TMOV>'
            cData += '<TNFE>'
                cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                cData += XML.montaTag('IDMOV', '-1')
                cData += XML.montaTag('VALORSERVICO', '0.0000')
                cData += XML.montaTag('DEDUCAOSERVICO', '0.0000')
                cData += XML.montaTag('ALIQUOTAISS', '0.0000')
                cData += XML.montaTag('ISSRETIDO', '0')
                cData += XML.montaTag('VALORISS', '0.0000')
                cData += XML.montaTag('VALORCREDITOIPTU', '0.0000')
                cData += XML.montaTag('BASEDECALCULO', '0.0000')
                cData += XML.montaTag('EDITADO', '0')
            cData += '</TNFE>'
            cData += '<TMOVFISCAL>'
                cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                cData += XML.montaTag('IDMOV', '-1')
                cData += XML.montaTag('CONTRIBUINTECREDENCIADO', '0')
                cData += XML.montaTag('OPERACAOCONSUMIDORFINAL', '0')
                cData += XML.montaTag('OPERACAOPRESENCIAL', '0')
            cData += '</TMOVFISCAL>'
            cData += '<TMOVRATCCU>'
                cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                cData += XML.montaTag('IDMOV', '-1')
                cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto)
                cData += XML.montaTag('VALOR', campos.valorTotal)
                cData += XML.montaTag('IDMOVRATCCU', '-1')
            cData += '</TMOVRATCCU>'
            cData += '<TMOVPAGTO>'
                cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                cData += XML.montaTag('IDSEQPAGTO', '-1');
                cData += XML.montaTag('IDMOV', '-1');
                cData += XML.montaTag('CODCOLCFODEFAULT', '0');
                cData += XML.montaTag('TIPOFORMAPAGTO', '3');
                cData += XML.montaTag('TAXAADM', '0.0000');
                cData += XML.montaTag('CODCXA', '003');
                cData += XML.montaTag('CODCOLCXA', '0');
                cData += XML.montaTag('IDLAN', '-1');
                cData += XML.montaTag('IDFORMAPAGTO', '2');
                cData += XML.montaTag('DATAVENCIMENTO', DATE.toISOSimple(campos.dataDeVencimento));
                cData += XML.montaTag('TIPOPAGAMENTO', '1');
                cData += XML.montaTag('VALOR', campos.valorTotal);
                cData += XML.montaTag('DEBITOCREDITO', 'C');
                cData += XML.montaTag('IDSEQPAGTO1', '-1');
            cData += '</TMOVPAGTO>'

            for (let i = 0; i < listaDeItens.length; i++) {
                let codigoDaNatureza = (listaDeItens[i] as { codigoDaNatureza: string }).codigoDaNatureza;
                let codigoDoItem = (listaDeItens[i] as { codigoDoItem: string }).codigoDoItem;
                let qtdDoItem = (listaDeItens[i] as { qtdDoItem: string }).qtdDoItem;
                let valorDoItem = (listaDeItens[i] as { valorDoItem: string }).valorDoItem;
                let totalDoItem = (listaDeItens[i] as { totalDoItem: string }).totalDoItem;

                cData += '<TITMMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                    cData += XML.montaTag('CODFILIAL', CODFILIAL);
                    cData += XML.montaTag('NUMEROSEQUENCIAL', (i + 1).toString());
                    cData += XML.montaTag('IDPRD', codigoDoItem);
                    cData += XML.montaTag('QUANTIDADE', qtdDoItem);
                    cData += XML.montaTag('PRECOUNITARIO', valorDoItem); // PRECO UNITARIO
                    cData += XML.montaTag('PRECOTABELA', '0.0000');
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeVencimento))
                    cData += XML.montaTag('CODUND', 'UN');
                    cData += XML.montaTag('QUANTIDADEARECEBER', qtdDoItem);
                    cData += XML.montaTag('VALORUNITARIO', '0.0000');
                    cData += XML.montaTag('VALORFINANCEIRO', '0.0000');
                    cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto);
                    cData += XML.montaTag('ALIQORDENACAO', '0.0000');
                    cData += XML.montaTag('QUANTIDADEORIGINAL', qtdDoItem);
                    cData += XML.montaTag('FLAG', '0');
                    cData += XML.montaTag('FATORCONVUND', '0.0000');
                    cData += XML.montaTag('VALORBRUTOITEM', '0.0000'); 
                    cData += XML.montaTag('VALORTOTALITEM', totalDoItem);// PRECO UNITARIO X QTD
                    cData += XML.montaTag('QUANTIDADESEPARADA', totalDoItem); // PRECO UNITARIO X QTD
                    cData += XML.montaTag('COMISSAOREPRES', '0.0000');
                    cData += XML.montaTag('VALORESCRITURACAO', '0.0000');
                    cData += XML.montaTag('VALORFINPEDIDO', '0.0000');
                    cData += XML.montaTag('VALOROPFRM1', '0.0000');
                    cData += XML.montaTag('VALOROPFRM2', '0.0000');
                    cData += XML.montaTag('PRECOEDITADO', '0');
                    cData += XML.montaTag('QTDEVOLUMEUNITARIO', qtdDoItem);
                    cData += XML.montaTag('CODVEN1', campos.codigoDoComprador);
                    cData += XML.montaTag('PRECOTOTALEDITADO', '0');
                    cData += XML.montaTag('VALORDESCCONDICONALITM', '0.0000');
                    cData += XML.montaTag('VALORDESPCONDICIONALITM', '0.0000');
                    cData += XML.montaTag('CODTBORCAMENTO', codigoDaNatureza);
                    cData += XML.montaTag('CODCOLTBORCAMENTO', '0');
                    cData += XML.montaTag('VALORUNTORCAMENTO', '0.0000');
                    cData += XML.montaTag('VALSERVICONFE', '0.0000');
                    cData += XML.montaTag('CODLOC', campos.localDeEstoque);
                    cData += XML.montaTag('VALORBEM', '0.0000');
                    cData += XML.montaTag('VALORLIQUIDO', totalDoItem); // PRECO UNITARIO X QTD
                    cData += XML.montaTag('RATEIOCCUSTODEPTO', totalDoItem); // PRECO UNITARIO X QTD
                    cData += XML.montaTag('VALORBRUTOITEMORIG', totalDoItem); // PRECO UNITARIO X QTD
                    cData += XML.montaTag('QUANTIDADETOTAL', '0.0000');
                    cData += XML.montaTag('PRODUTOSUBSTITUTO', '0');
                    cData += XML.montaTag('PRECOUNITARIOSELEC', '0');
                    cData += XML.montaTag('QUANTIDADECONCLUIDA', qtdDoItem);
                    cData += XML.montaTag('INTEGRAAPLICACAO', "T");
                    cData += XML.montaTag('VALORBASEDEPRECIACAOBEM', '0');
                    cData += XML.montaTag('CODCOLIGADA1', CODCOLIGADA);
                    cData += XML.montaTag('IDMOVHST', '-1');
                    cData += XML.montaTag('NSEQITMMOV1', (i + 1).toString());
                cData += '</TITMMOV>'
                cData += '<TITMMOVRATCCU>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                    cData += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto);
                    cData += XML.montaTag('VALOR', totalDoItem); // PRECO UNITARIO X QTD
                    cData += XML.montaTag('IDMOVRATCCU', '-1');
                cData += '</TITMMOVRATCCU>'
                cData += '<TITMMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                cData += '</TITMMOVCOMPL>'
                // for (let j = 0; j < tributos.length; j++) {
                //     cData += '<TTRBITMMOV>';
                //         cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA); 
                //         cData += XML.montaTag('IDMOV', '-1');  
                //         cData += XML.montaTag('NSEQITMMOV', (i + 1).toString());   
                //         cData += XML.montaTag('CODTRB', tributos[j]);
                //         cData += XML.montaTag('BASEDECALCULO', totalDoItem);
                //         cData += XML.montaTag('VALOR', '0.0000');    
                //         cData += XML.montaTag('FATORREDUCAO', '0.0000');
                //         cData += XML.montaTag('FATORSUBSTTRIB', '0.0000');
                //         cData += XML.montaTag('BASEDECALCULOCALCULADA', totalDoItem);
                //         cData += XML.montaTag('EDITADO', '0');
                //         cData += XML.montaTag('PERCDIFERIMENTOPARCIALICMS', '0.0000');
                //         cData += XML.montaTag('BASECHEIA', '0.0000');
                //     cData += '</TTRBITMMOV>';
                // }
                cData += '<TITMMOVFISCAL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                    cData += XML.montaTag('QTDECONTRATADA', '0.0000');
                    cData += XML.montaTag('VLRTOTTRIB', '0.0000');
                    cData += XML.montaTag('AQUISICAOPAA', '0');
                    cData += XML.montaTag('POEBTRIBUTAVEL', '1');
                cData += '</TITMMOVFISCAL>';
            }

            cData += '<TMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                    cData += XML.montaTag('IDMOV', '-1');
                    cData += XML.montaTag('TICKET', campos.ticketRaiz);
                    cData += XML.montaTag('LINKDOCUMENTO', (campos.linkDaSolicitacao).slice(0, 255));
            cData += '</TMOVCOMPL>'
            cData += '<TMOVTRANSP>'
                cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                cData += XML.montaTag('IDMOV', '-1')
                cData += XML.montaTag('RETIRAMERCADORIA', '0')
                cData += XML.montaTag('TIPOCTE', '0')
                cData += XML.montaTag('TOMADORTIPO', '0')
                cData += XML.montaTag('TIPOEMITENTEMDFE', '0')
                cData += XML.montaTag('LOTACAO', '1')
                cData += XML.montaTag('TIPOTRANSPORTADORMDFE', '0')
                cData += XML.montaTag('TIPOBPE', '0')
            cData += '</TMOVTRANSP>'
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
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISO(campos.dataInstancia))
                    cData += XML.montaTag('DATASAIDA', DATE.toISO(campos.dataInstancia))
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
                        cData += XML.montaTag('PRECOUNITARIO', valorDoItem); // PRECO UNITARIO
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
                    cData += XML.montaTag('NUMEROMOV', (campos.numeroDaNF).slice(0, 9))
                    cData += XML.montaTag('SERIE', campos.serie)
                    cData += XML.montaTag('CHAVEACESSONFE', campos.chaveDeAcesso.replace(/\s+/g, ''))
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeEmissao))
                    cData += XML.montaTag('DATASAIDA', DATE.toISO(campos.dataInstancia))
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
                    cData += XML.montaTag('DATASAIDA', DATE.toISO(campos.dataInstancia))
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
                    cData += XML.montaTag('DATASAIDA', DATE.toISO(campos.dataInstancia))
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
                    cData += XML.montaTag('NUMEROMOV', campos.numeroDaNF)
                    cData += XML.montaTag('SERIE', 'AL')
                    cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeEmissao))
                    cData += XML.montaTag('DATASAIDA', DATE.toISO(campos.dataInstancia))
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
                    cData += XML.montaTag('DATASAIDA', DATE.toISO(campos.dataInstancia))
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
                    let totalDoItem = (listaDeItens[i] as { totalDoItem: string }).totalDoItem;
            
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
        let listaDeItens = campos.itens as object[];
    
        var cData = '';
        cData += '<![CDATA['
            cData += '<MovMovimento>'
                cData += '<TMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('CODFILIAL', CODFILIAL)
                    cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                    cData += XML.montaTag('NUMEROMOV', '-1')
                    cData += XML.montaTag('CODTMV', campos.codigoDoMovimento)
                    cData += XML.montaTag('DATAEMISSAO', DATE.toISOSimple(campos.dataDeEmissao))
                    cData += XML.montaTag('DATASAIDA', DATE.toISO(campos.dataInstancia))
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