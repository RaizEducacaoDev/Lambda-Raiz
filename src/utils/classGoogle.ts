import axios from 'axios';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

/**
 * Classe utilitária para interagir com a API do Google Drive de forma genérica.
 * Permite autenticação, busca, download e manipulação de permissões de arquivos.
 */
export class GoogleDriveHelper {
    private client: JWT;

    /**
     * Inicializa o helper com as credenciais do Google.
     * As credenciais devem estar disponíveis nas variáveis de ambiente:
     * GOOGLE_CLIENT_EMAIL e GOOGLE_PRIVATE_KEY.
     */
    constructor(scopes: string[] = ['https://www.googleapis.com/auth/drive']) {
        const client_email = process.env.GOOGLE_CLIENT_EMAIL;
        const private_key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
        if (!client_email || !private_key) {
            throw new Error('Google credentials not found.');
        }
        this.client = new google.auth.JWT(
            client_email,
            undefined,
            private_key,
            scopes
        );
    }

    /**
     * Obtém um token de acesso válido para autenticação nas APIs Google.
     * @returns Token de acesso como string.
     */
    public async getAccessToken(): Promise<string> {
        const { token } = await this.client.getAccessToken();
        if (!token) throw new Error('Failed to obtain access token.');
        return token;
    }

    /**
     * Concede permissão de leitura para um arquivo do Drive a um domínio ou e-mail.
     * @param fileId ID do arquivo no Google Drive.
     * @param permissionConfig Objeto de configuração de permissão (type, role, domain/emailAddress).
     * @returns Dados da permissão criada.
     */
    public async grantPermission(
        fileId: string,
        permissionConfig: {
            type: 'user' | 'group' | 'domain' | 'anyone',
            role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader',
            domain?: string,
            emailAddress?: string
        }
    ): Promise<any> {
        const token = await this.getAccessToken();
        const apiURL = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`;
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        try {
            const { data } = await axios.post(apiURL, permissionConfig, { headers });
            return data;
        } catch (error: any) {
            console.error(`Error granting permission for ${fileId}:`, {
                message: error.message,
                response: error.response?.data,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Busca o primeiro arquivo dentro de uma pasta cujo nome contenha uma substring específica.
     * @param folderId ID da pasta no Google Drive.
     * @param namePart Substring a ser buscada no nome do arquivo.
     * @param extension (Opcional) Extensão do arquivo para priorizar na busca.
     * @returns ID do arquivo encontrado ou null se não houver.
     */
    public async findFileIdInFolder(
        folderId: string,
        namePart: string,
        extension?: string
    ): Promise<string | null> {
        const token = await this.getAccessToken();
        const q = `'${folderId}' in parents and name contains '${namePart}'`;

        try {
            const { data } = await axios.get('https://www.googleapis.com/drive/v3/files', {
                params: { q, fields: 'files(id,name)' },
                headers: { Authorization: `Bearer ${token}` }
            });

            const files: Array<{ id: string; name: string }> = data.files || [];
            if (!files.length) return null;
            if (extension) {
                const extFile = files.find(f => f.name.toUpperCase().endsWith(extension.toUpperCase()));
                if (extFile) return extFile.id;
            }
            return files[0].id;
        } catch (err: any) {
            console.error('Error searching file in Drive:', err.response?.data || err.message || err);
            throw err;
        }
    }

    /**
     * Faz o download do conteúdo bruto de um arquivo no Drive, retornando como string.
     * @param fileId ID do arquivo no Google Drive.
     * @param encoding Codificação do arquivo (padrão: 'utf8').
     * @returns Conteúdo completo do arquivo como string.
     */
    public async downloadFileContent(fileId: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
        const token = await this.getAccessToken();
        try {
            const { data } = await axios.get(
                `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
                {
                    responseType: 'arraybuffer',
                    headers: { Authorization: `Bearer ${token}` }
                }
            );
            return Buffer.from(data).toString(encoding);
        } catch (err: any) {
            console.error('Error downloading file content:', err.response?.data || err.message || err);
            throw err;
        }
    }

    /**
     * Busca um arquivo pelo nome dentro de uma pasta e retorna seu conteúdo como string.
     * @param folderId ID da pasta no Google Drive.
     * @param namePart Substring do nome do arquivo a ser buscada.
     * @param extension (Opcional) Extensão do arquivo para priorizar na busca.
     * @param encoding (Opcional) Codificação do arquivo (padrão: 'utf8').
     * @returns Conteúdo do arquivo ou null se não encontrar.
     */
    public async getFileContentFromFolder(
        folderId: string,
        namePart: string,
        extension?: string,
        encoding: BufferEncoding = 'utf8'
    ): Promise<string | null> {
        const fileId = await this.findFileIdInFolder(folderId, namePart, extension);
        return fileId ? this.downloadFileContent(fileId, encoding) : null;
    }
}
