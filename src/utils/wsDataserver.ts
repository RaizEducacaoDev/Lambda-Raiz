import axios from 'axios';
import * as XML from './xml'

/**
 * Classe responsável pelo gerenciamento das configurações de conexão com o RM
 * @class ConfigManagerRm
 */
export class wsDataserver {
    /**
     * Estrutura de configurações por ambiente
     * @typedef {Object} ConfiguracaoStage
     * @property {string} url - URL do servidor RM
     */
    private configuracoes: Record<string, ConfiguracaoStage>;

    /**
     * Construtor que inicializa as configurações dos ambientes
     * @constructor
     */
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

    /**
     * Obtém as configurações do ambiente atual
     * @private
     * @returns {ConfiguracaoStage} Configurações do ambiente
     * @throws {Error} Se o ambiente não estiver configurado corretamente
     */
    private getStage(): ConfiguracaoStage {
        const stage = process.env.STAGE || 'dev';
        const stagesDisponiveis = Object.keys(this.configuracoes).join(', ');

        if (!stage || !this.configuracoes[stage]) {
            throw new Error(`Ambiente '${stage}' não configurado. Ambientes disponíveis: ${stagesDisponiveis}`);
        }
        return this.configuracoes[stage];
    }

    /**
     * Valida e codifica as credenciais de acesso
     * @private
     * @returns {string} Credenciais codificadas em Base64
     * @throws {Error} Se as variáveis de ambiente não estiverem definidas
     */
    private encodeCredentials(): string {
        const validarVariavelAmbiente = (nome: string, valor?: string): string => {
            if (!valor || valor.trim() === '') {
                throw new Error(`Variável de ambiente ${nome} não está definida ou é inválida`);
            }
            return valor;
        };

        const username = validarVariavelAmbiente('USERNAME_TOTVS', process.env.USERNAME_TOTVS);
        const password = validarVariavelAmbiente('PASSWORD_TOTVS', process.env.PASSWORD_TOTVS);

        return Buffer.from(`${username}:${password}`).toString('base64');
    }

    /**
     * Obtém a URL base do servidor RM para o ambiente atual
     * @returns {string} URL do servidor
     */
    getUrl(): string {
        return this.getStage().url;
    }

    /**
     * Obtém as credenciais de autenticação codificadas
     * @returns {string} Token de autenticação Basic
     */
    getCredentials(): string {
        return this.encodeCredentials();
    }

    public async saveRecord(cData: string, dataServer: string, contexto: string): Promise<string> {
        if (!cData || !dataServer) {
            throw new Error('CDATA, DATASERVER são obrigatórios');
        }

        const url = `${this.getUrl()}:8051/wsDataServer/IwsDataServer`;
        const headers = {
            'Authorization': `Basic ${this.getCredentials()}`,
            'Content-Type': 'text/xml;charset=UTF-8',
            'SOAPAction': 'http://www.totvs.com/IwsDataServer/SaveRecord'
        };

        const soapEnvelope =
            `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
                <soapenv:Header/>
                <soapenv:Body>
                    <tot:SaveRecord>
                        <tot:DataServerName>${dataServer}</tot:DataServerName>
                        <tot:XML>
                            ${cData}
                        </tot:XML>
                        <tot:Contexto>${contexto}</tot:Contexto>
                    </tot:SaveRecord>
                </soapenv:Body>
            </soapenv:Envelope>`;

        console.debug(`[AWS] XML: ${cData}`);
        try {
            const response = await axios.post(url, soapEnvelope, { headers });
            return XML.buscaResultado(response.data);
        } catch (error) {
            console.error('[AWS] Erro no saveRecord:', error);
            if (axios.isAxiosError(error)) {
                const message = `Erro na requisição SOAP: ${error.message}`;
                const status = error.response?.status;
                const data = error.response?.data;
                throw new Error(`${message} - Status: ${status} - Data: ${JSON.stringify(data)}`);
            }
            throw new Error(`Erro desconhecido na requisição SOAP: ${error}`);
        }
    }

    public async readReacord(primaryKey: string, dataServer: string, contexto: string): Promise<string> {
        if (!primaryKey || !dataServer) {
            throw new Error('PRIMARYKEY, DATASERVER são obrigatórios');
        }

        const url = `${this.getUrl()}:8051/wsDataServer/IwsDataServer`;
        const headers = {
            'Authorization': `Basic ${this.getCredentials()}`,
            'Content-Type': 'text/xml;charset=UTF-8',
            'SOAPAction': 'http://www.totvs.com/IwsDataServer/ReadRecord'
        };

        const soapEnvelope =
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tot="http://www.totvs.com/">
            <soapenv:Header/>
            <soapenv:Body>
            <tot:ReadRecord>
                <tot:DataServerName>${dataServer}</tot:DataServerName>
                <tot:PrimaryKey>${primaryKey}</tot:PrimaryKey>
                <tot:Contexto>${contexto}</tot:Contexto>
            </tot:ReadRecord>
            </soapenv:Body>
        </soapenv:Envelope>`;

        console.debug(`[AWS] XML: ${soapEnvelope}`);
        try {
            const response = await axios.post(url, soapEnvelope, { headers });
            return XML.buscaResultadoRead(response.data);
        } catch (error) {
            console.error('[AWS] Erro no readReacord:', error);
            if (axios.isAxiosError(error)) {
                const message = `Erro na requisição SOAP: ${error.message}`;
                const status = error.response?.status;
                const data = error.response?.data;
                throw new Error(`${message} - Status: ${status} - Data: ${JSON.stringify(data)}`);
            }
            throw new Error(`Erro desconhecido na requisição SOAP: ${error}`);
        }
    }
}

/**
 * Tipo para configurações de ambiente
 * @typedef {Object} ConfiguracaoStage
 * @property {string} url - URL do servidor RM
 */
type ConfiguracaoStage = {
    url: string;
};