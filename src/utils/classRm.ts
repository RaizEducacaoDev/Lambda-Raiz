import axios, { AxiosRequestConfig } from 'axios';
import * as FUNCTIONS from './xml';

type Stage = 'dev' | 'prod';

export class ConfigManagerRm {
  private configuracoes: Record<Stage, { url: string }>;

  constructor() {
    this.configuracoes = {
      prod: { url: process.env.RM_PROD || '' },
      dev: { url: process.env.RM_DEV || '' }
    };
  }

  private getStage(): { url: string } {
    const stage = (process.env.STAGE || 'dev') as Stage;

    if (!stage || !(stage in this.configuracoes)) {
      throw new Error(`Configuração para o stage '${String(stage)}' não encontrada.`);
    }

    const cfg = this.configuracoes[stage as Stage];
    if (!cfg?.url) {
      throw new Error(`URL do RM não configurada para stage '${stage}'. Verifique RM_${stage.toUpperCase()}.`);
    }

    return cfg;
  }

  private encodeCredentials(): string {
    const username = process.env.USERNAME_TOTVS;
    const password = process.env.PASSWORD_TOTVS;

    if (!username || !password) {
      throw new Error('Variáveis de ambiente USERNAME_TOTVS ou PASSWORD_TOTVS não estão definidas.');
    }

    return Buffer.from(`${username}:${password}`).toString('base64');
  }

  private getBaseUrl8051(): string {
    return `${this.getStage().url}:8051`;
  }

  private getAuthHeaders() {
    return { Authorization: `Basic ${this.encodeCredentials()}` };
  }

  private buildConsultaSqlUrl(codigoDaConsulta: string, sistema: string, parametros: Record<string, string>) {
    // Monta: CODCOLIGADA=2;IDMOV=123;...
    const paramStr = Object.entries(parametros)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join(';');

    return (
      `${this.getBaseUrl8051()}/api/framework/v1/consultaSQLServer/RealizaConsulta/` +
      `${codigoDaConsulta}/0/${sistema}?parameters=${paramStr}`
    );
  }

  private async getJson<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await axios.get(url, {
      headers: {
        ...this.getAuthHeaders(),
        Accept: 'application/json',
        ...(config?.headers || {})
      },
      timeout: 30000,
      validateStatus: (s) => s >= 200 && s < 300,
      ...config
    });

    return response.data as T;
  }

  private assertArrayResponse(data: any, contexto: string) {
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error(`[${contexto}] Resposta da API inválida ou vazia.`);
    }
  }

  getUrl(): string {
    return this.getStage().url;
  }

  getCredentials(): string {
    return this.encodeCredentials();
  }

  async getCotacao(movimentId: string, codColigada: string): Promise<string> {
    const url = this.buildConsultaSqlUrl('TICKET.RAIZ.0009', 'T', {
      CODCOLIGADA: codColigada,
      IDMOV: movimentId
    });

    try {
      const data = await this.getJson<any[]>(url);
      this.assertArrayResponse(data, 'getCotacao');

      const cod = data[0]?.CODCOTACAO;
      if (!cod) throw new Error('[getCotacao] Campo CODCOTACAO não retornado.');

      return cod;
    } catch (erro: any) {
      console.error('[getCotacao] Erro na consulta RM', {
        message: erro?.message || String(erro),
        url,
        status: erro?.response?.status,
        data: erro?.response?.data
      });
      throw erro;
    }
  }

  // ✅ multi-coligada obrigatório
  async getGanhador(CODCOLIGADA: string, CODCOTACAO: string): Promise<any[]> {
    const url = this.buildConsultaSqlUrl('TICKET.RAIZ.0011', 'T', {
      CODCOLIGADA,
      CODCOTACAO
    });

    try {
      const data = await this.getJson<any[]>(url);
      this.assertArrayResponse(data, 'getGanhador');
      return data;
    } catch (erro: any) {
      console.error('[getGanhador] Erro na consulta RM', {
        message: erro?.message || String(erro),
        url,
        status: erro?.response?.status,
        data: erro?.response?.data
      });
      throw erro;
    }
  }

  // ✅ atualizado para multi-coligada (mesmo raciocínio)
  async getOC(CODCOLIGADA: string, CODCOTACAO: string, IDMOV: string): Promise<string> {
    const url = this.buildConsultaSqlUrl('TICKET.RAIZ.0011', 'T', {
      CODCOLIGADA,
      CODCOTACAO,
      IDMOV
    });

    try {
      const data = await this.getJson<any[]>(url);
      this.assertArrayResponse(data, 'getOC');

      const idMovString = data.map((item: { IDMOV: string }) => item.IDMOV).filter(Boolean).join(' | ');
      if (!idMovString) throw new Error('[getOC] Campo IDMOV não retornado.');
      return idMovString;
    } catch (erro: any) {
      console.error('[getOC] Erro na consulta RM', {
        message: erro?.message || String(erro),
        url,
        status: erro?.response?.status,
        data: erro?.response?.data
      });
      throw erro;
    }
  }

  async getLOC(CODCOLIGADA: string, CODFILIAL: string): Promise<string> {
    const url = this.buildConsultaSqlUrl('TICKET.RAIZ.0041', 'T', {
      CODCOLIGADA,
      CODFILIAL
    });

    try {
      const data = await this.getJson<any[]>(url);
      this.assertArrayResponse(data, 'getLOC');

      const codLoc = data[0]?.CODLOC;
      if (!codLoc) throw new Error('[getLOC] Campo CODLOC não retornado.');
      return codLoc;
    } catch (erro: any) {
      console.error('[getLOC] Erro na consulta RM', {
        message: erro?.message || String(erro),
        url,
        status: erro?.response?.status,
        data: erro?.response?.data
      });
      throw erro;
    }
  }

  async postComunicaFornecedor(
    CODCOLIGADA: string,
    CODFILIAL: string,
    cotacao: string,
    regerarSenha: string,
    listaDeFornecedores: object[],
    dataLimiteDeResposta: string
  ): Promise<string> {
    try {
      const LINK = `Portal: ${this.getUrl()}/FrameHTML/Web/App/Cmp/PortalDoFornecedor/#/login`;
      const IdRelatorio = await this.buscaIdRelatorio(CODCOLIGADA);

      let fornecedores = '';
      let orcamento = '';

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
            <CODCOTACAO>${cotacao}</CODCOTACAO>
            <CODCOLCFO>0</CODCOLCFO>
            <CODCFO>${(listaDeFornecedores[i] as { codigoDoFornecedor: string }).codigoDoFornecedor}</CODCFO>
          </TCORCAMENTO>`;
      }

      const soapEnvelope =
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
          <soapenv:Header />
          <soapenv:Body>
            <tot:ExecuteWithXmlParams>
              <tot:ProcessServerName>CmpCotacaoComunicarFornecedoresProc</tot:ProcessServerName>
              <tot:strXmlParams><![CDATA[
                <CmpCotacaoComunicarFornecedoresParams xmlns="http://www.totvs.com.br/RM/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns:z="http://schemas.microsoft.com/2003/10/Serialization/">
                  <Context xmlns="http://www.totvs.com/" xmlns:a="http://www.totvs.com.br/RM/">
                    <a:_params xmlns:b="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
                      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODCOLIGADA</b:Key><b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODCOLIGADA}</b:Value></b:KeyValueOfanyTypeanyType>
                      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODFILIAL</b:Key><b:Value i:type="c:int" xmlns:c="http://www.w3.org/2001/XMLSchema">${CODFILIAL}</b:Value></b:KeyValueOfanyTypeanyType>
                      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODSISTEMA</b:Key><b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">T</b:Value></b:KeyValueOfanyTypeanyType>
                      <b:KeyValueOfanyTypeanyType><b:Key i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">$CODUSUARIO</b:Key><b:Value i:type="c:string" xmlns:c="http://www.w3.org/2001/XMLSchema">p_heflo</b:Value></b:KeyValueOfanyTypeanyType>
                    </a:_params>
                    <a:Environment>DotNet</a:Environment>
                  </Context>
                  <AssuntoEmail>Pedido de Orçamento nº ${cotacao}</AssuntoEmail>
                  <CodColRel>${CODCOLIGADA}</CodColRel>
                  <CodColigada>${CODCOLIGADA}</CodColigada>
                  <CodCotacao>${cotacao}</CodCotacao>
                  <CorpoEmail>${LINK}</CorpoEmail>
                  <DataLimiteResposta>${dataLimiteDeResposta}</DataLimiteResposta>
                  <Fornecedores>${fornecedores}</Fornecedores>
                  <IdRelatorio>${IdRelatorio}</IdRelatorio>
                  <RegerarSenha>${regerarSenha}</RegerarSenha>
                  <TblFornecedores>
                    <diffgr:diffgram xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata">
                      <DocumentElement xmlns="">${orcamento}</DocumentElement>
                    </diffgr:diffgram>
                  </TblFornecedores>
                  <TipoComunicacao>WEB</TipoComunicacao>
                </CmpCotacaoComunicarFornecedoresParams>
              ]]></tot:strXmlParams>
            </tot:ExecuteWithXmlParams>
          </soapenv:Body>
        </soapenv:Envelope>`;

      const respostas = await axios.post(
        `${this.getBaseUrl8051()}/wsProcess/IwsProcess`,
        soapEnvelope,
        {
          transformResponse: (r) => r,
          headers: {
            ...this.getAuthHeaders(),
            'Content-Type': 'text/xml;charset=UTF-8',
            SOAPAction: 'http://www.totvs.com/IwsProcess/ExecuteWithXmlParams'
          }
        }
      );

      let result = respostas.data;
      result = await FUNCTIONS.buscaResultadoCotacao(result);

      if (result === '1') return 'Fornecedores comunicados com sucesso';
      console.error('[postComunicaFornecedor] RM retornou resultado diferente de 1:', JSON.stringify(result).substring(0, 500));
      throw new Error('Não foi possível comunicar os fornecedores');
    } catch (erro) {
      console.error('[postComunicaFornecedor] Erro', erro);
      throw erro;
    }
  }

  async buscaIdRelatorio(codColigada: string): Promise<string> {
    const url = this.buildConsultaSqlUrl('TICKET.RAIZ.0013', 'T', { CODCOLIGADA: codColigada });

    try {
      const data = await this.getJson<any[]>(url);
      this.assertArrayResponse(data, 'buscaIdRelatorio');

      const id = data[0]?.ID;
      if (!id) throw new Error('[buscaIdRelatorio] Campo ID não retornado.');
      return id;
    } catch (erro: any) {
      console.error('[buscaIdRelatorio] Erro na consulta RM', {
        message: erro?.message || String(erro),
        url,
        status: erro?.response?.status,
        data: erro?.response?.data
      });
      throw erro;
    }
  }

  async consultaSQL(codigoDaConsulta: string, sistema: string, parametros: string): Promise<any> {
    try {
      const apiURL =
        `${this.getBaseUrl8051()}/api/framework/v1/consultaSQLServer/RealizaConsulta/` +
        `${codigoDaConsulta}/0/${sistema}?parameters=${parametros}`;

      const response = await axios.get(apiURL, {
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        timeout: 30000,
        validateStatus: (status) => status >= 200 && status < 300
      });

      if (!response.data) throw new Error('Empty response received from API');

      if (Array.isArray(response.data) && response.data.length > 0) return response.data;

      console.warn('[consultaSQL] No data found in response');
      return null;
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('[consultaSQL] TOTVS service query failed:', {
        error: errorMessage,
        query: codigoDaConsulta,
        params: parametros
      });
      throw new Error(`Failed to query TOTVS service: ${errorMessage}`);
    }
  }

  // ✅ corrigido: codColigada no SOAP estava 0
  async getQuadroComparativo(CODCOTACAO: string, CODCOLIGADA: string, NOMEARQUIVO: string): Promise<string> {
    try {
      const apiURL = `${this.getBaseUrl8051()}/wsReport/IwsReport`;

      const envelope =
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
          <soapenv:Header/>
          <soapenv:Body>
            <tot:GenerateReport>
              <tot:codColigada>${CODCOLIGADA}</tot:codColigada>
              <tot:id>2239</tot:id>
              <tot:filters/>
              <tot:parameters><![CDATA[
                <ArrayOfRptParameterReportPar xmlns:i="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.totvs.com.br/RM/">
                  <RptParameterReportPar>
                    <Description>CODCOTACAO</Description>
                    <ParamName>CODCOTACAO</ParamName>
                    <Value xmlns:d3p1="http://www.w3.org/2001/XMLSchema" i:type="d3p1:string">${CODCOTACAO}</Value>
                    <Visible>true</Visible>
                  </RptParameterReportPar>
                  <RptParameterReportPar>
                    <Description>CODCOLIGADA</Description>
                    <ParamName>CODCOLIGADA</ParamName>
                    <Value xmlns:d3p1="http://www.w3.org/2001/XMLSchema" i:type="d3p1:string">${CODCOLIGADA}</Value>
                    <Visible>true</Visible>
                  </RptParameterReportPar>
                </ArrayOfRptParameterReportPar>
              ]]></tot:parameters>
              <tot:fileName>${NOMEARQUIVO}</tot:fileName>
              <tot:contexto/>
            </tot:GenerateReport>
          </soapenv:Body>
        </soapenv:Envelope>`;

      const response = await axios.post(apiURL, envelope, {
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'text/xml;charset=UTF-8',
          SOAPAction: 'http://www.totvs.com/IwsReport/GenerateReport'
        }
      });

      const UID = await FUNCTIONS.buscaUID(response.data as any);
      if (!UID) throw new Error('[getQuadroComparativo] UID não retornado.');

      const envelope2 =
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
          <soapenv:Header/>
          <soapenv:Body>
            <tot:GetGeneratedReportSize>
              <tot:guid>${UID}</tot:guid>
            </tot:GetGeneratedReportSize>
          </soapenv:Body>
        </soapenv:Envelope>`;

      const response2 = await axios.post(apiURL, envelope2, {
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'text/xml;charset=UTF-8',
          SOAPAction: 'http://www.totvs.com/IwsReport/GetGeneratedReportSize'
        }
      });

      const SIZE = await FUNCTIONS.buscaSIZE(response2.data as any);
      if (!SIZE) throw new Error('[getQuadroComparativo] SIZE não retornado.');

      const envelope3 =
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
          <soapenv:Header/>
          <soapenv:Body>
            <tot:GetFileChunk>
              <tot:guid>${UID}</tot:guid>
              <tot:offset>0</tot:offset>
              <tot:length>${SIZE}</tot:length>
            </tot:GetFileChunk>
          </soapenv:Body>
        </soapenv:Envelope>`;

      const response3 = await axios.post(apiURL, envelope3, {
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'text/xml;charset=UTF-8',
          SOAPAction: 'http://www.totvs.com/IwsReport/GetFileChunk'
        }
      });

      const FILE = await FUNCTIONS.buscaFILE(response3.data as any);
      if (!FILE) throw new Error('[getQuadroComparativo] FILE não retornado.');

      return FILE;
    } catch (erro) {
      console.error('[getQuadroComparativo] Erro', erro);
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
                                            <d3p1:Value xmlns:d5p1="http://www.w3.org/2001/XMLSchema" i:type="d5p1:string">p_heflo</d3p1:Value>
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
      throw new Error(error instanceof Error ? error.message : 'An unknown error occurred');
    }
  }

  gerarXMLProdutosPorFornecedor = (
    listaDeItens: Array<{
      CODCFO: string;
      CODCPGNEGOCIADA: string;
      IDMOV: string;
      IDPRD: string;
      NSEQITMMOV: string;
    }>,
    CODCCUSTO: string,
    COLIGADADEENTREGA: string,
    FILIALDEENTREGA: string,
    CODTMVGERADO: string
  ): string => {
    try {
      const fornecedores = listaDeItens.reduce((acc, item) => {
        acc[item.CODCFO] = acc[item.CODCFO] || [];
        acc[item.CODCFO].push(item);
        return acc;
      }, {} as Record<string, typeof listaDeItens>);

      return Object.values(fornecedores)
        .flatMap((produtos) =>
          produtos.map(
            (produto) => `
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
              </a:ProdutoInclusaoMov>`
          )
        )
        .join('');
    } catch (error) {
      console.error('[gerarXMLProdutosPorFornecedor] Error generating XML:', error);
      return '';
    }
  };
}