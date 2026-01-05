import { XMLParser } from 'fast-xml-parser';

export function corrigirXML(xml: string, novoIdPgto: number): string {
    const corrigidoNumeros = xml.replace(/>(\d+)\.(\d{4})</g, (_, intPart, decimalPart) => {
      const numero = parseFloat(`${intPart}.${decimalPart}`);
      const valorFormatado = numero.toFixed(2).replace('.', ',');
      return `>${valorFormatado}<`;
    });
  
    const corrigidoIdPgto = corrigidoNumeros.replace(
      /<IDPGTO>(.*?)<\/IDPGTO>/,
      `<IDPGTO>${novoIdPgto}</IDPGTO>`
    );
  
    return corrigidoIdPgto;
}
  

export function escapeXml(unsafe: string): string {
    if (typeof unsafe !== 'string') {
        throw new Error(`[XML-ERRO] escapeXml: Valor deve ser uma string, recebido: ${typeof unsafe}`);
    }
    
    return unsafe.replace(/[<>&'"\\]/g, (char) => {
        switch (char) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case "'": return '&apos;';
            case '"': return '&quot;';
            case '/': return '&#x2F;';
            default: return char;
        }
    });
}

export function montaTag(campo: string, valor: string | null | undefined): string {
    if (typeof campo !== 'string' || !campo.trim()) {
        throw new Error(`[XML-ERRO] montaTag: Nome do campo inválido. Campo deve ser uma string não vazia, recebido: "${campo}"`);
    }

    const isValorValido = valor !== null && valor !== undefined && valor.toString().trim() !== "" && valor.toString().trim() !== "NaN";

    if (isValorValido) {
        try {
            const valorString = valor.toString().trim();
            const valorEscapado = escapeXml(valorString);
            return `<${campo}>${valorEscapado}</${campo}>`;
        } catch (error) {
            throw new Error(`[XML-ERRO] montaTag: Falha ao processar valor para o campo "${campo}". ${error instanceof Error ? error.message : String(error)}`);
        }
    } else {
        return `<${campo}/>`;
    }
}

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseTagValue: false
});

async function parseXML<T>(
    xmlString: string,
    responseKey: string,
    resultKey: string
): Promise<T> {
    try {
        if (!xmlString || typeof xmlString !== 'string') {
            throw new Error(`[XML-PARSE-ERRO] XML inválido: String XML está vazia ou não é uma string válida`);
        }

        const trimmedXml = xmlString.trim();
        if (!trimmedXml.startsWith('<')) {
            throw new Error(`[XML-PARSE-ERRO] XML malformado: Conteúdo não parece ser XML válido. Início do conteúdo: "${trimmedXml.substring(0, 100)}..."`);
        }

        const json = parser.parse(trimmedXml);
        
        if (!json) {
            throw new Error(`[XML-PARSE-ERRO] Falha ao parsear XML: Parser retornou resultado vazio ou nulo`);
        }

        if (!json['s:Envelope']) {
            const availableKeys = Object.keys(json).join(', ');
            throw new Error(`[XML-PARSE-ERRO] Estrutura SOAP inválida: Elemento 's:Envelope' não encontrado. Elementos disponíveis: [${availableKeys}]`);
        }

        const body = json['s:Envelope']['s:Body'];
        if (!body) {
            const envelopeKeys = Object.keys(json['s:Envelope']).join(', ');
            throw new Error(`[XML-PARSE-ERRO] Corpo SOAP ausente: Elemento 's:Body' não encontrado no Envelope. Elementos disponíveis: [${envelopeKeys}]`);
        }

        const reportResponse = body[responseKey];
        if (!reportResponse) {
            const bodyKeys = Object.keys(body).join(', ');
            throw new Error(`[XML-PARSE-ERRO] Resposta esperada ausente: Elemento '${responseKey}' não encontrado no Body. Elementos disponíveis: [${bodyKeys}]`);
        }

        const result = reportResponse[resultKey];
        if (result === undefined || result === null) {
            const responseKeys = Object.keys(reportResponse).join(', ');
            throw new Error(`[XML-PARSE-ERRO] Resultado esperado ausente: Elemento '${resultKey}' não encontrado em '${responseKey}'. Elementos disponíveis: [${responseKeys}]`);
        }

        return result;
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('[XML-PARSE-ERRO]')) {
            throw error; // Re-throw nossos erros customizados
        }
        
        // Melhor tratamento para erros do parser
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`[XML-PARSE-ERRO] Falha no processamento XML: ${errorMessage}. Verifique se o XML está bem formado e contém a estrutura SOAP esperada.`);
    }
}

export async function buscaResultado(xmlString: string): Promise<string> {
    try {
        return await parseXML(xmlString, 'SaveRecordResponse', 'SaveRecordResult');
    } catch (error) {
        throw new Error(`[SAVERECORD-ERRO] Falha ao processar resposta do SaveRecord: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function buscaResultadoRead(xmlString: string): Promise<string> {
    try {
        return await parseXML(xmlString, 'ReadRecordResponse', 'ReadRecordResult');
    } catch (error) {
        throw new Error(`[READRECORD-ERRO] Falha ao processar resposta do ReadRecord: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function buscaResultadoCotacao(xmlString: string): Promise<any> {
    try {
        return await parseXML(xmlString, 'ExecuteWithXmlParamsResponse', 'ExecuteWithXmlParamsResult');
    } catch (error) {
        throw new Error(`[COTACAO-ERRO] Falha ao processar resposta da cotação: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function buscaUID(xmlString: string): Promise<any> {
    try {
        return await parseXML(xmlString, 'GenerateReportResponse', 'GenerateReportResult');
    } catch (error) {
        throw new Error(`[REPORT-UID-ERRO] Falha ao processar UID do relatório: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function buscaSIZE(xmlString: string): Promise<any> {
    try {
        return await parseXML(xmlString, 'GetGeneratedReportSizeResponse', 'GetGeneratedReportSizeResult');
    } catch (error) {
        throw new Error(`[REPORT-SIZE-ERRO] Falha ao processar tamanho do relatório: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function buscaFILE(xmlString: string): Promise<any> {
    try {
        return await parseXML(xmlString, 'GetFileChunkResponse', 'GetFileChunkResult');
    } catch (error) {
        throw new Error(`[FILE-CHUNK-ERRO] Falha ao processar chunk do arquivo: ${error instanceof Error ? error.message : String(error)}`);
    }
}