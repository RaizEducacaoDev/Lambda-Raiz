import axios from 'axios';
import * as FUNCTIONS from 'src/utilities/functions'
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

export class ConfigManagerGlpi {
    private configuracoes: Record<string, { appToken: string; userToken: string; url: string }>;

    constructor() {
        this.configuracoes = {
            prod: {
                appToken: process.env.APPTOKEN_GLPI_PROD || '',
                userToken: process.env.USERTOKEN_GLPI_PROD || '',
                url: process.env.GLPI_PROD || ''
            },
            dev: {
                appToken: process.env.APPTOKEN_GLPI_DEV || '',
                userToken: process.env.USERTOKEN_GLPI_DEV || '',
                url: process.env.GLPI_DEV || ''
            }
        };
    }


    private getConfig(ambiente: string) {
        const config = this.configuracoes[ambiente];
        if (!config) throw new Error(`Configuração para o ambiente ${ambiente} não encontrada`);
        return config;
    }

    getUrl(ambiente: string): string {
        return this.getConfig(ambiente).url;
    }

    getUserToken(ambiente: string): string {
        return this.getConfig(ambiente).userToken;
    }

    getAppToken(ambiente: string): string {
        return this.getConfig(ambiente).appToken;
    }

    async getSessionToken(ambiente: string): Promise<string> {
        const { url, userToken, appToken } = this.getConfig(ambiente);

        try {
            const response = await axios.get(`${url}/initSession?user_token=${userToken}`, {
                headers: { 'App-Token': appToken }
            });
            return response.data.session_token.replace(/['"]/g, '');
        } catch (error) {
            throw new Error(`Erro ao obter Session Token: ${error.message}`);
        }
    }

    async buscaIdDoUsuario(email: string, sessionToken: string): Promise<number> {
        const ambiente = process.env.Stage;
        //const sessionToken = await this.getSessionToken(ambiente);
        const userToken = this.getUserToken(ambiente);
        const appToken = this.getAppToken(ambiente);

        const apiURL = `${this.getUrl(ambiente)}search/User?criteria[0][field]=5&criteria[0][searchtype]=contains&criteria[0][value]=${email}&session_token=${sessionToken}&forcedisplay[0]=5&forcedisplay[1]=2`;

        try {
            const response = await axios.get(apiURL, {
                headers: {
                    'Content-Type': 'application/json',
                    'user_token': userToken,
                    'App-Token': appToken
                }
            });

            const userId = response.data.data[0]['2'];

            if (typeof userId === 'number') {
                return userId;
            } else {
                return 15
            }

        } catch (erro) {
            console.error('Não foi possível encontrar o solicitante no GLPI', erro.message);
            return 15
        }
    }
}

export class ConfigManagerRm {
    private configuracoes: Record<string, { url: string }>;

    constructor() {
        this.configuracoes = {
            prod: {
                url: process.env.RM_PROD || '',
            },
            dev: {
                url: process.env.RM_DEV || '',
            }
        };
    }

    private getStage() {
        const stage = process.env.Stage;
        if (!stage || !this.configuracoes[stage]) {
            throw new Error(`Configuração para o stage '${stage}' não encontrada.`);
        }
        return this.configuracoes[stage];
    }


    private encodeCredentials(): string {
        const username = process.env.USERNAME;
        const password = process.env.PASSWORD;

        if (!username || !password) {
            throw new Error('Variáveis de ambiente USERNAME ou PASSWORD não estão definidas.');
        }

        return Buffer.from(`${username}:${password}`).toString('base64');
    }


    getUrl(): string {
        return this.getStage().url;
    }

    getCredentials(): string {
        return this.encodeCredentials();
    }

    async getCotacao(movimentId: string, codColigada: string): Promise<string> {
        const apiURL = `${this.getUrl()}:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/TICKET.RAIZ.0009/0/T?parameters=CODCOLIGADA=${codColigada};IDMOV=${movimentId}`;

        try {
            const response = await axios.get(apiURL, {
                headers: {
                    'Authorization': `Basic ${this.getCredentials()}`,
                }
            });

            if (!response.data || response.data.length === 0) {
                throw new Error('Resposta da API inválida ou vazia.');
            }

            return response.data[0].CODCOTACAO;

        } catch (erro) {
            console.error('Erro ao buscar o número da cotação:', erro);
            throw erro;
        }
    }

    async getGanhador(CODCOTACAO: string): Promise<any> {
        const apiURL = `${this.getUrl()}:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/TICKET.RAIZ.0011/0/T?parameters=CODCOTACAO=${CODCOTACAO}`; //TICKET.RAIZ.0011 = prod || TICKET.RAIZ.0010 = dev

        try {
            const response = await axios.get(apiURL, {
                headers: {
                    'Authorization': `Basic ${this.getCredentials()}`,
                }
            });

            if (!response.data || response.data.length === 0) {
                throw new Error('Resposta da API inválida ou vazia.');
            }

            return response.data;

        } catch (erro) {
            console.error('Erro ao buscar o número da cotação:', erro);
            throw erro;
        }
    }

    async getOC(CODCOTACAO: string, IDMOV: string): Promise<any> {
        const apiURL = `${this.getUrl()}:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/TICKET.RAIZ.0011/0/T?parameters=CODCOTACAO=${CODCOTACAO};IDMOV=${IDMOV}`;

        try {
            const response = await axios.get(apiURL, {
                headers: {
                    'Authorization': `Basic ${this.getCredentials()}`,
                }
            });

            if (!response.data || response.data.length === 0) {
                throw new Error('Resposta da API inválida ou vazia.');
            }

            const idMovString = response.data.map(item => item.IDMOV).join(' | ');
            return idMovString;


        } catch (erro) {
            console.error('Erro ao buscar o número da cotação:', erro);
            throw erro;
        }
    }

    async postComunicaFornecedor(CODCOLIGADA: string, CODFILIAL: string, cotacao: string, regerarSenha: string, listaDeFornecedores: object[], dataLimiteDeResposta: string): Promise<string> {
        try {
            const LINK = `Portal: ${this.getUrl()}/FrameHTML/Web/App/Cmp/PortalDoFornecedor/#/login`
            const IdRelatorio = await this.buscaIdRelatorio(CODCOLIGADA as string)

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
                    <CODCOTACAO>${cotacao}</CODCOTACAO>
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
                                    <AssuntoEmail>Pedido de Orçamento nº ${cotacao}</AssuntoEmail>
                                    <CodColRel>${CODCOLIGADA}</CodColRel>
                                    <CodColigada>${CODCOLIGADA}</CodColigada>
                                    <CodColigadaPlanilha>0</CodColigadaPlanilha>
                                    <CodCotacao>${cotacao}</CodCotacao>
                                    <CorpoEmail>${LINK}</CorpoEmail>
                                    <DataLimiteResposta>${dataLimiteDeResposta}</DataLimiteResposta>
                                    <EmailSomenteContato>false</EmailSomenteContato>
                                    <Fornecedores>${fornecedores}</Fornecedores>
                                    <IdPlanilha>0</IdPlanilha>
                                    <IdRelatorio>${IdRelatorio}</IdRelatorio>
                                    <ImpressaoDefinitiva>false</ImpressaoDefinitiva>
                                    <NomePlanilha i:nil="true" />
                                    <ParametersRel />
                                    <RegerarSenha>${regerarSenha}</RegerarSenha>
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

            console.log(soapEnvelope)

            let respostas = await axios.post(
                `${this.getUrl()}:8051/wsProcess/IwsProcess`,
                soapEnvelope,
                {
                    headers: {
                        'Authorization': `Basic ${this.getCredentials()}`,
                        'Content-Type': 'text/xml;charset=UTF-8',
                        'SOAPAction': 'http://www.totvs.com/IwsProcess/ExecuteWithXmlParams',
                    }
                }
            );

            let result = respostas.data
            result = await FUNCTIONS.buscaResultadoCotacao(result)

            if (result == '1') {
                return 'Fornecedores comunicados com sucesso'
            } else {
                throw new Error('Não foi possível comunicar os fornecedores');
            }
        } catch (erro) {
            console.error('Erro ao buscar o número da cotação:', erro);
            throw erro;
        }
    }

    async buscaIdRelatorio(codColigada: string): Promise<string> {
        const apiURL = `${this.getUrl()}:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/TICKET.RAIZ.0013/0/T?parameters=CODCOLIGADA=${codColigada}`; //TICKET.RAIZ.0013 = prod || TICKET.RAIZ.0012 = dev

        try {
            const response = await axios.get(apiURL, {
                headers: {
                    'Authorization': `Basic ${this.getCredentials()}`,
                }
            });

            if (!response.data || response.data.length === 0) {
                throw new Error('Resposta da API inválida ou vazia.');
            }

            return response.data[0].ID;

        } catch (erro) {
            console.error('Erro ao buscar o número da cotação:', erro);
            throw erro;
        }
    }

    async getQuadroComparativo(CODCOTACAO: string, CODCOLIGADA: string, NOMEARQUIVO: string): Promise<string> {
        try {
            const apiURL = `${this.getUrl()}:8051/wsReport/IwsReport`;

            let envelope =
                `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
                <soapenv:Header/>
                <soapenv:Body>
                    <tot:GenerateReport>
                        <tot:codColigada>0</tot:codColigada>
                        <tot:id>2239</tot:id>
                        <tot:filters/>
                        <tot:parameters>
                            <![CDATA[
                            <ArrayOfRptParameterReportPar xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.totvs.com.br/RM/">
                                <RptParameterReportPar>
                                    <Description>CODCOTACAO</Description>
                                    <ParamName>CODCOTACAO</ParamName>
                                    <Type xmlns:d3p1="http://schemas.datacontract.org/2004/07/System" xmlns:d3p2="-mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089-System-System.RuntimeType" i:type="d3p2:RuntimeType" xmlns:d3p3="-mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089-System-System.UnitySerializationHolder" z:FactoryType="d3p3:UnitySerializationHolder" xmlns:z="http://schemas.microsoft.com/2003/10/Serialization/">
                                        <Data xmlns:d4p1="http://www.w3.org/2001/XMLSchema" i:type="d4p1:string" xmlns="">System.String</Data>
                                        <UnityType xmlns:d4p1="http://www.w3.org/2001/XMLSchema" i:type="d4p1:int" xmlns="">4</UnityType>
                                        <AssemblyName xmlns:d4p1="http://www.w3.org/2001/XMLSchema" i:type="d4p1:string" xmlns="">mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</AssemblyName>
                                    </Type>
                                    <Value xmlns:d3p1="http://www.w3.org/2001/XMLSchema" i:type="d3p1:string">${CODCOTACAO}</Value>
                                    <Visible>true</Visible>
                                </RptParameterReportPar>
                                <RptParameterReportPar>
                                    <Description>CODCOLIGADA</Description>
                                    <ParamName>CODCOLIGADA</ParamName>
                                    <Type xmlns:d3p1="http://schemas.datacontract.org/2004/07/System" xmlns:d3p2="-mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089-System-System.RuntimeType" i:type="d3p2:RuntimeType" xmlns:d3p3="-mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089-System-System.UnitySerializationHolder" z:FactoryType="d3p3:UnitySerializationHolder" xmlns:z="http://schemas.microsoft.com/2003/10/Serialization/">
                                        <Data xmlns:d4p1="http://www.w3.org/2001/XMLSchema" i:type="d4p1:string" xmlns="">System.String</Data>
                                        <UnityType xmlns:d4p1="http://www.w3.org/2001/XMLSchema" i:type="d4p1:int" xmlns="">4</UnityType>
                                        <AssemblyName xmlns:d4p1="http://www.w3.org/2001/XMLSchema" i:type="d4p1:string" xmlns="">mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</AssemblyName>
                                    </Type>
                                    <Value xmlns:d3p1="http://www.w3.org/2001/XMLSchema" i:type="d3p1:string">${CODCOLIGADA}</Value>
                                    <Visible>true</Visible>
                                </RptParameterReportPar>
                            </ArrayOfRptParameterReportPar>
                            ]]>
                        </tot:parameters>
                        <tot:fileName>${NOMEARQUIVO}</tot:fileName>
                        <tot:contexto/>
                    </tot:GenerateReport>
                </soapenv:Body>
            </soapenv:Envelope>`

            const response = await axios.post(apiURL, envelope, {
                headers: {
                    'Authorization': `Basic ${this.getCredentials()}`,
                    'Content-Type': 'text/xml;charset=UTF-8',
                    'SOAPAction': 'http://www.totvs.com/IwsReport/GenerateReport',
                }
            });

            let UID = await FUNCTIONS.buscaUID(response.data as any)

            if (UID) {
                let envelope2 =
                    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
                    <soapenv:Header/>
                    <soapenv:Body>
                        <tot:GetGeneratedReportSize>
                            <tot:guid>${UID}</tot:guid>
                        </tot:GetGeneratedReportSize>
                    </soapenv:Body>
                </soapenv:Envelope>`

                const response2 = await axios.post(apiURL, envelope2, {
                    headers: {
                        'Authorization': `Basic ${this.getCredentials()}`,
                        'Content-Type': 'text/xml;charset=UTF-8',
                        'SOAPAction': 'http://www.totvs.com/IwsReport/GetGeneratedReportSize',
                    }
                });

                let SIZE = await FUNCTIONS.buscaSIZE(response2.data as any)

                if (SIZE) {
                    let envelope3 =
                        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
                        <soapenv:Header/>
                        <soapenv:Body>
                            <tot:GetFileChunk>
                                <tot:guid>${UID}</tot:guid>
                                <tot:offset>0</tot:offset>
                                <tot:length>${SIZE}</tot:length>
                            </tot:GetFileChunk>
                        </soapenv:Body>
                    </soapenv:Envelope>`

                    const response3 = await axios.post(apiURL, envelope3, {
                        headers: {
                            'Authorization': `Basic ${this.getCredentials()}`,
                            'Content-Type': 'text/xml;charset=UTF-8',
                            'SOAPAction': 'http://www.totvs.com/IwsReport/GetFileChunk',
                        }
                    });

                    let FILE = await FUNCTIONS.buscaFILE(response3.data as any)

                    if (FILE) {
                        return FILE
                    } else {
                        throw new Error('Resposta da API inválida ou vazia.');
                    }

                } else {
                    throw new Error('Resposta da API inválida ou vazia.');
                }

            } else {
                throw new Error('Resposta da API inválida ou vazia.');
            }


        } catch (erro) {
            console.error('Erro ao buscar o número da cotação:', erro);
            throw erro;
        }
    }

    async defineGanhador(CODCOLIGADA: string, CODCOTACAO: string, CODFILIAL: string) {
        try {
            const apiURL = `${this.getUrl()}:8051/wsProcess/IwsProcess`;

            let soapEnvelope =
            `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
                <soapenv:Header/>
                <soapenv:Body>
                    <tot:ExecuteWithXmlParams>
                        <tot:ProcessServerName>CmpCotCalculoQuadroComparativoProc</tot:ProcessServerName>
                        <tot:strXmlParams>
                            <![CDATA[<CmpCotCalculoQuadroComparativoParams xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:z="http://schemas.microsoft.com/2003/10/Serialization/" xmlns="http://www.totvs.com.br/RM/">
                                <Context xmlns:d2p1="http://www.totvs.com.br/RM/" xmlns="http://www.totvs.com/">
                                    <d2p1:_params xmlns:d3p1="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                                        <d3p1:KeyValueOfanyTypeanyType>
                                            <d3p1:Key xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">$EXERCICIOFISCAL</d3p1:Key>
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:int">1</d3p1:Value>
                                        </d3p1:KeyValueOfanyTypeanyType>
                                        <d3p1:KeyValueOfanyTypeanyType>
                                            <d3p1:Key xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">$CODLOCPRT</d3p1:Key>
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:int">-1</d3p1:Value>
                                        </d3p1:KeyValueOfanyTypeanyType>
                                        <d3p1:KeyValueOfanyTypeanyType>
                                            <d3p1:Key xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">$CODTIPOCURSO</d3p1:Key>
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:int">-1</d3p1:Value>
                                        </d3p1:KeyValueOfanyTypeanyType>
                                        <d3p1:KeyValueOfanyTypeanyType>
                                            <d3p1:Key xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">$EDUTIPOUSR</d3p1:Key>
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">-1</d3p1:Value>
                                        </d3p1:KeyValueOfanyTypeanyType>
                                        <d3p1:KeyValueOfanyTypeanyType>
                                            <d3p1:Key xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">$CODUNIDADEBIB</d3p1:Key>
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:int">-1</d3p1:Value>
                                        </d3p1:KeyValueOfanyTypeanyType>
                                        <d3p1:KeyValueOfanyTypeanyType>
                                            <d3p1:Key xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">$CODCOLIGADA</d3p1:Key>
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:int">${CODCOLIGADA}</d3p1:Value>
                                        </d3p1:KeyValueOfanyTypeanyType>
                                        <d3p1:KeyValueOfanyTypeanyType>
                                            <d3p1:Key xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">$RHTIPOUSR</d3p1:Key>
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">-1</d3p1:Value>
                                        </d3p1:KeyValueOfanyTypeanyType>
                                        <d3p1:KeyValueOfanyTypeanyType>
                                            <d3p1:Key xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">$CODIGOEXTERNO</d3p1:Key>
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">-1</d3p1:Value>
                                        </d3p1:KeyValueOfanyTypeanyType>
                                        <d3p1:KeyValueOfanyTypeanyType>
                                            <d3p1:Key xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">$CODSISTEMA</d3p1:Key>
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">T</d3p1:Value>
                                        </d3p1:KeyValueOfanyTypeanyType>
                                        <d3p1:KeyValueOfanyTypeanyType>
                                            <d3p1:Key xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">$CODUSUARIO</d3p1:Key>
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:int">p_heflo</d3p1:Value>
                                        </d3p1:KeyValueOfanyTypeanyType>
                                        <d3p1:KeyValueOfanyTypeanyType>
                                            <d3p1:Key xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">$IDPRJ</d3p1:Key>
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:int">-1</d3p1:Value>
                                        </d3p1:KeyValueOfanyTypeanyType>
                                        <d3p1:KeyValueOfanyTypeanyType>
                                            <d3p1:Key xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">$CHAPAFUNCIONARIO</d3p1:Key>
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">-1</d3p1:Value>
                                        </d3p1:KeyValueOfanyTypeanyType>
                                        <d3p1:KeyValueOfanyTypeanyType>
                                            <d3p1:Key xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">$CODFILIAL</d3p1:Key>
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:int">${CODFILIAL}</d3p1:Value>
                                        </d3p1:KeyValueOfanyTypeanyType>
                                    </d2p1:_params>
                                    <d2p1:Environment>WebServices</d2p1:Environment>
                                </Context>
                                <CmpCotCalculoQuadroComparativo xmlns:d2p1="http://www.totvs.com/">
                                    <d2p1:CmpCotCalculoQuadroComparativoPar>
                                        <d2p1:InternalId i:nil="true"/>
                                        <AAlistModified xmlns:d4p1="http://schemas.microsoft.com/2003/10/Serialization/Arrays"/>
                                        <CodColigada>${CODCOLIGADA}</CodColigada>
                                        <CodCotacao>${CODCOTACAO}</CodCotacao>
                                        <CodUsuarioLogado>p_heflo</CodUsuarioLogado>
                                    </d2p1:CmpCotCalculoQuadroComparativoPar>
                                </CmpCotCalculoQuadroComparativo>
                            </CmpCotCalculoQuadroComparativoParams>]]>
                        </tot:strXmlParams>
                    </tot:ExecuteWithXmlParams>
                </soapenv:Body>
            </soapenv:Envelope>`;

            const response = await axios.post(apiURL, soapEnvelope, {
                headers: {
                    'Authorization': `Basic ${this.getCredentials()}`,
                    'Content-Type': 'text/xml;charset=UTF-8',
                    'SOAPAction': 'http://www.totvs.com/IwsProcess/ExecuteWithXmlParams',
                }
            });

            let result = await FUNCTIONS.buscaResultadoCotacao(response.data)

            if (result.includes('=')) {
                throw new Error('Resposta da API inválida ou vazia.');
            }

            return true
        } catch (error) {
            throw new Error(error);
        }
    }

    gerarXMLProdutosPorFornecedor = (listaDeItens, CODCCUSTO, COLIGADADEENTREGA, FILIALDEENTREGA, CODTMVGERADO) => {
        try {
            // Agrupa os produtos por fornecedor
            const fornecedores = listaDeItens.reduce((acc, item) => {
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
                        <codCCusto>${CODCCUSTO}</codCCusto>
                        <codCfo>${produto.CODCFO}</codCfo>
                        <codColCfo>0</codColCfo>
                        <codColMov>${COLIGADADEENTREGA}</codColMov>
                        <codCpgNegociada>${produto.CODCPGNEGOCIADA}</codCpgNegociada>
                        <codDepartamento />
                        <codFilial>${FILIALDEENTREGA}</codFilial>
                        <codFilialEntrega>0</codFilialEntrega>
                        <codLoc>01.001</codLoc>
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
    };

}

export class ConfigManagerZeev {
    private configuracoes: Record<string, { url: string }>;

    constructor() {
        this.configuracoes = {
            prod: {
                url: process.env.ZEEV_PROD || '',
            },
            dev: {
                url: process.env.ZEEV_PROD || '',
            }
        };
    }

    private getStage() {
        const stage = process.env.Stage;
        if (!stage || !this.configuracoes[stage]) {
            throw new Error(`Configuração para o stage '${stage}' não encontrada.`);
        }
        return this.configuracoes[stage];
    }


    private encodeCredentials(): string {
        const TOKEN_ZEEV = process.env.TOKEN_ZEEV;

        return TOKEN_ZEEV
    }


    getUrl(): string {
        return this.getStage().url;
    }

    getCredentials(): string {
        return this.encodeCredentials();
    }

    async setValueFields(json: object, instance: string): Promise<any> {
        const apiURL = `${this.getUrl()}api/2/formvalues/${instance}`;

        let envelope = {
            "formValues": json,
            "updateClosedInstance": false
        }

        let headers = {
            headers: {
                'Authorization': `Bearer ${this.getCredentials()}`,
                'Content-Type': 'application/json'
            }
        }

        let retries = 3
        let delay = 1

        for (let i = 0; i < retries; i++) {
            try {
                const response = await axios.patch(apiURL, envelope, headers);
                return response.data;
            } catch (error) {
                if (i < retries - 1) {
                    console.warn(`Tentativa ${i + 1} falhou, tentando novamente em ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw error; // Repropaga o erro se for a última tentativa
                }
            }
        }
    }
}

export class ConfigManagerGoogle {
    private client: JWT;

    constructor() {
        // Obter as credenciais a partir do environment variable
        const credentials = process.env.CREDENTIALS_GOOGLE
            ? JSON.parse(process.env.CREDENTIALS_GOOGLE)
            : null;

        if (!credentials) {
            throw new Error('Credenciais do Google não encontradas.');
        }

        this.client = new google.auth.JWT(
            credentials.client_email,
            undefined,
            credentials.private_key,
            ['https://www.googleapis.com/auth/drive'],
            undefined
        );
    }

    public async getAccessToken(): Promise<string> {
        try {
            const res = await this.client.getAccessToken();
            if (res.token) {
                return res.token;
            } else {
                throw new Error('Falha ao obter o token de acesso.');
            }
        } catch (error) {
            console.error('Erro ao obter o token de acesso:', error);
            throw error;
        }
    }

    public async liberaPermissaoAnexo(anexo: string): Promise<any[]> {
        try {
            const res = await this.client.getAccessToken();

            let apiURL = `https://www.googleapis.com/drive/v3/files/${anexo}/permissions`

            let headers = {
                'Authorization': `Bearer ${res.token}`,
                'Content-Type': 'application/json'
            };

            let dominios = [
                "colegioqi.com.br",
                "aocuboeducacao.com.br",
                "colegioleonardodavinci.com.br",
                "crechebomtempo.com.br",
                "crecheescolaipe.com.br",
                "crecheglobaltree.com.br",
                "crecheipe.com.br",
                "crechesunny.com.br",
                "cubo.global",
                "matrizeducacao.com.br",
                "parceiros.proraiz.com.br",
                "parceiros.raizeducacao.com.br",
                "proraiz.com.br",
                "raizeducacao.com.br",
                "sarahdawseyjf.com.br",
                "sdjf.com.br",
                "unificado.com.br",
                "escolaintegra.com",
                "colegioapogeu.com.br",
                "escolasap.com.br",
                "sapereira.com.br"
            ]

            let respostas = []

            for (let i = 0; i < dominios.length; i++) {
                let envelope = {
                    "type": "domain",
                    "role": "reader",  // Pode ser "reader", "writer", "owner"
                    "domain": dominios[i]// E-mail da pessoa com quem você quer compartilhar
                }
                let resposta = await axios.post(apiURL, envelope, { headers: headers })
                respostas.push(resposta.data);
            }

            if (respostas) {
                return respostas
            } else {
                throw new Error('Falha ao obter o token de acesso.');
            }
        } catch (error) {
            console.error('Erro ao obter o token de acesso:', error);
            throw error;
        }
    }
}
