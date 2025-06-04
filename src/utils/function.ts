/**
 * Função que verifica se um valor está definido
 * @param valor - Qualquer tipo de valor a ser verificado
 * @returns Retorna 'AINDA NÃO DEFINIDO' se o valor estiver vazio, nulo ou indefinido,
 *          caso contrário retorna o próprio valor
 */
export function valorNaoDefinido(valor: any) {
    if (valor == '' || valor == null || valor == undefined) {
        return 'AINDA NÃO DEFINIDO'
    } else {
        return valor
    }
}

/**
 * Converte um valor monetário em formato brasileiro (1.000.000,00) para formato float (1000000.00)
 * @param value - Valor monetário como string no formato brasileiro
 * @returns Representação do valor em formato float como string
 */
export function moedaParaFloat(value: string): string {
    if (!value) return '0.00';
    
    const cleanValue = value
        .replace(/\./g, '')
        .replace(',', '.');
    
    const floatValue = parseFloat(cleanValue).toFixed(2);
    
    return floatValue;
}
