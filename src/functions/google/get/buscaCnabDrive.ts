import { APIGatewayProxyHandler } from 'aws-lambda';
import { ConfigManagerGoogle } from './ConfigManagerGoogle';

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const manager = new ConfigManagerGoogle();

        // Para flexibilidade, lemos a pasta e o trecho do nome do body (ou ENV)
        const body = event.body ? JSON.parse(event.body) : {};
        const folderId = body.folderId || process.env.DRIVE_FOLDER_ID!;
        const namePart = body.namePart || '050625';

        // 1) Tenta localizar e baixar o arquivo
        const contentRet = await manager.getRetFileFromFolder(folderId, namePart);
        if (!contentRet) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: `Arquivo com "${namePart}" não encontrado em ${folderId}.` }),
                headers: { 'Content-Type': 'application/json' },
            };
        }

        // 2) Se encontrou, devolve o conteúdo (ou parseado, conforme você desejar)
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Arquivo .RET encontrado e baixado com sucesso.',
                rawContent: contentRet // cuidado: se for muito grande, talvez você queira processar antes de retornar
            }),
            headers: { 'Content-Type': 'application/json' },
        };
    } catch (err: any) {
        console.error('Erro no handler Lambda:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Erro interno ao processar .RET', error: err.message || err }),
            headers: { 'Content-Type': 'application/json' },
        };
    }
};
