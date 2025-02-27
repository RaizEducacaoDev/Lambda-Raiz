import axios from 'axios';

export class ConfigManagerGlpi {
    private configuracoes: Record<string, { appToken: string; userToken: string; url: string }>;

    constructor() {
        // Centralizar todas as variáveis de ambiente e facilitar a adição de novos ambientes
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

    // Função genérica para acessar qualquer configuração
    private getConfig(AMBIENTE: string) {
        const config = this.configuracoes[AMBIENTE];
        if (!config) throw new Error(`Configuração para o ambiente ${AMBIENTE} não encontrada`);
        return config;
    }

    // Função para obter a URL do ambiente
    getUrl(AMBIENTE: string): string {
        return this.getConfig(AMBIENTE).url;
    }

    // Função para obter o Token de usuário do ambiente
    getUserToken(AMBIENTE: string): string {
        return this.getConfig(AMBIENTE).userToken;
    }

    // Função para obter o Token de aplicação do ambiente
    getAppToken(AMBIENTE: string): string {
        return this.getConfig(AMBIENTE).appToken;
    }

    // Função para iniciar sessão e obter o Session Token
    async getSessionToken(AMBIENTE: string): Promise<string> {
        const { url, userToken, appToken } = this.getConfig(AMBIENTE);

        try {
            const response = await axios.get(`${url}/initSession?user_token=${userToken}`, {
                headers: { 'App-Token': appToken }
            });
            // Retorna o session_token sem aspas
            return response.data.session_token.replace(/['"]/g, '');
        } catch (error) {
            throw new Error(`Erro ao obter Session Token: ${error.message}`);
        }
    }
}

export function valorNaoDefinido(valor: any){
    if(valor == '' || valor == null || valor == undefined){
        return 'AINDA NÃO DEFINIDO'
    } else {
        return valor
    }
}

export async function buscaIdDoUsuario(email: string): Promise<number> {
    const configManager = new ConfigManagerGlpi();

    try {
        const sessionToken = await configManager.getSessionToken(process.env.Stage);
        const userToken = configManager.getUserToken(process.env.Stage);
        const appToken = configManager.getAppToken(process.env.Stage);

        const apiURL = `${configManager.getUrl(process.env.Stage)}search/User?criteria[0][field]=5&criteria[0][searchtype]=contains&criteria[0][value]=${email}&session_token=${sessionToken}&forcedisplay[0]=5&forcedisplay[1]=2`;

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
            throw new Error('O campo "2" não é um número válido.');
        }

    } catch (erro) {
        console.error('Erro ao buscar ID do usuário:', erro);
        throw erro;
    }
}

export function transformToObjectChapas(str: string): { chapa: string, cargo: string }[] {
    // Regex atualizado para capturar corretamente os campos chapa e cargo
    const regex = /chapa:\s*([^,]+),\s*cargo:\s*([^}]+)\}/g;
    const result: { chapa: string, cargo: string }[] = [];

    let match;
    while ((match = regex.exec(str)) !== null) {
        const chapa = match[1].trim();
        const cargo = match[2].trim();

        // Adicionando o objeto no array
        result.push({ chapa, cargo });
    }

    // Retorna o array de objetos
    return result;
}