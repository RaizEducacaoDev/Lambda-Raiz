// import axios from 'axios';
import * as xml2js from 'xml2js';

export function valorNaoDefinido(valor: any) {
    if (valor == '' || valor == null || valor == undefined) {
        return 'AINDA NÃO DEFINIDO'
    } else {
        return valor
    }
}

export function transformToObjectChapas(str: string): { chapa: string, cargo: string }[] {
    const regex = /chapa:\s*([^,]+),\s*cargo:\s*([^}]+)\}/g;
    const result: { chapa: string, cargo: string }[] = [];

    let match;
    while ((match = regex.exec(str)) !== null) {
        const chapa = match[1].trim();
        const cargo = match[2].trim();

        result.push({ chapa, cargo });
    }

    return result;
}

export function criaItensOC(str: string): { codigoDoItem: string, qtdDoItem: string, precoDoItem: string }[] {
    const regex = /codigoDoItem:\s*([^,]+),\s*qtdDoItem:\s*([^,]+),\s*precoDoItem:\s*([^}]+)\}/g;
    const result: { codigoDoItem: string, qtdDoItem: string, precoDoItem: string }[] = [];

    let match;
    while ((match = regex.exec(str)) !== null) {
        const codigoDoItem = match[1].trim();
        const qtdDoItem = match[2].trim();
        const precoDoItem = match[3].trim();

        result.push({ codigoDoItem, qtdDoItem, precoDoItem });
    }

    return result;
}

export function criaItensSC(str: string): { codigoDoItem: string, qtdDoItem: string }[] {
    const regex = /codigoDoItem:\s*([^,]+),\s*qtdDoItem:\s*([^,]+)\}/g;
    const result: { codigoDoItem: string, qtdDoItem: string }[] = [];

    let match;
    while ((match = regex.exec(str)) !== null) {
        const codigoDoItem = match[1].trim();
        const qtdDoItem = match[2].trim();

        result.push({ codigoDoItem, qtdDoItem });
    }

    return result;
}


export function criaFornecedores(str: string): { codigoDoFornecedor: string }[] {
    const regex = /codigoDoFornecedor:\s*([^,]+)\}/g;
    const result: { codigoDoFornecedor: string}[] = [];

    let match;
    while ((match = regex.exec(str)) !== null) {
        const codigoDoFornecedor = match[1].trim();
        result.push({codigoDoFornecedor});
    }

    return result;
}

export function montaTag(campo: string, valor: any): string {
    if ((valor != null) && (valor != "")) {
        return "<" + campo + ">" + valor + "</" + campo + "> ";
    } else
        return "";
}

export async function buscaResultado(xmlString: string): Promise<any> {
    const parser = new xml2js.Parser();
    
    try {
        const json = await parser.parseStringPromise(xmlString.trim());
        return json['s:Envelope']['s:Body'][0]['SaveRecordResponse'][0]['SaveRecordResult'][0];
    } catch (error) {
        console.error("Erro ao converter XML para JSON:", error);
        throw error;
    }
}

export async function buscaResultadoCotacao(xmlString: string): Promise<any> {
    const parser = new xml2js.Parser();
    
    try {
        const json = await parser.parseStringPromise(xmlString.trim());
        return json['s:Envelope']['s:Body'][0]['ExecuteWithXmlParamsResponse'][0]['ExecuteWithXmlParamsResult'][0];
    } catch (error) {
        console.error("Erro ao converter XML para JSON:", error);
        throw error;
    }
}

export async function buscaUID(xmlString: string): Promise<any> {
    const parser = new xml2js.Parser();
    
    try {
        const json = await parser.parseStringPromise(xmlString.trim());
        return json["s:Envelope"]["s:Body"][0].GenerateReportResponse[0].GenerateReportResult[0];;
    } catch (error) {
        console.error("Erro ao converter XML para JSON:", error);
        throw error;
    }
}

export async function buscaSIZE(xmlString: string): Promise<any> {
    const parser = new xml2js.Parser();
    
    try {
        const json = await parser.parseStringPromise(xmlString.trim());
        return json['s:Envelope']['s:Body'][0].GetGeneratedReportSizeResponse[0].GetGeneratedReportSizeResult[0];
    } catch (error) {
        console.error("Erro ao converter XML para JSON:", error);
        throw error;
    }
}

export async function buscaFILE(xmlString: string): Promise<any> {
    const parser = new xml2js.Parser();
    
    try {
        const json = await parser.parseStringPromise(xmlString.trim());
        return json['s:Envelope']['s:Body'][0].GetFileChunkResponse[0].GetFileChunkResult[0];
    } catch (error) {
        console.error("Erro ao converter XML para JSON:", error);
        throw error;
    }
}

export function getCurrentDateISO(): string {
    const date = new Date();
    
    const timezoneOffset = -date.getTimezoneOffset();
    const offsetHours = String(Math.floor(Math.abs(timezoneOffset) / 60)).padStart(2, '0');
    const offsetMinutes = String(Math.abs(timezoneOffset) % 60).padStart(2, '0');
    const offsetSign = timezoneOffset >= 0 ? '+' : '-';
  
    const isoString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}${offsetSign}${offsetHours}:${offsetMinutes}`;
    
    return isoString;
}

export function getDateTime(): string {
    const now = new Date(); // Obtém a data e hora atual

    const year = now.getFullYear(); // Ano com 4 dígitos
    const month = String(now.getMonth() + 1).padStart(2, '0'); // Mês (de 0 a 11) ajustado e formatado com dois dígitos
    const day = String(now.getDate()).padStart(2, '0'); // Dia formatado com dois dígitos

    const hours = String(now.getHours()).padStart(2, '0'); // Horas formatadas com dois dígitos
    const minutes = String(now.getMinutes()).padStart(2, '0'); // Minutos formatados com dois dígitos
    const seconds = String(now.getSeconds()).padStart(2, '0'); // Segundos formatados com dois dígitos

    // Concatena no formato ISO 8601
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

export function convertToISOFormat(dateStr: string): string {
    const [day, month, year] = dateStr.split('/').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    
    if (isNaN(date.getTime())) {
        throw new Error("Invalid date format");
    }

    const timezoneOffset = -date.getTimezoneOffset();
    const offsetHours = String(Math.floor(Math.abs(timezoneOffset) / 60)).padStart(2, '0');
    const offsetMinutes = String(Math.abs(timezoneOffset) % 60).padStart(2, '0');
    const offsetSign = timezoneOffset >= 0 ? '+' : '-';

    const isoString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}${offsetSign}${offsetHours}:${offsetMinutes}`;
    
    return isoString; // Exemplo de saída: 2024-09-26T00:00:00-03:00
}
  