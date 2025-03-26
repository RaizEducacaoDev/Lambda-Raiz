import axios from 'axios';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

export class ConfigManagerGoogle {
    private client: JWT;

    constructor() {
        // Obter as credenciais a partir do environment variable
        const credentials = {
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            project_id: process.env.GOOGLE_PROJECT_ID
        };

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
            console.log(`Iniciando liberação de permissões para o arquivo: ${anexo}`);
            
            // Obtém o token de acesso do cliente JWT
            const { token } = await this.client.getAccessToken();
            
            // Configuração da API do Google Drive
            const apiURL = `https://www.googleapis.com/drive/v3/files/${anexo}/permissions`;
            const headers = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            };
            
            // Lista de domínios autorizados
            const dominios = [
                "colegioqi.com.br",
                // ... outros domínios
            ];
            
            console.log(`Configurando permissões de leitura para ${dominios.length} domínios`);
            
            // Cria promises para cada permissão de domínio
            const permissionPromises = dominios.map((domain) => {
                console.log(`Adicionando permissão para o domínio: ${domain}`);
                
                const payload = {
                    type: "domain",
                    role: "reader",
                    domain: domain
                };
                
                return axios.post(apiURL, payload, { headers })
                            .then(response => response.data);
            });
            
            // Executa todas as operações de permissão
            const responses = await Promise.all(permissionPromises);
            
            console.log(`Permissões liberadas com sucesso para o arquivo: ${anexo}`);
            return responses;
        } catch (error) {
            console.error(`Erro ao liberar permissões para ${anexo}:`, error);
            throw error;
        }
    }
}