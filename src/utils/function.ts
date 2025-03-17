export function valorNaoDefinido(valor: any) {
    if (valor == '' || valor == null || valor == undefined) {
        return 'AINDA NÃO DEFINIDO'
    } else {
        return valor
    }
}

  