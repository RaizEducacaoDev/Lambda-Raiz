export function extrairDadosGenerico<T>(str: string, regexStr: string, grupos: string[]): T[] {
    const regex = new RegExp(regexStr, 'g');
    const result: T[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(str)) !== null) {
        const obj = grupos.reduce((acc, grupo, index) => {
            (acc as Record<string, string>)[grupo] = match?.[index + 1]?.trim() ?? '';
            return acc;
        }, {} as T);
        result.push(obj);
    }

    return result;
}

export const transformToObjectChapas = (str: string) =>
    extrairDadosGenerico<{ chapa: string, cargo: string }>(str, 'chapa:\\s*([^,]+),\\s*cargo:\\s*([^}]+)\\}', ['chapa', 'cargo']);

export const criaItensOC = (str: string) =>
    extrairDadosGenerico<{ codigoDoItem: string, qtdDoItem: string, precoDoItem: string }>(str, 'codigoDoItem:\\s*([^,]+),\\s*qtdDoItem:\\s*([^,]+),\\s*precoDoItem:\\s*([^}]+)\\}', ['codigoDoItem', 'qtdDoItem', 'precoDoItem']);

export const criaItensSC = (str: string) =>
    extrairDadosGenerico<{ codigoDoItem: string, qtdDoItem: string }>(str, 'codigoDoItem:\\s*([^,]+),\\s*qtdDoItem:\\s*([^,]+)\\}', ['codigoDoItem', 'qtdDoItem']);

export const criaFornecedores = (str: string) =>
    extrairDadosGenerico<{ codigoDoFornecedor: string }>(str, 'codigoDoFornecedor:\\s*([^,]+)\\}', ['codigoDoFornecedor']);