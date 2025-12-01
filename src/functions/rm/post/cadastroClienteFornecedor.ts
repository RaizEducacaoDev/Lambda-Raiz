import { APIGatewayProxyHandler } from 'aws-lambda';
import { formatResponse } from '../../../utils/response';
import * as wsDataserver from '../../../utils/wsDataserver';
import * as XML from '../../../utils/xml';

const dataServer = new wsDataserver.wsDataserver();

interface ClienteFornecedorBody {
    CODCOLIGADA: number;
    NOMEFANTASIA: string;
    NOME: string;
    CGCCFO: string;
    RUA: string;
    NUMERO: number;
    BAIRRO: string;
    CIDADE: string;
    CODETD: string;
    CEP: string;
    TELEFONE: string;
    CELULAR: string;
    EMAIL: string;
    CODMUNICIPIO: string;
    PESSOAFISOUJUR: string;
    FUNCIONARIO_PJ: string;
}

export const handler: APIGatewayProxyHandler = async (event) => {
    try {
        const campos: ClienteFornecedorBody = JSON.parse(event.body as string);
        console.info('[RM-INFO] Campos recebidos:', JSON.stringify(campos, null, 2));

        // Construir tags FCFO (sempre com CODCOLIGADA = 0 para coligada global)
        const tagsFCFO = [
            ['CODCOLIGADA', '0'],
            ['IDCFO', '-1'],
            ['CODCFO', '-1'],
            ['NOMEFANTASIA', campos.NOMEFANTASIA],
            ['NOME', campos.NOME],
            ['CGCCFO', campos.CGCCFO],
            ['PAGREC', '3'],
            ['TIPORUA', '1'],
            ['RUA', campos.RUA],
            ['NUMERO', campos.NUMERO.toString()],
            ['TIPOBAIRRO', '1'],
            ['BAIRRO', campos.BAIRRO],
            ['CIDADE', campos.CIDADE],
            ['CODETD', campos.CODETD],
            ['IDPAIS', '1'],
            ['CEP', campos.CEP],
            ['TELEFONE', campos.TELEFONE],
            ['TELEX', campos.CELULAR],
            ['EMAIL', campos.EMAIL],
            ['ATIVO', '1'],
            ['CODMUNICIPIO', campos.CODMUNICIPIO],
            ['PESSOAFISOUJUR', campos.PESSOAFISOUJUR]
        ].map(([tag, valor]) => XML.montaTag(tag, valor));

        // Construir tags FCFOCOMPL (sempre com CODCOLIGADA = 0 para coligada global)
        const tagsFCFOCOMPL = [
            ['CODCOLIGADA', '0'],
            ['CODCFO', '-1'],
            ['FUNCIONARIO_PJ', campos.FUNCIONARIO_PJ]
        ].map(([tag, valor]) => XML.montaTag(tag, valor));

        // Construir CDATA completo
        let cData = '<![CDATA[<FinCFOBR>';
        cData += '<FCFO>';
        tagsFCFO.forEach(tag => { cData += tag; });
        cData += '</FCFO>';
        cData += '<FCFOCOMPL>';
        tagsFCFOCOMPL.forEach(tag => { cData += tag; });
        cData += '</FCFOCOMPL>';
        cData += '</FinCFOBR>]]>';

        if (!cData) {
            throw new Error('Falha ao gerar XML de cliente/fornecedor');
        }

        console.info('[RM-INFO] CDATA gerado:', cData);

        // Chamada para o dataserver com o contexto correto
        const contexto = `CODCOLIGADA=1;CODUSUARIO=zeev.fin`;
        let result = await dataServer.saveRecord(cData, 'FinCFODataBR', contexto);

        if (!(result).includes('=')) {
            const CODCFO = result.split(';')[1] || result;
            return formatResponse(200, { CODCFO, message: 'Cliente/Fornecedor cadastrado com sucesso' });
        } else {
            const matchResult = result.match(/^[\s\S]*?(?=^=+)/m);
            if (!matchResult) {
                throw new Error('Falha ao extrair mensagem de erro do resultado');
            }
            const error = matchResult[0];
            const cleanError = error.replace(/&#xD;|\r|\n/g, ' ');

            const hasProduto = /produto/i.test(cleanError);
            const hasData = /data/i.test(cleanError);
            const hasMetta = /METTA/i.test(cleanError);
            const splitMessage = cleanError.split(':');

            let errorMessage;
            const mainErrorMatch = cleanError.match(/^(.*?)(?:=+|at RM\.|$)/s);
            if (mainErrorMatch && mainErrorMatch[1]) {
                errorMessage = mainErrorMatch[1].trim();
            } else if (hasProduto) {
                errorMessage = cleanError.trim();
            } else if (hasMetta) {
                const dateErrorMatch = cleanError.match(/METTA\d+\.\s*- (.*)/);
                errorMessage = dateErrorMatch ? dateErrorMatch[1].trim() : cleanError.trim();
            } else if (hasData) {
                const dateErrorMatch = cleanError.match(/:(.*?)[.]/);
                errorMessage = dateErrorMatch ? dateErrorMatch[1].trim() : cleanError.trim();
            } else if (splitMessage.length > 2) {
                errorMessage = splitMessage[1].trim() + ': ' + splitMessage[2].trim();
            } else {
                errorMessage = cleanError.includes(':') ? (cleanError.split(':')[1].trim()) : cleanError.trim();
            }

            console.warn('[RM-WARN] ', errorMessage);
            return formatResponse(400, { message: 'Erro ao cadastrar cliente/fornecedor no TOTVS', error: "TOTVS: " + errorMessage });
        }
    } catch (error) {
        console.error('[RM-ERRO] ', error);
        return formatResponse(500, { message: 'Erro interno do servidor', error: "TICKET: " + (error instanceof Error ? error.message : String(error)) });
    }
};
