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

export async function buscaResultado(xmlString: string): Promise<any> {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        allowBooleanAttributes: true
    });

    try {
        const json = parser.parse(xmlString.trim());
        return json['s:Envelope']['s:Body'][0]['SaveRecordResponse'][0]['SaveRecordResult'][0];
    } catch (error) {
        console.error("Erro ao converter XML para JSON:", error);
        throw error;
    }
}

export async function buscaResultadoCotacao(xmlString: string): Promise<any> {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        allowBooleanAttributes: true
    });

    try {
        const json = parser.parse(xmlString.trim());
        return json['s:Envelope']['s:Body'][0]['ExecuteWithXmlParamsResponse'][0]['ExecuteWithXmlParamsResult'][0];
    } catch (error) {
        console.error("Erro ao converter XML para JSON:", error);
        throw error;
    }
}

export async function buscaUID(xmlString: string): Promise<any> {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        allowBooleanAttributes: true
    });

    try {
        const json = parser.parse(xmlString.trim());
        return json["s:Envelope"]["s:Body"][0].GenerateReportResponse[0].GenerateReportResult[0];;
    } catch (error) {
        console.error("Erro ao converter XML para JSON:", error);
        throw error;
    }
}

export async function buscaSIZE(xmlString: string): Promise<any> {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        allowBooleanAttributes: true
    });

    try {
        const json = parser.parse(xmlString.trim());
        return json['s:Envelope']['s:Body'][0].GetGeneratedReportSizeResponse[0].GetGeneratedReportSizeResult[0];
    } catch (error) {
        console.error("Erro ao converter XML para JSON:", error);
        throw error;
    }
}

export async function buscaFILE(xmlString: string): Promise<any> {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        allowBooleanAttributes: true
    });

    try {
        const json = parser.parse(xmlString.trim());
        return json['s:Envelope']['s:Body'][0].GetFileChunkResponse[0].GetFileChunkResult[0];
    } catch (error) {
        console.error("Erro ao converter XML para JSON:", error);
        throw error;
    }
}