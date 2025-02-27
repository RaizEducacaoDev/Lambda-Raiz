import 'source-map-support/register';
import type { ValidatedEventAPIGatewayProxyEvent } from '@libs/apiGateway';
import { formatJSONResponse } from '@libs/apiGateway';
import { middyfy } from '@libs/lambda';
import schema from '@libs/schema';
import axios from 'axios';
import * as FUNCTIONS from 'src/utilities/functions'
import * as CLASSES from 'src/utilities/classes'
//import { error } from 'console';
// import btoa from 'btoa';
// import { upperCase } from 'lodash';

const ConfigManagerRm = new CLASSES.ConfigManagerRm();
const ConfigManagerGoogle = new CLASSES.ConfigManagerGoogle();
const retorno = formatJSONResponse({});

async event => { console.log(event); }

const solicitacaoDeCompra: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event) => {
    try {
        const campos = event.body;

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

        //let listaDeItens = FUNCTIONS.criaItensSC(campos.itens as string)
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
                <IDPRD>${listaDeItens[i]["codigoDoItem"]}</IDPRD>
                <QUANTIDADE>${listaDeItens[i]["qtdDoItem"]}</QUANTIDADE>
                <PRECOUNITARIO>0.0000000000</PRECOUNITARIO>
                <PRECOTABELA>0.0000</PRECOTABELA>
                <VALORDESC>0.0000</VALORDESC>
                <QUANTIDADEARECEBER>${listaDeItens[i]["qtdDoItem"]}</QUANTIDADEARECEBER>
                <VALORUNITARIO>0.0000</VALORUNITARIO>
                <VALORFINANCEIRO>0.0000</VALORFINANCEIRO>
                <CODCCUSTO>${campos.codigoDoCentroDeCusto}</CODCCUSTO>
                <ALIQORDENACAO>0.0000</ALIQORDENACAO>
                <QUANTIDADEORIGINAL>${listaDeItens[i]["qtdDoItem"]}</QUANTIDADEORIGINAL>
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
                <QUANTIDADETOTAL>${listaDeItens[i]["qtdDoItem"]}</QUANTIDADETOTAL>
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
        result = await FUNCTIONS.buscaResultado(result)

        if (result.includes('=')) {
            let error = result.match(/^[^\r\n]+/)[0];
            retorno.body = JSON.stringify({ message: 'Internal Server Error', error: error });
            retorno.statusCode = 500;
            return retorno
        } else {
            let SC = result.split(';')[1]
            retorno.body = JSON.stringify({ SC });
            //retorno.body = JSON.stringify(listaDeItens);
            retorno.statusCode = 200
            return retorno
        }
    } catch (error) {
        console.log(error)
        retorno.body = JSON.stringify(error);
    }
}
exports.solicitacaoDeCompra = middyfy(solicitacaoDeCompra);

const cotacao: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event) => {
    try {
        const campos = event.body;

        const CODCOLIGADA = campos.codigoDaColigada === '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        const CODFILIAL = campos.codigoDaColigada === '1'
            ? campos.codigoDaFilial2 || ''
            : campos.codigoDaFilial || '';

        const DESCRICAO = campos.tipoDeSolicitacao === 'P'
            ? `MOTIVO DA SOLICITAÇÃO: ${campos.motivoDaSolicitacao}`
            : `MOTIVO DA SOLICITAÇÃO: ${campos.motivoDaSolicitacao}
            DESCRIÇÃO DO SERVIÇO: ${campos.descricaoDoServico}`;
        
        const dataLimiteDeResposta = FUNCTIONS.convertToISOFormat(campos.dataLimiteDeResposta as string)

        const listaDeItens = campos.listaDeItens as object[];
        const listaDeFornecedores = campos.fornecedores as object[];

        let xmlItens = '';
        let xmlOrcamento = '';
        const maxLength = Math.max(listaDeItens.length, listaDeFornecedores.length);

        for (let i = 0; i < maxLength; i++) {
            // Construção de xmlItens
            if (i < listaDeItens.length) {
                xmlItens +=
                    `<a:CmpCotacaoItmMovPar>
                    <a:InternalId i:nil="true" />
                    <AAlistModified xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                        <b:string>CodColMov</b:string>
                        <b:string>IdMov</b:string>
                        <b:string>NSeqItmMov</b:string>
                        <b:string>TrocaMarca</b:string>
                        <b:string>CodCotacaoParadigma</b:string>
                        <b:string>CodItemCotacaoParadigma</b:string>
                        <b:string>CodMotivo</b:string>
                        <b:string>TipoMovCompras</b:string>
                    </AAlistModified>
                    <CodColigada>${CODCOLIGADA}</CodColigada>
                    <CodCotacao>-1</CodCotacao>
                    <CodUsuarioLogado i:nil="true" />
                    <CodColMov>${CODCOLIGADA}</CodColMov>
                    <CodCotacaoParadigma i:nil="true" />
                    <CodItemCotacaoParadigma i:nil="true" />
                    <CodMotivo i:nil="true" />
                    <IdMov>${campos.solicitacaoDeCompra}</IdMov>
                    <ItemOrcamento />
                    <NSeqItmMov>${i + 1}</NSeqItmMov>
                    <TipoMovCompras>1</TipoMovCompras>
                    <TrocaMarca>1</TrocaMarca>
                </a:CmpCotacaoItmMovPar>`;
            }

            // Construção de xmlOrcamento
            if (i < listaDeFornecedores.length) {
                xmlOrcamento +=
                    `<a:CmpOrcamentoPar>
                    <a:InternalId i:nil="true" />
                    <AAlistModified xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                        <b:string>CodColCfo</b:string>
                        <b:string>CodCfo</b:string>
                        <b:string>CodMoeda</b:string>
                        <b:string>AliqFixaDiferencial</b:string>
                        <b:string>CodColFilial</b:string>
                        <b:string>CodColFilialNeg</b:string>
                        <b:string>CodCpg</b:string>
                        <b:string>CodCpgNegociada</b:string>
                        <b:string>CodFilial</b:string>
                        <b:string>CodFilialNeg</b:string>
                        <b:string>CodLoc</b:string>
                        <b:string>CodLocNeg</b:string>
                        <b:string>CodMovimentoCfo</b:string>
                        <b:string>CodTra</b:string>
                        <b:string>DatEntrega</b:string>
                        <b:string>DataEntregaOrc</b:string>
                        <b:string>Despesa</b:string>
                        <b:string>DscContato</b:string>
                        <b:string>DthUltEnvio</b:string>
                        <b:string>FormaComunicacao</b:string>
                        <b:string>FreteCifouFob</b:string>
                        <b:string>ItemOrcamentoAgrupado</b:string>
                        <b:string>PercDescNeg</b:string>
                        <b:string>PercDescOrc</b:string>
                        <b:string>StEmailOrdCompra</b:string>
                        <b:string>StEmailPedOrc</b:string>
                        <b:string>StEmailQuadroComp</b:string>
                        <b:string>StatusResposta</b:string>
                        <b:string>TxtObservacao</b:string>
                        <b:string>ValFrete</b:string>
                        <b:string>ValIcmsST</b:string>
                        <b:string>ValPrazoEntrega</b:string>
                        <b:string>ValPrazoValidade</b:string>
                        <b:string>ValTrb</b:string>
                        <b:string>ValorDesOcrc</b:string>
                        <b:string>ValorDescNeg</b:string>
                        <b:string>ValorFrete</b:string>
                        <b:string>telContato</b:string>
                    </AAlistModified>
                    <CodColigada>${CODCOLIGADA}</CodColigada>
                    <CodCotacao>-1</CodCotacao>
                    <CodUsuarioLogado i:nil="true" />
                    <AliqFixaDiferencial>0</AliqFixaDiferencial>
                    <CodCfo>${listaDeFornecedores[i]['codigoDoFornecedor']}</CodCfo>
                    <CodColCfo>0</CodColCfo>
                    <CodColFilial i:nil="true" />
                    <CodColFilialNeg i:nil="true" />
                    <CodCpg i:nil="true" />
                    <CodCpgNegociada i:nil="true" />
                    <CodFilial i:nil="true" />
                    <CodFilialNeg i:nil="true" />
                    <CodLoc i:nil="true" />
                    <CodLocNeg i:nil="true" />
                    <CodMoeda>R$</CodMoeda>
                    <CodMovimentoCfo />
                    <CodTra i:nil="true" />
                    <DatEntrega i:nil="true" />
                    <DataEntregaOrc i:nil="true" />
                    <Despesa>0</Despesa>
                    <DscContato />
                    <DthUltEnvio i:nil="true" />
                    <FormaComunicacao>0</FormaComunicacao>
                    <FreteCifouFob>-1</FreteCifouFob>
                    <ItemOrcamentoAgrupado i:nil="true" />
                    <PercDescNeg>0</PercDescNeg>
                    <PercDescOrc>0</PercDescOrc>
                    <StEmailOrdCompra>0</StEmailOrdCompra>
                    <StEmailPedOrc>0</StEmailPedOrc>
                    <StEmailQuadroComp>0</StEmailQuadroComp>
                    <StatusResposta i:nil="true" />
                    <TxtObservacao />
                    <ValFrete>0</ValFrete>
                    <ValIcmsST>0</ValIcmsST>
                    <ValPrazoEntrega>-1</ValPrazoEntrega>
                    <ValPrazoValidade>-1</ValPrazoValidade>
                    <ValTrb>-1</ValTrb>
                    <ValorDesOcrc>0</ValorDesOcrc>
                    <ValorDescNeg>0</ValorDescNeg>
                    <ValorFrete>0</ValorFrete>
                    <telContato />
                </a:CmpOrcamentoPar>`;
            }
        }

        let soapEnvelope =
            `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
            <soapenv:Header/>
            <soapenv:Body>
                <tot:ExecuteWithXmlParams>
                <tot:ProcessServerName>CmpAssistenteCotacaoProc</tot:ProcessServerName>
                <tot:strXmlParams>
                    <![CDATA[
                        <CmpAssistenteCotacaoParams xmlns="http://www.totvs.com.br/RM/"
                            xmlns:i="http://www.w3.org/2001/XMLSchema-instance"
                            xmlns:z="http://schemas.microsoft.com/2003/10/Serialization/">
                            <Context xmlns="http://www.totvs.com/" xmlns:a="http://www.totvs.com.br/RM/">
                                <a:_params xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$EXERCICIOFISCAL</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODLOCPRT</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODTIPOCURSO</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$EDUTIPOUSR</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUNIDADEBIB</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODCOLIGADA</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODCOLIGADA}</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$RHTIPOUSR</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODIGOEXTERNO</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODSISTEMA</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">T</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">
                                            $CODUSUARIOSERVICO</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema" />
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUSUARIO</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">p_heflo</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$IDPRJ</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">
                                            $CHAPAFUNCIONARIO</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODFILIAL</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODFILIAL}</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                </a:_params>
                                <a:Environment>DotNet</a:Environment>
                            </Context>
                            <Cotacao>
                                <InternalId i:nil="true" xmlns="http://www.totvs.com/" />
                                <AAlistModified xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays" />
                                <CodColigada>${CODCOLIGADA}</CodColigada>
                                <CodCotacao>-1</CodCotacao>
                                <CodUsuarioLogado>p_heflo</CodUsuarioLogado>
                                <CodComprador>${campos.codigoDoComprador}</CodComprador>
                                <CodCpg>${campos.codigoDoPagamento}</CodCpg>
                                <CodFilial>${CODFILIAL}</CodFilial>
                                <CodMoeda>R$</CodMoeda>
                                <CodTmv i:nil="true" />
                                <CodTra i:nil="true" />
                                <CreditarICMS>0</CreditarICMS>
                                <CreditarIPI>0</CreditarIPI>
                                <DatCotacao>${FUNCTIONS.getDateTime()}</DatCotacao>
                                <DatEntrega i:nil="true" />
                                <DatLimRespta>${dataLimiteDeResposta}</DatLimRespta>
                                <Descricao>${DESCRICAO}</Descricao>
                                <DispFornClicbusiness>false</DispFornClicbusiness>
                                <InclusaoAutomatica>false</InclusaoAutomatica>
                                <IntegradoAutomaticoParadigma>false</IntegradoAutomaticoParadigma>
                                <IntegradoClicbusiness>false</IntegradoClicbusiness>
                                <IntegradoParadigma>false</IntegradoParadigma>
                                <ItemCotacao xmlns:a="http://www.totvs.com/">${xmlItens}</ItemCotacao>
                                <Observacao i:nil="true" />
                                <Orcamento xmlns:a="http://www.totvs.com/">${xmlOrcamento}</Orcamento>
                                <SegundoNumero i:nil="true" />
                                <StatusAprovacao i:nil="true" />
                                <StsCotacao i:nil="true" />
                                <TipoJulgamento>${campos.tipoDeJulgamento == "Melhor oferta por produto" ? "P" : "G"}</TipoJulgamento>
                                <TxtObservacao>Triagem de Solicitação de Material</TxtObservacao>
                                <UltimaAtualizacao>${FUNCTIONS.getDateTime()}</UltimaAtualizacao>
                                <ValCustoFinanc>0</ValCustoFinanc>
                                <ValCustoFrete>0</ValCustoFrete>
                            </Cotacao>
                            <RetornoCodCotacao i:nil="true" />
                        </CmpAssistenteCotacaoParams>
                    ]]>
                </tot:strXmlParams>
                </tot:ExecuteWithXmlParams>
            </soapenv:Body>
        </soapenv:Envelope>`;

        console.log(soapEnvelope)

        let respostas = await axios.post(
            `${ConfigManagerRm.getUrl()}:8051/wsProcess/IwsProcess`,
            soapEnvelope,
            {
                headers: {
                    'Authorization': `Basic ${ConfigManagerRm.getCredentials()}`,
                    'Content-Type': 'text/xml;charset=UTF-8',
                    'SOAPAction': 'http://www.totvs.com/IwsProcess/ExecuteWithXmlParams',
                }
            }
        );

        let result = respostas.data
        result = await FUNCTIONS.buscaResultadoCotacao(result)

        if (result == '1') {
            const cotacao = await ConfigManagerRm.getCotacao(campos.solicitacaoDeCompra as string, CODCOLIGADA as string)
            await ConfigManagerRm.postComunicaFornecedor(CODCOLIGADA as string, CODFILIAL as string, cotacao, campos.regerarSenha as string, listaDeFornecedores as object[], dataLimiteDeResposta as string)
            retorno.body = JSON.stringify({ message: 'Cotação criada com sucesso', cotacao: cotacao });
            retorno.statusCode = 200;
            return retorno
        } else {
            retorno.body = JSON.stringify({ message: 'Internal Server Error', error: 'Erro ao comunicar os fornecedores' });
            retorno.statusCode = 500;
            return retorno
        }

    } catch (error) {
        console.error('Erro na requisição:', error.response?.status, error.response?.data);
        retorno.body = JSON.stringify({ message: 'Internal Server Error', error: error.message || error.toString() });
        retorno.statusCode = 500;
        return retorno
    }

}
exports.cotacao = middyfy(cotacao);

const comunicaFornecedor: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event) => {
    const campos = event.body;

    try {

        let LINK = `Portal: ${ConfigManagerRm.getUrl()}/FrameHTML/Web/App/Cmp/PortalDoFornecedor/#/login`

        const CODCOLIGADA = campos.codigoDaColigada === '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        const CODFILIAL = campos.codigoDaColigada === '1'
            ? campos.codigoDaFilial2 || ''
            : campos.codigoDaFilial || '';

        const IdRelatorio = await ConfigManagerRm.buscaIdRelatorio(CODCOLIGADA as string)

        const listaDeFornecedores = campos.fornecedores as object[];

        var fornecedores = ''
        var orcamento = ''
        for (let i = 0; i < listaDeFornecedores.length; i++) {
            fornecedores +=
                `<CmpComunicarFornecedores>
                <InternalId i:nil="true" xmlns="http://www.totvs.com/" />
                <CodCfo>${listaDeFornecedores[i]['codigoDoFornecedor']}</CodCfo>
                <CodColCfo>0</CodColCfo>
                <Contatos xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays" />
            </CmpComunicarFornecedores>`;

            orcamento +=
                `<TCORCAMENTO diffgr:id="TCORCAMENTO${i + 1}" msdata:rowOrder="${i}" diffgr:hasChanges="inserted">
                <CODCOTACAO>${campos.cotacao}</CODCOTACAO>
                <CODCOLCFO>0</CODCOLCFO>
                <CODCFO>${listaDeFornecedores[i]['codigoDoFornecedor']}</CODCFO>
            </TCORCAMENTO>`;
        }

        let soapEnvelope =
            `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
            <soapenv:Header />
            <soapenv:Body>
                <tot:ExecuteWithXmlParams>
                    <tot:ProcessServerName>CmpCotacaoComunicarFornecedoresProc</tot:ProcessServerName>
                    <tot:strXmlParams>
                        <![CDATA[
                            <CmpCotacaoComunicarFornecedoresParams xmlns="http://www.totvs.com.br/RM/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:z="http://schemas.microsoft.com/2003/10/Serialization/">
                                <Context xmlns="http://www.totvs.com/" xmlns:a="http://www.totvs.com.br/RM/">
                                    <a:_params xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$EXERCICIOFISCAL</b:Key>
                                            <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">1</b:Value>
                                        </b:KeyValueOfanyTypeanyType>
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODLOCPRT</b:Key>
                                            <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                        </b:KeyValueOfanyTypeanyType>
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODTIPOCURSO</b:Key>
                                            <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                        </b:KeyValueOfanyTypeanyType>
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$EDUTIPOUSR</b:Key>
                                            <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                        </b:KeyValueOfanyTypeanyType>
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUNIDADEBIB</b:Key>
                                            <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                        </b:KeyValueOfanyTypeanyType>
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODCOLIGADA</b:Key>
                                            <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODCOLIGADA}</b:Value>
                                        </b:KeyValueOfanyTypeanyType>
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$RHTIPOUSR</b:Key>
                                            <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                        </b:KeyValueOfanyTypeanyType>
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODIGOEXTERNO</b:Key>
                                            <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                        </b:KeyValueOfanyTypeanyType>
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODSISTEMA</b:Key>
                                            <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">T</b:Value>
                                        </b:KeyValueOfanyTypeanyType>
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUSUARIOSERVICO</b:Key>
                                            <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema" />
                                        </b:KeyValueOfanyTypeanyType>
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUSUARIO</b:Key>
                                            <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">p_heflo</b:Value>
                                        </b:KeyValueOfanyTypeanyType>
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$IDPRJ</b:Key>
                                            <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                        </b:KeyValueOfanyTypeanyType>
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">
                                                $CHAPAFUNCIONARIO</b:Key>
                                            <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                        </b:KeyValueOfanyTypeanyType>
                                        <b:KeyValueOfanyTypeanyType>
                                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODFILIAL</b:Key>
                                            <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODFILIAL}</b:Value>
                                        </b:KeyValueOfanyTypeanyType>
                                    </a:_params>
                                    <a:Environment>DotNet</a:Environment>
                                </Context>
                                <Anexos xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays" />
                                <AssuntoEmail>Pedido de Orçamento nº ${campos.cotacao}</AssuntoEmail>
                                <CodColRel>${CODCOLIGADA}</CodColRel>
                                <CodColigada>${CODCOLIGADA}</CodColigada>
                                <CodColigadaPlanilha>0</CodColigadaPlanilha>
                                <CodCotacao>${campos.cotacao}</CodCotacao>
                                <CorpoEmail>${LINK}</CorpoEmail>
                                <DataLimiteResposta>2024-12-31T00:00:00</DataLimiteResposta>
                                <EmailSomenteContato>false</EmailSomenteContato>
                                <Fornecedores>${fornecedores}</Fornecedores>
                                <IdPlanilha>0</IdPlanilha>
                                <IdRelatorio>${IdRelatorio}</IdRelatorio>
                                <ImpressaoDefinitiva>false</ImpressaoDefinitiva>
                                <NomePlanilha i:nil="true" />
                                <ParametersRel />
                                <RegerarSenha>${campos.regerarSenha}</RegerarSenha>
                                <RelatorioAnexoEmail>false</RelatorioAnexoEmail>
                                <RelatorioDotNet>true</RelatorioDotNet>
                                <TblFornecedores>
                                    <xs:schema id="NewDataSet" xmlns:xs="http://www.w3.org/2001/XMLSchema"
                                        xmlns:msdata="urn:schemas-microsoft-com:xml-msdata">
                                        <xs:element name="TCORCAMENTO">
                                            <xs:complexType>
                                                <xs:sequence>
                                                    <xs:element name="CODCOTACAO" type="xs:string" />
                                                    <xs:element name="CODCOLCFO" type="xs:int" />
                                                    <xs:element name="CODCFO" type="xs:string" />
                                                </xs:sequence>
                                            </xs:complexType>
                                        </xs:element>
                                        <xs:element name="NewDataSet" msdata:IsDataSet="true" msdata:MainDataTable="TCORCAMENTO">
                                            <xs:complexType>
                                                <xs:choice>
                                                    <xs:element ref="TCORCAMENTO" />
                                                </xs:choice>
                                            </xs:complexType>
                                            <xs:unique name="pk_rel">
                                                <xs:selector xpath=".//TCORCAMENTO" />
                                                <xs:field xpath="CODCOTACAO" />
                                                <xs:field xpath="CODCOLCFO" />
                                                <xs:field xpath="CODCFO" />
                                            </xs:unique>
                                        </xs:element>
                                    </xs:schema>
                                    <diffgr:diffgram xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata">
                                        <DocumentElement xmlns="">${orcamento}</DocumentElement>
                                    </diffgr:diffgram>
                                </TblFornecedores>
                                <TipoComunicacao>WEB</TipoComunicacao>
                                <TipoPlanilha i:nil="true" />
                            </CmpCotacaoComunicarFornecedoresParams>
                        ]]>
                    </tot:strXmlParams>
                </tot:ExecuteWithXmlParams>
            </soapenv:Body>
        </soapenv:Envelope>`;

        console.log(soapEnvelope);

        let respostas = await axios.post(
            `${ConfigManagerRm.getUrl()}:8051/wsProcess/IwsProcess`,
            soapEnvelope,
            {
                headers: {
                    'Authorization': `Basic ${ConfigManagerRm.getCredentials()}`,
                    'Content-Type': 'text/xml;charset=UTF-8',
                    'SOAPAction': 'http://www.totvs.com/IwsProcess/ExecuteWithXmlParams',
                }
            }
        );

        let result = respostas.data
        result = await FUNCTIONS.buscaResultadoCotacao(result)

        if (result == '1') {
            retorno.body = JSON.stringify({ message: 'Comunicação realizada com sucesso' });
            retorno.statusCode = 200;
            return retorno
        } else {
            retorno.body = JSON.stringify({ message: 'Internal Server Error', error: 'Erro ao comunicar os fornecedores' });
            retorno.statusCode = 500;
            return retorno
        }
    } catch (error) {
        retorno.body = JSON.stringify({ message: 'Internal Server Error', error: 'Erro ao comunicar os fornecedores' });
        retorno.statusCode = 500;
        return retorno
    }

}
exports.comunicaFornecedor = middyfy(comunicaFornecedor);

const fileQuadroComparativo: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event) => {
    try {
        const campos = event.body

        const CODCOLIGADA = campos.codigoDaColigada === '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';
    
        let file = await ConfigManagerRm.getQuadroComparativo(campos.cotacao as string, CODCOLIGADA as string, `Cotação - Ticket ${campos.ticketRaiz}.pdf`);
    
        if(file){
            retorno.body = JSON.stringify({file});
            retorno.statusCode = 200
            return retorno
        } else {
            retorno.body = JSON.stringify({ message: 'Internal Server Error', error: 'Erro ao buscar o arquivo' });
            retorno.statusCode = 500;
            return retorno
        }
    } catch (error) {
        retorno.body = JSON.stringify({ message: 'Internal Server Error', error: error.message || error.toString() });
        retorno.statusCode = 500;
        return retorno
    }
}
exports.fileQuadroComparativo = middyfy(fileQuadroComparativo);

const geraQuadroComparativo: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event) => {
    try {
        const campos = event.body;

        const CODCOLIGADA = campos.codigoDaColigada === '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        const CODFILIAL = campos.codigoDaColigada === '1'
            ? campos.codigoDaFilial2 || ''
            : campos.codigoDaFilial || '';

        ConfigManagerRm.defineGanhador(CODCOLIGADA as string, campos.cotacao as string, CODFILIAL as string);

        const boundary = 'foo_bar_baz';
        const metadata = {
            'name': `Cotação - Ticket ${campos.ticketRaiz}.pdf`,
            'mimeType': 'application/pdf\r\n\r\n'
        };

        let data = `--${boundary}\n`;
        data += `content-type: application/json; charset=UTF-8\n\n`;
        data += JSON.stringify(metadata) + '\n';
        data += `--${boundary}\n`;

        data += `content-transfer-encoding: base64\n`;
        data += `content-type: application/pdf\n\n`;
        data += `${campos.file}\n`;
        data += `--${boundary}--`;

        const response = await axios.post(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
            data,
            {
                headers: {
                    'Authorization': `Bearer ${campos.token}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`,
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity
            }
        );

        let result = response.data.id

        if (!result) {
            let error = result
            retorno.body = JSON.stringify({ message: 'Internal Server Error', error: error });
            retorno.statusCode = 500;
            return retorno
        } else {
            ConfigManagerGoogle.liberaPermissaoAnexo(result);
            let link = `https://drive.google.com/file/d/${result}/view`
            retorno.body = JSON.stringify({ link });
            retorno.statusCode = 200
            return retorno
        }
    } catch (error) {
        retorno.body = JSON.stringify({ message: 'Internal Server Error', error: error.message || error.toString() });
        retorno.statusCode = 500;
        return retorno
    }
}
exports.geraQuadroComparativo = middyfy(geraQuadroComparativo);

const ordemDeCompra: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event) => {
    try {
        const campos = event.body;

        const ESTOQUE = campos.codigoDaColigada === '1'
            ? `${(campos.filialDeEntrega as string).split(" - ")[0]}.001`
            : `${(campos.unidadeFilial as string).split(" - ")[0]}.001`;

        const CODCOLIGADA = campos.codigoDaColigada === '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        const CODFILIAL = campos.codigoDaColigada === '1'
            ? campos.codigoDaFilial2 || ''
            : campos.codigoDaFilial || '';

        const CODTMVGERADO = campos.tipoDeSolicitacao === 'P'
            ? '1.1.05'
            : '1.1.06';

        let listaDeItens = await ConfigManagerRm.getGanhador(campos.cotacao as string);

        // Lógica para gerar o XML incorporada diretamente
        let listaDeProdutos = (() => {
            try {
                // Agrupa os produtos por fornecedor
                const fornecedores = listaDeItens.reduce((acc: Record<string, any[]>, item) => {
                    acc[item.CODCFO] = acc[item.CODCFO] || [];
                    acc[item.CODCFO].push(item);
                    return acc;
                }, {});

                let xmlFinal = "";

                // Gera o XML para cada fornecedor
                Object.keys(fornecedores).forEach((fornecedor) => {
                    const produtos = fornecedores[fornecedor];
                    produtos.forEach((produto) => {
                        xmlFinal += `
                        <a:ProdutoInclusaoMov>
                            <a:InternalId i:nil="true" />
                            <codCCusto>${campos.codigoDoCentroDeCusto}</codCCusto>
                            <codCfo>${produto.CODCFO}</codCfo>
                            <codColCfo>0</codColCfo>
                            <codColMov>${CODCOLIGADA}</codColMov>
                            <codCpgNegociada>${produto.CODCPGNEGOCIADA}</codCpgNegociada>
                            <codDepartamento />
                            <codFilial>${CODFILIAL}</codFilial>
                            <codFilialEntrega>0</codFilialEntrega>
                            <codLoc>${ESTOQUE}</codLoc>
                            <codLocEntrega />
                            <codMoeda>R$</codMoeda>
                            <codRpr />
                            <codTmvGerado>${CODTMVGERADO}</codTmvGerado>
                            <codTraParadigma />
                            <despesa>0</despesa>
                            <freteCifOuFobParadigma>0</freteCifOuFobParadigma>
                            <idClassMovGerado>0</idClassMovGerado>
                            <idMov>${produto.IDMOV}</idMov>
                            <idPrd>${produto.IDPRD}</idPrd>
                            <movimento>0</movimento>
                            <nSeqItmMov>${produto.NSEQITMMOV}</nSeqItmMov>
                            <percDesconto>0</percDesconto>
                            <percDespItmNeg>0</percDespItmNeg>
                            <statusParadigma>N</statusParadigma>
                            <valFreteParadigma>0</valFreteParadigma>
                            <valorDesOcrc>0</valorDesOcrc>
                        </a:ProdutoInclusaoMov>`;
                    });
                });

                return xmlFinal;
            } catch (error) {
                console.error("Erro ao gerar XML:", error);
                return "";
            }
        })();

        let envelope =
            `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
            <soapenv:Header />
            <soapenv:Body>
                <tot:ExecuteWithXmlParams>
                    <tot:ProcessServerName>CmpOrdemCompraProc</tot:ProcessServerName>
                    <tot:strXmlParams>
                        <![CDATA[
                            <CmpGerarOrdemCompraProcParams z:Id="i1" xmlns="http://www.totvs.com.br/RM/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:z="http://schemas.microsoft.com/2003/10/Serialization/">
                                <Context z:Id="i2" xmlns="http://www.totvs.com/" xmlns:a="http://www.totvs.com.br/RM/">
                                    <a:_params xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$EXERCICIOFISCAL</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODLOCPRT</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODTIPOCURSO</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$EDUTIPOUSR</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUNIDADEBIB</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODCOLIGADA</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODCOLIGADA}</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$RHTIPOUSR</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODIGOEXTERNO</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODSISTEMA</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">T</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUSUARIOSERVICO</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema" />
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUSUARIO</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">p_heflo</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$IDPRJ</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CHAPAFUNCIONARIO</b:Key>
                                        <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">-1</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    <b:KeyValueOfanyTypeanyType>
                                        <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODFILIAL</b:Key>
                                        <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODFILIAL}</b:Value>
                                    </b:KeyValueOfanyTypeanyType>
                                    </a:_params>
                                    <a:Environment>DotNet</a:Environment>
                                </Context>
                                <ListGerarOrdemCompra xmlns:a="http://www.totvs.com/">
                                    <a:CmpGerarOrdemCompraPar z:Id="i3">
                                    <a:InternalId i:nil="true" />
                                    <codColigada>${CODCOLIGADA}</codColigada>
                                    <codCotacao>${campos.cotacao}</codCotacao>
                                    <codFilial>${CODFILIAL}</codFilial>
                                    <codUsuario>p_heflo</codUsuario>
                                    <listProdutoAlteracao />
                                    <listProdutoInclusao>${listaDeProdutos}</listProdutoInclusao>
                                    </a:CmpGerarOrdemCompraPar>
                                </ListGerarOrdemCompra>
                            </CmpGerarOrdemCompraProcParams>
                        ]]>
                    </tot:strXmlParams>
                </tot:ExecuteWithXmlParams>
            </soapenv:Body>
        </soapenv:Envelope>`

        let response = await axios.post(
            `${ConfigManagerRm.getUrl()}:8051/wsProcess/IwsProcess`,
            envelope,
            {
                headers: {
                    'Authorization': `Basic ${ConfigManagerRm.getCredentials()}`,
                    'Content-Type': 'text/xml;charset=UTF-8',
                    'SOAPAction': 'http://www.totvs.com/IwsProcess/ExecuteWithXmlParams',
                }
            }
        );

        let result = response.data
        result = await FUNCTIONS.buscaResultadoCotacao(result)

        if (result != '1') {
            let error = result.match(/^[^\r\n]+/)[0];
            retorno.body = JSON.stringify({ message: 'Internal Server Error', error: error });
            retorno.statusCode = 500;
            return retorno
        } else {
            let OC = await ConfigManagerRm.getOC(campos.cotacao as string, campos.solicitacaoDeCompra as string);
            retorno.body = JSON.stringify({ OC });
            retorno.statusCode = 200
            return retorno
        }

    } catch (error) {
        retorno.body = JSON.stringify({ message: 'Internal Server Error', error: error.message || error.toString() });
        retorno.statusCode = 500;
        return retorno
    }
}
exports.ordemDeCompra = middyfy(ordemDeCompra);

const cancelaCotacao: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event) => {
    try {
        const campos = event.body;

        const CODCOLIGADA = campos.codigoDaColigada === '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        var soapEnvelope =
            `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
            <soapenv:Header />
            <soapenv:Body>
                <tot:ExecuteWithXmlParams>
                <tot:ProcessServerName>CmpCancelarCotacaoProc</tot:ProcessServerName>
                <tot:strXmlParams>
                    <![CDATA[<CmpCancelarCotacaoParams xmlns="http://www.totvs.com.br/RM/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
                    <Context xmlns="http://www.totvs.com/" xmlns:a="http://www.totvs.com.br/RM/">
                        <a:_params xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                        <b:KeyValueOfanyTypeanyType>
                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODCOLIGADA</b:Key>
                            <b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODCOLIGADA}</b:Value>
                        </b:KeyValueOfanyTypeanyType>
                        <b:KeyValueOfanyTypeanyType>
                            <b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODSISTEMA</b:Key>
                            <b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">T</b:Value>
                        </b:KeyValueOfanyTypeanyType>
                        </a:_params>
                    </Context>
                    <PrimaryKeyList xmlns="http://www.totvs.com/" xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                        <a:ArrayOfanyType>
                        <a:anyType i:type="b:string" xmlns:b="http://www.w3.org/2001/XMLSchema">${campos.cotacao}</a:anyType>
                        <a:anyType i:type="b:short" xmlns:b="http://www.w3.org/2001/XMLSchema">${CODCOLIGADA}</a:anyType>
                        </a:ArrayOfanyType>
                    </PrimaryKeyList>
                    <PrimaryKeyNames xmlns="http://www.totvs.com/" xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                        <a:string>CODCOTACAO</a:string>
                        <a:string>CODCOLIGADA</a:string>
                    </PrimaryKeyNames>
                    <CodMotivo/>
                    </CmpCancelarCotacaoParams>]]>
                </tot:strXmlParams>
                </tot:ExecuteWithXmlParams>
            </soapenv:Body>
        </soapenv:Envelope>`

        let response = await axios.post(
            `${ConfigManagerRm.getUrl()}:8051/wsProcess/IwsProcess`,
            soapEnvelope,
            {
                headers: {
                    'Authorization': `Basic ${ConfigManagerRm.getCredentials()}`,
                    'Content-Type': 'text/xml;charset=UTF-8',
                    'SOAPAction': 'http://www.totvs.com/IwsProcess/ExecuteWithXmlParams',
                }
            }
        );

        let result = response.data
        result = await FUNCTIONS.buscaResultadoCotacao(result)

        if (result != '1') {
            let error = result.match(/^[^\r\n]+/)[0];
            retorno.body = JSON.stringify({ message: 'Internal Server Error', error: error });
            retorno.statusCode = 500;
            return retorno
        } else {
            let resposta = 'CANCELADO'
            retorno.body = JSON.stringify({ resposta });
            retorno.statusCode = 200
            return retorno
        }

    } catch (error) {
        retorno.body = JSON.stringify({ message: 'Internal Server Error', error: error.message || error.toString() });
        retorno.statusCode = 500;
        return retorno
    }

}
exports.cancelaCotacao = middyfy(cancelaCotacao);

const gravaNaturezaOrcamentaria: ValidatedEventAPIGatewayProxyEvent<typeof schema> = async (event) => {
    
    return retorno
}
exports.gravaNaturezaOrcamentaria = middyfy(gravaNaturezaOrcamentaria);