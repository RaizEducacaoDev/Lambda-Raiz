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