import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as XML from '../../../utils/xml';
import * as DATE from '../../../utils/date';
import * as CLASSES from '../../../utils/classRm';
import axios from 'axios';

const ConfigManagerRm = new CLASSES.ConfigManagerRm();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const campos = JSON.parse(event.body as string);

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
        
        const dataLimiteDeResposta = DATE.convertToISOFormat(campos.dataLimiteDeResposta as string)

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
                    <CodCfo>${(listaDeFornecedores[i] as { codigoDoFornecedor: string }).codigoDoFornecedor}</CodCfo>
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
                                <DatCotacao>${DATE.getDateTime()}</DatCotacao>
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
                                <UltimaAtualizacao>${DATE.getDateTime()}</UltimaAtualizacao>
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
        result = await XML.buscaResultadoCotacao(result)

        if (result == '1') {
            const cotacao = await ConfigManagerRm.getCotacao(campos.solicitacaoDeCompra as string, CODCOLIGADA as string)
            await ConfigManagerRm.postComunicaFornecedor(CODCOLIGADA as string, CODFILIAL as string, cotacao, campos.regerarSenha as string, listaDeFornecedores as object[], dataLimiteDeResposta as string)
            return formatResponse(200, { message: 'Cotação criada com sucesso', cotacao: cotacao });
        } else {
            return formatResponse(400, { message: 'Internal Server Error', error: 'Erro ao comunicar os fornecedores' });
        }

    } catch (error) {
        return formatResponse(500, {  message: 'Internal Server Error',  error: error instanceof Error ? error.message : String(error) });
    }
};