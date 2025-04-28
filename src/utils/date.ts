/**
 * Função auxiliar que adiciona zero à esquerda para números menores que 10
 * @param num Número a ser formatado
 * @returns String formatada com zero à esquerda se necessário
 */
function padNumber(num: number): string {
    return String(num).padStart(2, '0');
}

/**
 * Formata o offset do fuso horário no formato +/-HH:mm
 * @param date Data para extrair o offset do fuso horário
 * @returns String formatada com o offset do fuso horário
 */
function formatTimezoneOffset(date: Date) {
    const offset = -date.getTimezoneOffset();
    const sinal = offset >= 0 ? '+' : '-';
    return `${sinal}${padNumber(Math.abs(offset)/60)}:${padNumber(Math.abs(offset)%60)}`;
}

/**
 * Formata os componentes da data no padrão ISO
 * @param date Data a ser formatada
 * @returns String formatada com a data no padrão YYYY-MM-DDTHH:mm:ss
 */
function formatDateComponents(date: Date) {
    return `${date.getFullYear()}-${padNumber(date.getMonth()+1)}-${padNumber(date.getDate())}` +
        `T${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`;
}

/**
 * Obtém a data atual no formato ISO completo com timezone
 * @returns String com a data atual no formato ISO completo com timezone (ex: YYYY-MM-DDTHH:mm:ss±HH:mm)
 */
export function getCurrentDateISO(): string {
    const dataAtual = new Date();
    return `${formatDateComponents(dataAtual)}${formatTimezoneOffset(dataAtual)}`;
}

/**
 * Obtém a data e hora atual sem timezone
 * @returns String com a data e hora local no formato ISO sem offset (ex: YYYY-MM-DDTHH:mm:ss)
 */
export function getDateTime(): string {
    const agora = new Date();
    return `${agora.getFullYear()}-${padNumber(agora.getMonth()+1)}-${padNumber(agora.getDate()-1)}` +
        `T00:00:00`;
}

/**
 * Converte uma string de data no formato DD/MM/YYYY para formato ISO
 * @param dateStr String de data no formato DD/MM/YYYY
 * @returns String com a data convertida para formato ISO completo com timezone (ex: YYYY-MM-DDTHH:mm:ss±HH:mm)
 * @throws Error se o formato da data for inválido
 */
export function convertToISOFormat(dateStr: string): string {
    const [dia, mes, ano] = dateStr.split('/').map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    
    if (isNaN(data.getTime())) {
        throw new Error("Invalid date format");
    }

    return `${formatDateComponents(data)}${formatTimezoneOffset(data)}`;
}