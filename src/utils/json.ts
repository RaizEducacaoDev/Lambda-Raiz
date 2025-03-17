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