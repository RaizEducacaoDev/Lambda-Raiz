/**
 * Função que verifica se um valor está definido
 * @param valor - Qualquer tipo de valor a ser verificado
 * @returns Retorna 'AINDA NÃO DEFINIDO' se o valor estiver vazio, nulo ou indefinido,
 *          caso contrário retorna o próprio valor
 */
export function valorNaoDefinido(valor: any) {
    // Verifica se o valor está vazio, é nulo ou indefinido
    if (valor == '' || valor == null || valor == undefined) {
        return 'AINDA NÃO DEFINIDO'
    } else {
        // Retorna o valor original caso esteja definido
        return valor
    }
}
