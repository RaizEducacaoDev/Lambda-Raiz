import axios from 'axios';

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
            const response = await axios.get(`${url}initSession?user_token=${userToken}`, {
                headers: { 'App-Token': appToken }
            });
            return response.data.session_token.replace(/['"]/g, '');
        } catch (error) {
            console.error('Erro ao obter Session Token:', error);
            if (error instanceof Error) {
                throw new Error(`Erro ao obter Session Token: ${error.message}`);
            }
            throw new Error('Erro ao obter Session Token: Erro desconhecido');
        }
    }

    async buscaIdDoUsuario(email: string, sessionToken: string): Promise<number> {
        const ambiente = process.env.STAGE || 'dev';
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
            if (erro instanceof Error) {
                console.error('Não foi possível encontrar o solicitante no GLPI', erro.message);
            } else {
                console.error('Não foi possível encontrar o solicitante no GLPI', 'Unknown error');
            }
            return 15
        }
    }
}