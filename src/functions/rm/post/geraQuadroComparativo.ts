import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as RM from '../../../utils/classRm';
import * as GOOGLE from '../../../utils/classGoogle';
import axios from 'axios';

const ConfigManagerRm = new RM.ConfigManagerRm();
const ConfigManagerGoogle = new GOOGLE.ConfigManagerGoogle();

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        console.log('Iniciando processamento do quadro comparativo...');
        
        // Parse dos dados recebidos do corpo da requisição
        const campos = JSON.parse(event.body as string);

        // Determina CODCOLIGADA baseado na origem dos dados
        const CODCOLIGADA = campos.codigoDaColigada === '1'
            ? campos.codigoDaColigada2 || ''
            : campos.codigoDaColigada || '';

        // Determina CODFILIAL baseado na origem dos dados
        const CODFILIAL = campos.codigoDaColigada === '1'
            ? campos.codigoDaFilial2 || ''
            : campos.codigoDaFilial || '';

        console.log(`Definindo ganhador para coligada: ${CODCOLIGADA}, filial: ${CODFILIAL}`);
        ConfigManagerRm.defineGanhador(CODCOLIGADA as string, campos.cotacao as string, CODFILIAL as string);

        // Configuração do boundary para upload multipart
        const boundary = 'foo_bar_baz';
        const metadata = {
            'name': `Cotação - Ticket ${campos.ticketRaiz}.pdf`,
            'mimeType': 'application/pdf\r\n\r\n'
        };

        // Construção do payload multipart
        let data = `--${boundary}\n`;
        data += `content-type: application/json; charset=UTF-8\n\n`;
        data += JSON.stringify(metadata) + '\n';
        data += `--${boundary}\n`;

        data += `content-transfer-encoding: base64\n`;
        data += `content-type: application/pdf\n\n`;
        data += `${campos.file}\n`;
        data += `--${boundary}--`;

        console.log('Iniciando upload do PDF para o Google Drive...');
        const response = await axios.post(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
            data,
            {
                headers: {
                    'Authorization': `Bearer ${campos.token}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`,
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity
            }
        );

        let result = response.data.id

        if (result) {
            console.log(`Arquivo ${result} enviado com sucesso, liberando permissões...`);
            await ConfigManagerGoogle.liberaPermissaoAnexo(result);
            let link = `https://drive.google.com/file/d/${result}/view`
            return formatResponse(200, { link });
        } else {
            console.error('Falha no upload do arquivo para o Drive', response.data);
            let error = result
            return formatResponse(400, { message: 'Erro interno no servidor', error: error });
        }
    } catch (error) {
        console.error('Erro durante o processamento:', error);
        return formatResponse(500, {  
            message: 'Erro interno no servidor',  
            error: error instanceof Error ? error.message : String(error) 
        });
    }
};