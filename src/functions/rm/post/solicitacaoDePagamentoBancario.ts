export type ChaveDadoPagamento = {
  codColPgto: string; codColCfo: string; codCfo: string; idPgto: number;
};
export type DadosBoleto = { codigoBarras: string; ipte: string };
export const texto = (valor: unknown): string => valor == null ? '' : String(valor).trim();
const normalizar = (v: unknown) => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toUpperCase();
export const ehContaDeConsumo = (v: unknown): boolean => ['CC', 'CONTA DE CONSUMO', 'CONTAS DE CONSUMO'].includes(normalizar(v));
export const deveExecutarV2 = (campos: Record<string, unknown> | null): boolean => Boolean(campos &&
  texto(campos.tipoDaSolicitacao) === 'PG' && texto(campos.atividadeAtual) === 'TS03' &&
  ehContaDeConsumo(campos.tipoDoPagamento) && normalizar(campos.integracaoBancariaV2) === 'S');

export const idPositivo = (v: unknown): boolean => /^\d+$/.test(texto(v)) && Number.isSafeInteger(Number(v)) && Number(v) > 0;
export const parsearChaveDadoPagamento = (v: unknown): ChaveDadoPagamento | undefined => {
  const partes = texto(v).split('$_$').map(texto);
  if (partes.length !== 4) return undefined;
  const [codColPgto, codColCfo, codCfo, idPgto] = partes;
  if (!idPositivo(codColPgto) || !/^\d+$/.test(codColCfo) || !Number.isSafeInteger(Number(codColCfo)) ||
      !/^[A-Za-z0-9._-]+$/.test(codCfo) || !idPositivo(idPgto)) return undefined;
  return { codColPgto: String(Number(codColPgto)), codColCfo: String(Number(codColCfo)), codCfo, idPgto: Number(idPgto) };
};

export const resolverChaveDadoPagamento = (campos: Record<string, unknown>): ChaveDadoPagamento => {
  const candidatos = [campos.idPagamento, campos.idpagamento, campos.idpgto, campos.idPgto].map(texto).filter(Boolean);
  const compostas = candidatos.filter(v => v.includes('$_$')).map(parsearChaveDadoPagamento);
  let chave = compostas[0];
  // A integração 1633 pode devolver apenas o ID. Nesse contrato os demais
  // componentes devem vir explicitamente; não inferir titularidade nem forma.
  if (!compostas.length && candidatos.length && candidatos.every(idPositivo)) {
    chave = parsearChaveDadoPagamento([texto(campos.CODCOLPGTO), texto(campos.CODCOLCFO),
      texto(campos.codigoDoFornecedor), candidatos[0]].join('$_$'));
  }
  if (!chave || compostas.some(c => !c || JSON.stringify(c) !== JSON.stringify(chave))) {
    throw new Error('Chave bancária composta obrigatória, válida e sem divergências');
  }
  for (const v of candidatos.filter(v => !v.includes('$_$'))) {
    if (!idPositivo(v) || Number(v) !== chave.idPgto) throw new Error('IDPGTO diverge da chave bancária');
  }
  if (!texto(campos.codigoDoFornecedor) || chave.codCfo !== texto(campos.codigoDoFornecedor)) {
    throw new Error('Dado bancário pertence a outro fornecedor ou fornecedor ausente');
  }
  return chave;
};

// FEBRABAN arrecadação: referência 6/7 usa módulo 10; 8/9 usa módulo 11.
export const digitoArrecadacao = (valor: string, modulo: 10 | 11): number => {
  let soma = 0, peso = 2;
  for (const n of [...valor].reverse()) {
    const produto = Number(n) * peso;
    soma += modulo === 10 ? Math.floor(produto / 10) + produto % 10 : produto;
    peso = modulo === 10 ? (peso === 2 ? 1 : 2) : (peso === 9 ? 2 : peso + 1);
  }
  const resto = soma % modulo;
  return modulo === 10 ? (10 - resto) % 10 : resto <= 1 ? 0 : 11 - resto;
};

export const obterDadosBoleto = (v: unknown): DadosBoleto => {
  const valor = texto(v);
  if (!/^[\d\s.-]+$/.test(valor)) throw new Error('Linha digitável contém caracteres inválidos');
  const ipte = valor.replace(/[\s.-]/g, '');
  if (!/^8[1-79][6-9]\d{45}$/.test(ipte)) throw new Error('Conta de consumo exige linha digitável de arrecadação com 48 dígitos');
  const modulo = ['6', '7'].includes(ipte[2]) ? 10 : 11;
  let codigoBarras = '';
  for (let inicio = 0; inicio < 48; inicio += 12) {
    const bloco = ipte.slice(inicio, inicio + 11);
    if (digitoArrecadacao(bloco, modulo) !== Number(ipte[inicio + 11])) throw new Error('Dígito verificador de bloco inválido');
    codigoBarras += bloco;
  }
  if (digitoArrecadacao(codigoBarras.slice(0, 3) + codigoBarras.slice(4), modulo) !== Number(codigoBarras[3])) {
    throw new Error('Dígito verificador geral inválido');
  }
  return { codigoBarras, ipte };
};

export const montarCamposDadoPagamento = (c: ChaveDadoPagamento): Array<[string, string]> => [
  ['CODCOLPGTO', c.codColPgto], ['CODCOLCFO', c.codColCfo], ['CODCFO', c.codCfo], ['IDPGTO', String(c.idPgto)],
];

export const validarAliasesBancarios = (campos: Record<string, unknown>, chave: ChaveDadoPagamento, boleto: DadosBoleto): void => {
  for (const nome of ['codigoDeBarrasBoleto', 'codigoDeBarras', 'linhaDigitavelBoleto', 'linhaDigitavel']) {
    const valor = texto(campos[nome]);
    if (!valor) continue;
    if (!/^[\d\s.-]+$/.test(valor)) throw new Error(`Alias bancário inválido: ${nome}`);
    const digitos = valor.replace(/[\s.-]/g, '');
    if (digitos !== boleto.codigoBarras && digitos !== boleto.ipte) throw new Error(`Alias bancário divergente: ${nome}`);
  }
  for (const nome of ['idpgto', 'idPgto', 'IDPGTO', 'idPagamento', 'idpagamento']) {
    const valor = texto(campos[nome]);
    if (!valor) continue;
    const composta = parsearChaveDadoPagamento(valor);
    if (composta ? JSON.stringify(composta) !== JSON.stringify(chave) : !idPositivo(valor) || Number(valor) !== chave.idPgto) {
      throw new Error(`Alias bancário divergente: ${nome}`);
    }
  }
  for (const nome of ['CODCOLPGTO', 'codcolpgto', 'codColPgto']) {
    if (texto(campos[nome]) && (!idPositivo(campos[nome]) || String(Number(campos[nome])) !== chave.codColPgto)) {
      throw new Error(`Alias bancário divergente: ${nome}`);
    }
  }
};
