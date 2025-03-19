import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as CLASSES from '../../../utils/classRm';
import * as XML from '../../../utils/xml';
import axios from 'axios';

const ConfigManagerRm = new CLASSES.ConfigManagerRm();

export const handler: APIGatewayProxyHandler = async (event) => {
    const campos = JSON.parse(event.body as string);

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
                <CodCfo>${(listaDeFornecedores[i] as { codigoDoFornecedor: string }).codigoDoFornecedor}</CodCfo>
                <CodColCfo>0</CodColCfo>
                <Contatos xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays" />
            </CmpComunicarFornecedores>`;

            orcamento +=
                `<TCORCAMENTO diffgr:id="TCORCAMENTO${i + 1}" msdata:rowOrder="${i}" diffgr:hasChanges="inserted">
                <CODCOTACAO>${campos.cotacao}</CODCOTACAO>
                <CODCOLCFO>0</CODCOLCFO>
                <CODCFO>${(listaDeFornecedores[i] as { codigoDoFornecedor: string }).codigoDoFornecedor}</CODCFO>
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
        result = await XML.buscaResultadoCotacao(result)

        if (result == '1') {
            return formatResponse(200, { message: 'Comunicação realizada com sucesso' });
        } else {
            let error = result.match(/^[^\r\n]+/)[0];
            return formatResponse(400, { message: 'Internal Server Error', error: error });
        }
    } catch (error) {
        return formatResponse(500, {  message: 'Internal Server Error',  error: error instanceof Error ? error.message : String(error) });
    }

};