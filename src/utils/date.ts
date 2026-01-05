/**
 * Adiciona zero à esquerda para números menores que 10
 * @param num Número a ser formatado
 * @returns String formatada com zero à esquerda
 */
function pad(num: number): string {
    return String(num).padStart(2, '0');
}

/**
 * Formata data no padrão ISO
 * @param date Data a ser formatada
 * @param withTz Se deve incluir timezone
 * @returns String formatada no padrão ISO
 */
function formatISO(date: Date, withTz: boolean = false): string {
    const brasilDate = new Date(date.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
    
    // Garantir que usamos hífens ASCII padrão (-)
    const year = brasilDate.getFullYear();
    const month = pad(brasilDate.getMonth() + 1);
    const day = pad(brasilDate.getDate());
    
    // Sempre usar meia-noite (00:00:00)
    let result = `${year}-${month}-${day}T00:00:00`;
    
    if (withTz) {
        result += '-03:00';
    }
    
    return result;
}

/**
 * Obtém data atual no formato ISO com timezone
 * @returns Data atual no formato ISO com timezone
 */
export function getNowISO(): string {
    return formatISO(new Date(), true);
}

/**
 * Obtém data atual no formato ISO sem timezone
 * @returns Data atual no formato ISO sem timezone
 */
export function getNow(): string {
    return formatISO(new Date(), false);
}

// getToday() removido - era idêntico ao getNow()

/**
 * Converte data de DD/MM/YYYY ou DD/MM/YYYY HH:MM para formato especificado
 * @param dateStr Data no formato DD/MM/YYYY ou DD/MM/YYYY HH:MM
 * @param withTz Se deve incluir timezone
 * @returns Data convertida para o formato especificado
 * @throws Error se formato inválido
 */
function parseDate(dateStr: string, withTz: boolean = false): string {
    
    if (!dateStr) {
        return '';
    }
    
    // Divide a data e a hora, se houver
    const [datePart, timePart] = dateStr.trim().split(' ');
    const [dia, mes, ano] = datePart.split('/').map(Number);

    // Validação básica
    if (isNaN(dia) || isNaN(mes) || isNaN(ano) || 
        dia < 1 || dia > 31 || mes < 1 || mes > 12) {
        throw new Error("Data inválida");
    }

    // Hora e minuto opcionais
    let horas = 0;
    let minutos = 0;
    if (timePart) {
        const [h, m] = timePart.split(':').map(Number);
        if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
            throw new Error("Hora inválida");
        }
        horas = h;
        minutos = m;
    }

    if (withTz) {
        const data = new Date(ano, mes - 1, dia, horas, minutos);
        if (isNaN(data.getTime())) {
            throw new Error("Data inválida");
        }
        return formatISO(data, true);
    } else {
        // Garantir hífens ASCII padrão na formatação manual
        return `${ano}-${pad(mes)}-${pad(dia)}T${pad(horas)}:${pad(minutos)}:00`;
    }
}

/**
 * Converte data de DD/MM/YYYY para ISO com timezone
 * @param dateStr Data no formato DD/MM/YYYY
 * @returns Data convertida para ISO com timezone
 * @throws Error se formato inválido
 */
export function toISO(dateStr: string): string {
    return parseDate(dateStr, true);
}

/**
 * Converte data de DD/MM/YYYY para ISO sem timezone
 * @param dateStr Data no formato DD/MM/YYYY
 * @returns Data convertida para ISO sem timezone
 * @throws Error se formato inválido
 */
export function toISOSimple(dateStr: string): string {
    return parseDate(dateStr, false);
}