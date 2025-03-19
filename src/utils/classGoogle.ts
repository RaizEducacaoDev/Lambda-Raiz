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