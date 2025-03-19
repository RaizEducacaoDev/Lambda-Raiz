import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classRm';
import * as XML from '../../../utils/xml';
import axios from 'axios';

const ConfigManagerRm = new CLASSES.ConfigManagerRm();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const campos = JSON.parse(event.body as string);

        const ESTOQUE = campos.codigoDaColigada === '1'
            ? `${(campos.filialDeEntrega as string).split(" - ")[0]}.001`
            : `${(campos.unidadeFilial as string).split(" - ")[0]}.001`;

        const HISTORICOCURTO = campos.tipoDeSolicitacao === 'P'
            ? `MOTIVO DA SOLICITAÇÃO: ${campos.motivoDaSolicitacao}`
            : `MOTIVO DA SOLICITAÇÃO: ${campos.motivoDaSolicitacao}
        DESCRIÇÃO DO SERVIÇO: ${campos.descricaoDoServico}`

        const CODCOLIGADA = campos.codigoDaColigada === '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        const CODFILIAL = campos.codigoDaColigada === '1'
            ? campos.codigoDaFilial2 || ''
            : campos.codigoDaFilial || '';

        const CODTMV = campos.tipoDeSolicitacao === 'P'
            ? '1.1.03'
            : '1.1.04';

        //let listaDeItens = XML.criaItensSC(campos.itens as string)
        let listaDeItens = campos.itens as object[];

        var xmlContent = ''
        for (let i = 0; i < listaDeItens.length; i++) {
            xmlContent +=
                `<TITMMOV>
                <CODCOLIGADA>${CODCOLIGADA}</CODCOLIGADA>
                <IDMOV>-1</IDMOV>
                <NSEQITMMOV>${i + 1}</NSEQITMMOV>
                <CODFILIAL>${CODFILIAL}</CODFILIAL>
                <NUMEROSEQUENCIAL>${i + 1}</NUMEROSEQUENCIAL>
                <IDPRD>${(listaDeItens[i] as { codigoDoItem: string }).codigoDoItem}</IDPRD>
                <QUANTIDADE>${(listaDeItens[i] as { qtdDoItem: number }).qtdDoItem}</QUANTIDADE>
                <PRECOUNITARIO>0.0000000000</PRECOUNITARIO>
                <PRECOTABELA>0.0000</PRECOTABELA>
                <VALORDESC>0.0000</VALORDESC>
                <QUANTIDADEARECEBER>${(listaDeItens[i] as { qtdDoItem: number }).qtdDoItem}</QUANTIDADEARECEBER>
                <VALORUNITARIO>0.0000</VALORUNITARIO>
                <VALORFINANCEIRO>0.0000</VALORFINANCEIRO>
                <CODCCUSTO>${campos.codigoDoCentroDeCusto}</CODCCUSTO>
                <ALIQORDENACAO>0.0000</ALIQORDENACAO>
                <QUANTIDADEORIGINAL>${(listaDeItens[i] as { qtdDoItem: number }).qtdDoItem}</QUANTIDADEORIGINAL>
                <FLAG>0</FLAG>
                <FATORCONVUND>0.0000</FATORCONVUND>
                <VALORBRUTOITEM>0.0000000000</VALORBRUTOITEM>
                <VALORTOTALITEM>0.0000000000</VALORTOTALITEM>
                <QUANTIDADESEPARADA>0.0000</QUANTIDADESEPARADA>
                <COMISSAOREPRES>0.0000</COMISSAOREPRES>
                <VALORESCRITURACAO>0.0000</VALORESCRITURACAO>
                <VALORFINPEDIDO>0.0000</VALORFINPEDIDO>
                <VALOROPFRM1>0.0000</VALOROPFRM1>
                <VALOROPFRM2>0.0000</VALOROPFRM2>
                <PRECOEDITADO>0</PRECOEDITADO>
                <QTDEVOLUMEUNITARIO>1</QTDEVOLUMEUNITARIO>
                <CODVEN1>${campos.codigoDoComprador}</CODVEN1>
                <PRECOTOTALEDITADO>0</PRECOTOTALEDITADO>
                <VALORDESCCONDICONALITM>0.0000</VALORDESCCONDICONALITM>
                <VALORDESPCONDICIONALITM>0.0000</VALORDESPCONDICIONALITM>
                <CODTBORCAMENTO>${campos.codigoDaNatureza}</CODTBORCAMENTO>
                <CODCOLTBORCAMENTO>0</CODCOLTBORCAMENTO>
                <VALORUNTORCAMENTO>0.0000</VALORUNTORCAMENTO>
                <VALSERVICONFE>0.0000</VALSERVICONFE>
                <CODLOC>${ESTOQUE}</CODLOC>
                <VALORBEM>0.0000</VALORBEM>
                <VALORLIQUIDO>0.0000</VALORLIQUIDO>
                <HISTORICOCURTO>${HISTORICOCURTO}</HISTORICOCURTO>
                <RATEIOCCUSTODEPTO>0.0000</RATEIOCCUSTODEPTO>
                <VALORBRUTOITEMORIG>0.0000000000</VALORBRUTOITEMORIG>
                <QUANTIDADETOTAL>${(listaDeItens[i] as { qtdDoItem: number }).qtdDoItem}</QUANTIDADETOTAL>
                <PRODUTOSUBSTITUTO>0</PRODUTOSUBSTITUTO>
                <PRECOUNITARIOSELEC>2</PRECOUNITARIOSELEC>
                <INTEGRAAPLICACAO>T</INTEGRAAPLICACAO>
                <VALORBASEDEPRECIACAOBEM>0.0000</VALORBASEDEPRECIACAOBEM>
                <CODCOLIGADA1>${CODCOLIGADA}</CODCOLIGADA1>
                <IDMOVHST>-1</IDMOVHST>
                <NSEQITMMOV1>${i + 1}</NSEQITMMOV1>
            </TITMMOV>
                <TITMMOVRATCCU>
                <CODCOLIGADA>${CODCOLIGADA}</CODCOLIGADA>
                <IDMOV>-1</IDMOV>
                <NSEQITMMOV>${i + 1}</NSEQITMMOV>
                <CODCCUSTO>${campos.codigoDoCentroDeCusto}</CODCCUSTO>
                <VALOR>0.0000</VALOR>
                <IDMOVRATCCU>-1</IDMOVRATCCU>
                </TITMMOVRATCCU>
                <TITMMOVCOMPL>
                <CODCOLIGADA>${CODCOLIGADA}</CODCOLIGADA>
                <IDMOV>-1</IDMOV>
                <NSEQITMMOV>${i + 1}</NSEQITMMOV>
            </TITMMOVCOMPL>
            <TITMMOVFISCAL>
                <CODCOLIGADA>${CODCOLIGADA}</CODCOLIGADA>
                <IDMOV>-1</IDMOV>
                <NSEQITMMOV>${i + 1}</NSEQITMMOV>
                <QTDECONTRATADA>0.0000</QTDECONTRATADA>
                <VLRTOTTRIB>0.0000</VLRTOTTRIB>
                <AQUISICAOPAA>0</AQUISICAOPAA>
                <POEBTRIBUTAVEL>1</POEBTRIBUTAVEL>
            </TITMMOVFISCAL>`;
        }

        var soapEnvelope =
            `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
            <soapenv:Header/>
            <soapenv:Body>
                <tot:SaveRecord>
                    <tot:DataServerName>MovMovimentoTBCData</tot:DataServerName>
                    <tot:XML>
                        <![CDATA[
                            <MovMovimento>
                                <TMOV>
                                    <CODCOLIGADA>${CODCOLIGADA}</CODCOLIGADA>
                                    <IDMOV>-1</IDMOV>
                                    <CODFILIAL>${CODFILIAL}</CODFILIAL>
                                    <CODLOC>${ESTOQUE}</CODLOC>
                                    <CODLOCDESTINO>${ESTOQUE}</CODLOCDESTINO>
                                    <NUMEROMOV>-1</NUMEROMOV>
                                    <SERIE>SC</SERIE>
                                    <CODTMV>${CODTMV}</CODTMV>
                                    <TIPO>${campos.tipoDeSolicitacao}</TIPO>
                                    <STATUS>A</STATUS>
                                    <MOVIMPRESSO>0</MOVIMPRESSO>
                                    <DOCIMPRESSO>0</DOCIMPRESSO>
                                    <FATIMPRESSA>0</FATIMPRESSA>
                                    <COMISSAOREPRES>0.0000</COMISSAOREPRES>
                                    <VALORBRUTO>0.0000</VALORBRUTO>
                                    <VALORLIQUIDO>0.0000</VALORLIQUIDO>
                                    <VALOROUTROS>0.0000</VALOROUTROS>
                                    <PERCCOMISSAO>0.0000</PERCCOMISSAO>
                                    <CODMEN>01</CODMEN>
                                    <PESOLIQUIDO>0.0000</PESOLIQUIDO>
                                    <PESOBRUTO>0.0000</PESOBRUTO>
                                    <CODMOEVALORLIQUIDO>R$</CODMOEVALORLIQUIDO>
                                    <GEROUFATURA>0</GEROUFATURA>
                                    <CODCFOAUX>CXXXXXXXXXX</CODCFOAUX>
                                    <CODCCUSTO>${campos.codigoDoCentroDeCusto}</CODCCUSTO>
                                    <CODVEN1>${campos.codigoDoComprador}</CODVEN1>
                                    <PERCCOMISSAOVEN2>0.0000</PERCCOMISSAOVEN2>
                                    <CODUSUARIO>p_heflo</CODUSUARIO>
                                    <CODFILIALDESTINO>${CODFILIAL}</CODFILIALDESTINO>
                                    <GERADOPORLOTE>0</GERADOPORLOTE>
                                    <STATUSEXPORTCONT>0</STATUSEXPORTCONT>
                                    <GEROUCONTATRABALHO>0</GEROUCONTATRABALHO>
                                    <GERADOPORCONTATRABALHO>0</GERADOPORCONTATRABALHO>
                                    <INDUSOOBJ>0.00</INDUSOOBJ>
                                    <INTEGRADOBONUM>0</INTEGRADOBONUM>
                                    <FLAGPROCESSADO>0</FLAGPROCESSADO>
                                    <ABATIMENTOICMS>0.0000</ABATIMENTOICMS>
                                    <USUARIOCRIACAO>p_heflo</USUARIOCRIACAO>
                                    <STSEMAIL>0</STSEMAIL>
                                    <VALORBRUTOINTERNO>0.0000</VALORBRUTOINTERNO>
                                    <VINCULADOESTOQUEFL>0</VINCULADOESTOQUEFL>
                                    <VRBASEINSSOUTRAEMPRESA>0.0000</VRBASEINSSOUTRAEMPRESA>
                                    <VALORDESCCONDICIONAL>0.0000</VALORDESCCONDICIONAL>
                                    <VALORDESPCONDICIONAL>0.0000</VALORDESPCONDICIONAL>
                                    <INTEGRADOAUTOMACAO>0</INTEGRADOAUTOMACAO>
                                    <INTEGRAAPLICACAO>T</INTEGRAAPLICACAO>
                                    <RECIBONFESTATUS>0</RECIBONFESTATUS>
                                    <VALORMERCADORIAS>0.0000</VALORMERCADORIAS>
                                    <USARATEIOVALORFIN>0</USARATEIOVALORFIN>
                                    <CODCOLCFOAUX>0</CODCOLCFOAUX>
                                    <HISTORICOCURTO>${HISTORICOCURTO}</HISTORICOCURTO>
                                    <RATEIOCCUSTODEPTO>0.0000</RATEIOCCUSTODEPTO>
                                    <VALORBRUTOORIG>0.0000</VALORBRUTOORIG>
                                    <VALORLIQUIDOORIG>0.0000</VALORLIQUIDOORIG>
                                    <VALOROUTROSORIG>0.0000</VALOROUTROSORIG>
                                    <FLAGCONCLUSAO>0</FLAGCONCLUSAO>
                                    <STATUSPARADIGMA>N</STATUSPARADIGMA>
                                    <STATUSINTEGRACAO>N</STATUSINTEGRACAO>
                                    <PERCCOMISSAOVEN3>0.0000</PERCCOMISSAOVEN3>
                                    <PERCCOMISSAOVEN4>0.0000</PERCCOMISSAOVEN4>
                                    <CODCOLIGADA1>${CODCOLIGADA}</CODCOLIGADA1>
                                    <IDMOVHST>-1</IDMOVHST>
                                </TMOV>
                                <TNFE>
                                    <CODCOLIGADA>${CODCOLIGADA}</CODCOLIGADA>
                                    <IDMOV>-1</IDMOV>
                                    <VALORSERVICO>0.0000</VALORSERVICO>
                                    <DEDUCAOSERVICO>0.0000</DEDUCAOSERVICO>
                                    <ALIQUOTAISS>0.0000</ALIQUOTAISS>
                                    <ISSRETIDO>0</ISSRETIDO>
                                    <VALORISS>0.0000</VALORISS>
                                    <VALORCREDITOIPTU>0.0000</VALORCREDITOIPTU>
                                    <BASEDECALCULO>0.0000</BASEDECALCULO>
                                    <EDITADO>0</EDITADO>
                                </TNFE>
                                <TMOVFISCAL>
                                    <CODCOLIGADA>${CODCOLIGADA}</CODCOLIGADA>
                                    <IDMOV>-1</IDMOV>
                                    <CONTRIBUINTECREDENCIADO>0</CONTRIBUINTECREDENCIADO>
                                    <OPERACAOCONSUMIDORFINAL>0</OPERACAOCONSUMIDORFINAL>
                                    <OPERACAOPRESENCIAL>0</OPERACAOPRESENCIAL>
                                </TMOVFISCAL>
                                <TMOVRATCCU>
                                    <CODCOLIGADA>${CODCOLIGADA}</CODCOLIGADA>
                                    <IDMOV>-1</IDMOV>
                                    <CODCCUSTO>${campos.codigoDoCentroDeCusto}</CODCCUSTO>
                                    <VALOR>0.0000</VALOR>
                                    <IDMOVRATCCU>-1</IDMOVRATCCU>
                                </TMOVRATCCU>
                                ${xmlContent}
                                <TMOVCOMPL>
                                    <CODCOLIGADA>${CODCOLIGADA}</CODCOLIGADA>
                                    <IDMOV>-1</IDMOV>
                                    <MULTIPLO>N</MULTIPLO>
                                    <HEFLO>${campos.ticketRaiz}</HEFLO>
                                </TMOVCOMPL>
                                <TMOVTRANSP>
                                    <CODCOLIGADA>${CODCOLIGADA}</CODCOLIGADA>
                                    <IDMOV>-1</IDMOV>
                                    <RETIRAMERCADORIA>0</RETIRAMERCADORIA>
                                    <TIPOCTE>0</TIPOCTE>
                                    <TOMADORTIPO>0</TOMADORTIPO>
                                    <TIPOEMITENTEMDFE>0</TIPOEMITENTEMDFE>
                                    <LOTACAO>1</LOTACAO>
                                    <TIPOTRANSPORTADORMDFE>0</TIPOTRANSPORTADORMDFE>
                                    <TIPOBPE>0</TIPOBPE>
                                </TMOVTRANSP>
                            </MovMovimento>
                        ]]>
                    </tot:XML>
                    <tot:Contexto>codusuario=p_heflo;codsistema=T;codcoligada=${CODCOLIGADA}</tot:Contexto>
                </tot:SaveRecord>
            </soapenv:Body>
        </soapenv:Envelope>`;

        //console.log(soapEnvelope)

        let respostas = await axios.post(
            `${ConfigManagerRm.getUrl()}:8051/wsDataServer/IwsDataServer`,
            soapEnvelope,
            {
                headers: {
                    'Authorization': `Basic ${ConfigManagerRm.getCredentials()}`,
                    'Content-Type': 'text/xml;charset=UTF-8',
                    'SOAPAction': 'http://www.totvs.com/IwsDataServer/SaveRecord',
                }
            }
        );

        let result = respostas.data
        result = await XML.buscaResultado(result)

        if (!result.includes('=')) {
            let SC = result.split(';')[1]
            return formatResponse(200, { SC });
        } else {
            let error = result.match(/^[^\r\n]+/)[0];
            return formatResponse(400, { message: 'Internal Server Error', error: error });
        }
    } catch (error) {
        return formatResponse(500, {  message: 'Internal Server Error',  error: error instanceof Error ? error.message : String(error) });
    }
};