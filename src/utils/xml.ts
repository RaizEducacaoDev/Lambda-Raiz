import { XMLParser } from 'fast-xml-parser';

export function escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"\\/]/g, (char) => {
        switch (char) {
            case '<': return '&lt;'
            case '>': return '&gt;'
            case '&': return '&amp;'
            case "'": return '&apos;'
            case '"': return '&quot;'
            case '/': return '&#x2F;'
            default: return char
        }
    })
}

export function montaTag(campo: string, valor: any): string {
    if ((valor != null) && (valor != "")) {
        return "<" + campo + ">" + valor + "</" + campo + "> ";
    } else
        return "";
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
        const json = parser.parse(xmlString.trim());
        if (!json['s:Envelope']) throw new Error('Missing s:Envelope in XML response');
        const body = json['s:Envelope']['s:Body'];
        const reportResponse = body[responseKey];
        if (!reportResponse) throw new Error(`Missing ${responseKey} in XML body`);
        const result = reportResponse[resultKey];
        if (!result) throw new Error(`Missing ${resultKey} in response`);
        return result;
    } catch (error) {
        console.error("Erro ao converter XML para JSON:", error);
        throw error;
    }
}

export async function buscaResultado(xmlString: string): Promise<any> {
    return parseXML(xmlString, 'SaveRecordResponse', 'SaveRecordResult');
}

export async function buscaResultadoCotacao(xmlString: string): Promise<any> {
    return parseXML(xmlString, 'ExecuteWithXmlParamsResponse', 'ExecuteWithXmlParamsResult');
}

export async function buscaUID(xmlString: string): Promise<any> {
    return parseXML(xmlString, 'GenerateReportResponse', 'GenerateReportResult');
}

export async function buscaSIZE(xmlString: string): Promise<any> {
    return parseXML(xmlString, 'GetGeneratedReportSizeResponse', 'GetGeneratedReportSizeResult');
}

export async function buscaFILE(xmlString: string): Promise<any> {
    return parseXML(xmlString, 'GetFileChunkResponse', 'GetFileChunkResult');
}