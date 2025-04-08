import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as wsDataserver from '../../../utils/wsDataserver';
import * as XML from '../../../utils/xml';
import * as UTILS from '../../../utils/function';
import * as date from '../../../utils/date';
import { stringify } from 'querystring';

const dataServer = new wsDataserver.wsDataserver();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const campos = JSON.parse(event.body as string);

        const ESTOQUE = campos.codigoDaColigada == '1'
            ? `${(campos.filialDeEntrega as string).split(" - ")[0]}.001`
            : `${(campos.unidadeFilial as string).split(" - ")[0]}.001`;

        const HISTORICOCURTO = campos.informacoes;

        const CODCOLIGADA = campos.codigoDaColigada == '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        const CODFILIAL = campos.codigoDaColigada == '1'
            ? campos.codigoDaFilial2 || ''
            : campos.codigoDaFilial || '';

        const CODTMV = campos.codigoDoMovimento;

        const SERIE = campos.serie;

        const OC = campos.ordemDeCompra;

        const AD = campos.adiantamento;
        // const valorTotal = UTILS.moedaParaFloat(campos.valorTotal);
        const valorTotal = campos.valorTotal;

        //let listaDeItens = XML.criaItensSC(campos.itens as string)
        let listaDeItens = campos.itens as object[];
        const tributos = ['ICMS', 'IPI'];

        var xmlContent = ''
        for (let i = 0; i < listaDeItens.length; i++) {
            let codigoDoItem = (listaDeItens[i] as { codigoDoItem: string }).codigoDoItem;
            let qtdDoItem = (listaDeItens[i] as { qtdDoItem: string }).qtdDoItem;
            let valorDoItem = (listaDeItens[i] as { valorDoItem: string }).valorDoItem;
            let totalDoItem = (listaDeItens[i] as { totalDoItem: string }).totalDoItem;

            xmlContent += '<TITMMOV>'
                xmlContent += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                xmlContent += XML.montaTag('IDMOV', '-1');
                xmlContent += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                xmlContent += XML.montaTag('CODFILIAL', CODFILIAL);
                xmlContent += XML.montaTag('NUMEROSEQUENCIAL', (i + 1).toString());
                xmlContent += XML.montaTag('IDPRD', codigoDoItem);
                xmlContent += XML.montaTag('QUANTIDADE', qtdDoItem);
                xmlContent += XML.montaTag('PRECOUNITARIO', valorDoItem); // PRECO UNITARIO
                xmlContent += XML.montaTag('PRECOTABELA', '0.0000');
                xmlContent += XML.montaTag('DATAEMISSAO', date.getDateTime());
                xmlContent += XML.montaTag('CODUND', 'UN');
                xmlContent += XML.montaTag('QUANTIDADEARECEBER', qtdDoItem);
                xmlContent += XML.montaTag('VALORUNITARIO', '0.0000');
                xmlContent += XML.montaTag('VALORFINANCEIRO', '0.0000');
                xmlContent += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto);
                xmlContent += XML.montaTag('ALIQORDENACAO', '0.0000');
                xmlContent += XML.montaTag('QUANTIDADEORIGINAL', qtdDoItem);
                xmlContent += XML.montaTag('FLAG', '0');
                xmlContent += XML.montaTag('FATORCONVUND', '0.0000');
                xmlContent += XML.montaTag('VALORBRUTOITEM', '0.0000'); 
                xmlContent += XML.montaTag('VALORTOTALITEM', totalDoItem);// PRECO UNITARIO X QTD
                xmlContent += XML.montaTag('QUANTIDADESEPARADA', totalDoItem); // PRECO UNITARIO X QTD
                xmlContent += XML.montaTag('COMISSAOREPRES', '0.0000');
                xmlContent += XML.montaTag('VALORESCRITURACAO', '0.0000');
                xmlContent += XML.montaTag('VALORFINPEDIDO', '0.0000');
                xmlContent += XML.montaTag('VALOROPFRM1', '0.0000');
                xmlContent += XML.montaTag('VALOROPFRM2', '0.0000');
                xmlContent += XML.montaTag('PRECOEDITADO', '0');
                xmlContent += XML.montaTag('QTDEVOLUMEUNITARIO', qtdDoItem);
                xmlContent += XML.montaTag('CODVEN1', campos.codigoDoComprador);
                xmlContent += XML.montaTag('PRECOTOTALEDITADO', '0');
                xmlContent += XML.montaTag('VALORDESCCONDICONALITM', '0.0000');
                xmlContent += XML.montaTag('VALORDESPCONDICIONALITM', '0.0000');
                xmlContent += XML.montaTag('CODTBORCAMENTO', campos.codigoDaNatureza);
                xmlContent += XML.montaTag('CODCOLTBORCAMENTO', '0');
                xmlContent += XML.montaTag('VALORUNTORCAMENTO', '0.0000');
                xmlContent += XML.montaTag('VALSERVICONFE', '0.0000');
                xmlContent += XML.montaTag('CODLOC', ESTOQUE);
                xmlContent += XML.montaTag('VALORBEM', '0.0000');
                xmlContent += XML.montaTag('VALORLIQUIDO', totalDoItem); // PRECO UNITARIO X QTD
                xmlContent += XML.montaTag('RATEIOCCUSTODEPTO', totalDoItem); // PRECO UNITARIO X QTD
                xmlContent += XML.montaTag('VALORBRUTOITEMORIG', totalDoItem); // PRECO UNITARIO X QTD
                xmlContent += XML.montaTag('QUANTIDADETOTAL', '0.0000');
                xmlContent += XML.montaTag('PRODUTOSUBSTITUTO', '0');
                xmlContent += XML.montaTag('PRECOUNITARIOSELEC', '0');
                xmlContent += XML.montaTag('QUANTIDADECONCLUIDA', qtdDoItem);
                xmlContent += XML.montaTag('INTEGRAAPLICACAO', "T");
                xmlContent += XML.montaTag('VALORBASEDEPRECIACAOBEM', '0');
                xmlContent += XML.montaTag('CODCOLIGADA1', CODCOLIGADA);
                xmlContent += XML.montaTag('IDMOVHST', '-1');
                xmlContent += XML.montaTag('NSEQITMMOV1', (i + 1).toString());
            xmlContent += '</TITMMOV>'
            xmlContent += '<TITMMOVRATCCU>'
                xmlContent += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                xmlContent += XML.montaTag('IDMOV', '-1');
                xmlContent += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                xmlContent += XML.montaTag('CODCCUSTO', campos.codigoDoCentroDeCusto);
                xmlContent += XML.montaTag('VALOR', totalDoItem); // PRECO UNITARIO X QTD
                xmlContent += XML.montaTag('IDMOVRATCCU', '-1');
            xmlContent += '</TITMMOVRATCCU>'
            xmlContent += '<TITMMOVCOMPL>'
                xmlContent += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                xmlContent += XML.montaTag('IDMOV', '-1');
                xmlContent += XML.montaTag('NSEQITMMOV', (i + 1).toString());
            xmlContent += '</TITMMOVCOMPL>'
            if(OC !== '' || AD !== ''){
                xmlContent += '<TITMMOVRELAC>'
                    xmlContent += XML.montaTag('IDMOVORIGEM', OC);
                    xmlContent += XML.montaTag('NSEQITMMOVORIGEM', (i + 1).toString());
                    xmlContent += XML.montaTag('CODCOLORIGEM', CODCOLIGADA);
                    xmlContent += XML.montaTag('IDMOVDESTINO', '-1');
                    xmlContent += XML.montaTag('NSEQITMMOVDESTINO', (i + 1).toString());
                    xmlContent += XML.montaTag('CODCOLDESTINO', CODCOLIGADA);
                    xmlContent += XML.montaTag('QUANTIDADE', qtdDoItem);
                xmlContent += '</TITMMOVRELAC>'
            }
            for (let j = 0; j < tributos.length; j++) {
                xmlContent += '<TTRBITMMOV>';
                    xmlContent += XML.montaTag('CODCOLIGADA', CODCOLIGADA); 
                    xmlContent += XML.montaTag('IDMOV', '-1');  
                    xmlContent += XML.montaTag('NSEQITMMOV', (i + 1).toString());   
                    xmlContent += XML.montaTag('CODTRB', tributos[j]);
                    xmlContent += XML.montaTag('BASEDECALCULO', totalDoItem);
                    xmlContent += XML.montaTag('VALOR', '0.0000');    
                    xmlContent += XML.montaTag('FATORREDUCAO', '0.0000');
                    xmlContent += XML.montaTag('FATORSUBSTTRIB', '0.0000');
                    xmlContent += XML.montaTag('BASEDECALCULOCALCULADA', totalDoItem);
                    xmlContent += XML.montaTag('EDITADO', '0');
                    xmlContent += XML.montaTag('PERCDIFERIMENTOPARCIALICMS', '0.0000');
                    xmlContent += XML.montaTag('BASECHEIA', '0.0000');
                xmlContent += '</TTRBITMMOV>';
            }
            xmlContent += '<TITMMOVFISCAL>'
                xmlContent += XML.montaTag('CODCOLIGADA', CODCOLIGADA);
                xmlContent += XML.montaTag('IDMOV', '-1');
                xmlContent += XML.montaTag('NSEQITMMOV', (i + 1).toString());
                xmlContent += XML.montaTag('QTDECONTRATADA', '0.0000');
                xmlContent += XML.montaTag('VLRTOTTRIB', '0.0000');
                xmlContent += XML.montaTag('AQUISICAOPAA', '0');
                xmlContent += XML.montaTag('POEBTRIBUTAVEL', '1');
            xmlContent += '</TITMMOVFISCAL>';
        }

        var cData = '';

        cData += '<![CDATA['
            cData += '<MovMovimento>'
                cData += '<TMOV>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('CODFILIAL', CODFILIAL)
                    cData += XML.montaTag('CODLOC', ESTOQUE)
                    cData += XML.montaTag('CODLOCDESTINO', ESTOQUE)
                    cData += XML.montaTag('CODCFO', campos.codigoDoFornecedor)
                    cData += XML.montaTag('NUMEROMOV', '-1')
                    cData += XML.montaTag('SERIE', SERIE)
                    cData += XML.montaTag('CODTMV', CODTMV)
                    cData += XML.montaTag('TIPO', 'A')
                    cData += XML.montaTag('MOVIMPRESSO', '0')
                    cData += XML.montaTag('DOCIMPRESSO', '0')
                    cData += XML.montaTag('FATIMPRESSA', '0')
                    cData += XML.montaTag('DATAEMISSAO', date.getDateTime())
                    cData += XML.montaTag('COMISSAOREPRES', '0.0000')
                    cData += XML.montaTag('CODCPG', campos.codigoDaFormaPagamento)
                    cData += XML.montaTag('VALORBRUTO', valorTotal)
                    cData += XML.montaTag('VALORLIQUIDO', valorTotal)
                    cData += XML.montaTag('VALOROUTROS', valorTotal)
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
                    cData += XML.montaTag('DATAMOVIMENTO', date.getDateTime())
                    cData += XML.montaTag('GEROUFATURA', '0')
                    cData += XML.montaTag('NUMEROLCTABERTO', '1')
                    cData += XML.montaTag('CODCFOAUX', campos.codigoDoFornecedor)
                    cData += XML.montaTag('VALORRECEBIDO', valorTotal)
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
                    cData += XML.montaTag('HORULTIMAALTERACAO', date.getDateTime())
                    cData += XML.montaTag('INDUSOOBJ', '0.00')
                    cData += XML.montaTag('INTEGRADOBONUM', '0')
                    cData += XML.montaTag('FLAGPROCESSADO', '0')
                    cData += XML.montaTag('ABATIMENTOICMS', '0.0000')
                    cData += XML.montaTag('HORARIOEMISSAO', date.getDateTime())
                    cData += XML.montaTag('USUARIOCRIACAO', 'p_heflo')
                    cData += XML.montaTag('STSEMAIL', '0.0000')
                    cData += XML.montaTag('VALORBRUTOINTERNO', valorTotal)
                    cData += XML.montaTag('VINCULADOESTOQUEFL', '0.0000')
                    cData += XML.montaTag('VRBASEINSSOUTRAEMPRESA', '0.0000')
                    cData += XML.montaTag('VALORDESCCONDICIONAL', '0.0000')
                    cData += XML.montaTag('VALORDESPCONDICIONAL', '0.0000')
                    cData += XML.montaTag('INTEGRADOAUTOMACAO', '0.0000')
                    cData += XML.montaTag('INTEGRAAPLICACAO', 'T')
                    cData += XML.montaTag('DATALANCAMENTO', date.getDateTime())
                    cData += XML.montaTag('RECIBONFESTATUS', '0')
                    cData += XML.montaTag('VALORMERCADORIAS', '0.0000')
                    cData += XML.montaTag('USARATEIOVALORFIN', '1')
                    cData += XML.montaTag('CODCOLCFOAUX', '0')
                    cData += XML.montaTag('VALORRATEIOLAN', valorTotal)
                    cData += XML.montaTag('RATEIOCCUSTODEPTO', valorTotal)
                    cData += XML.montaTag('VALORBRUTOORIG', valorTotal)
                    cData += XML.montaTag('VALORLIQUIDOORIG', valorTotal)
                    cData += XML.montaTag('VALOROUTROSORIG', valorTotal)
                    cData += XML.montaTag('VALORRATEIOLANORIG', valorTotal)
                    cData += XML.montaTag('HISTORICOCURTO', HISTORICOCURTO)
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
                    cData += XML.montaTag('VALOR', valorTotal)
                    cData += XML.montaTag('IDMOVRATCCU', '-1')
                cData += '</TMOVRATCCU>'
                if(SERIE == "PR"){
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
                        cData += XML.montaTag('DATAVENCIMENTO', '2025-04-08T00:00:00');
                        cData += XML.montaTag('TIPOPAGAMENTO', '1');
                        cData += XML.montaTag('VALOR', valorTotal);
                        cData += XML.montaTag('DEBITOCREDITO', 'C');
                        cData += XML.montaTag('IDSEQPAGTO1', '-1');
                    cData += '</TMOVPAGTO>'
                }
                cData += xmlContent // ITENS DO MOVIMENTO
                cData += '<TMOVCOMPL>'
                    cData += XML.montaTag('CODCOLIGADA', CODCOLIGADA)
                    cData += XML.montaTag('IDMOV', '-1')
                    cData += XML.montaTag('MULTIPLO', 'N')
                    cData += XML.montaTag('HEFLO', campos.ticketRaiz)
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

        let result = await dataServer.saveRecord(cData, 'MovMovimentoTBCData', `CODCOLIGADA=${CODCOLIGADA};CODUSUARIO=p_heflo`);

        if (!(result).includes('=')) {
            let PG = result.split(';')[1]
            return formatResponse(200, { PG });
        } else {
            const matchResult = result.match(/^[^\r\n]+/);
            if (!matchResult) {
                throw new Error('Failed to extract error message from result');
            }
            const error = matchResult[0];
            return formatResponse(400, { message: 'Internal Server Error', error: error });
        }
    } catch (error) {
        return formatResponse(500, {  message: 'Internal Server Error',  error: error instanceof Error ? error.message : String(error) });
    }
};