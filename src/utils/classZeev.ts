import axios from 'axios';

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
        const stage = process.env.STAGE || 'dev';
        if (!stage || !this.configuracoes[stage]) {
            throw new Error(`Configuração para o stage '${(stage as string)}' não encontrada.`);
        }
        return this.configuracoes[stage];
    }


    private encodeCredentials(): string {
        const TOKEN_ZEEV = process.env.TOKEN_ZEEV;

        return TOKEN_ZEEV || '';
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