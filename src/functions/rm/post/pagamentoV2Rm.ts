import axios from 'axios';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { wsDataserver } from '../../../utils/wsDataserver';
import type { ChaveContextoFiscal } from './pagamentoFiscal';
import { tiposDocumentoPagamento, type ChaveDocumento } from './pagamentoDocumento';
import { parsearReconciliacaoPagamento } from './pagamentoReconciliacao';
import { parsearCensoRetomada, type CensoRetomada } from './pagamentoRetomada';
import { ErroNativoRm, erroHttpRm, extrairTextoErroRm } from './pagamentoErroNativo';

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true });
type Registro = Record<string, string>;

export class FalhaContratoRm extends Error {
  readonly reason = 'RESPOSTA_RM_INVALIDA';
}
export class PrazoPagamentoInsuficiente extends Error {
  readonly reason = 'PRAZO_INSUFICIENTE';
  constructor(readonly necessarioMs: number, readonly disponivelMs: number, mensagem = 'Tempo insuficiente; operação mantida pendente') {
    super(mensagem);
  }
}

const analisar = (xml: string): Record<string, unknown> => {
  if (typeof xml !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    if (typeof xml === 'string' && extrairTextoErroRm(xml)) throw new ErroNativoRm(xml, 'RESPOSTA_TOTVS_INVALIDA');
    throw new FalhaContratoRm('XML RM inválido');
  }
  const documento = parser.parse(xml) as Record<string, unknown>;
  for (const chave of ['Fault', 'Error', 'error', 'Erro', 'erro']) {
    if (documento[chave] && extrairTextoErroRm(documento[chave])) throw new ErroNativoRm(documento[chave], 'RESPOSTA_TOTVS_INVALIDA');
  }
  return documento;
};

export const lerResultadoSoap = (xml: string, operacao: 'ReadRecord' | 'SaveRecord'): string => {
  const envelope = analisar(xml).Envelope as Record<string, unknown> | undefined;
  const body = envelope?.Body as Record<string, unknown> | undefined;
  if (body?.Fault) throw new ErroNativoRm(body.Fault, 'RM_SOAP_FAULT');
  if (!body) throw new FalhaContratoRm('SOAP RM inválido ou Fault');
  const resposta = body[`${operacao}Response`] as Record<string, unknown> | undefined;
  const resultado = resposta?.[`${operacao}Result`];
  if (typeof resultado !== 'string' || !resultado.trim()) {
    const texto = extrairTextoErroRm(resposta) || extrairTextoErroRm(body);
    if (texto) throw new ErroNativoRm(texto, 'RESPOSTA_TOTVS_INVALIDA');
    throw new FalhaContratoRm('Resultado SOAP RM ausente ou ambíguo');
  }
  return resultado.trim();
};

// Exige um único dataset e registros diretos. Nunca mistura campos de registros distintos.
export const registrosRm = (xml: string, nome: string): Registro[] => {
  const documento = analisar(xml);
  const raizes = Object.keys(documento).filter(k => !k.startsWith('?'));
  if (raizes.length !== 1) throw new FalhaContratoRm('Dataset RM ambíguo');
  const raiz = documento[raizes[0]] as Record<string, unknown>;
  if (!raiz || typeof raiz !== 'object' || Array.isArray(raiz)) throw new FalhaContratoRm('Dataset RM inválido');
  const registros = raiz[nome];
  if (registros === undefined) return [];
  return (Array.isArray(registros) ? registros : [registros]).map(registro => {
    if (!registro || typeof registro !== 'object' || Object.values(registro).some(v => typeof v !== 'string')) {
      throw new FalhaContratoRm(`Registro ${nome} ambíguo ou com campo duplicado`);
    }
    return registro as Registro;
  });
};
export const registroUnico = (xml: string, nome: string): Registro => {
  const registros = registrosRm(xml, nome);
  if (registros.length !== 1) throw new FalhaContratoRm(`Esperado exatamente um ${nome}`);
  return registros[0];
};

export interface TransporteRm {
  readReacord(chave: string, servidor: string, contexto: string): Promise<string>;
  saveRecord(xml: string, servidor: string, contexto: string): Promise<string>;
  buscarMovimentosPorTicket(coligada: string, ticket: string, codTmv: string): Promise<string[]>;
  buscarEstoque(coligada: string, filial: string): Promise<string>;
  consultarContextoFiscal(chave: ChaveContextoFiscal): Promise<unknown>;
  consultarDocumento(chave: ChaveDocumento): Promise<unknown>;
  consultarRetomada(coligada: string, ticket: string): Promise<CensoRetomada>;
}

export class PrazoPagamento {
  private readonly fim: number;
  constructor(private readonly restante: () => number) {
    const ms = restante();
    if (!Number.isFinite(ms) || ms <= 0) throw new Error('Prazo da Lambda indisponível');
    this.fim = Date.now() + ms;
  }
  disponivel(): number { return Math.min(this.restante(), this.fim - Date.now()); }
  exigir(ms: number): void {
    const disponivel = this.disponivel();
    if (disponivel < ms) throw new PrazoPagamentoInsuficiente(ms, disponivel);
  }
  timeout(): number { this.exigir(4000); return Math.min(8000, this.disponivel() - 3000); }
  timeoutCriacao(margemCheckpoint = 0): number {
    // Preserve time to checkpoint IDMOV, associate the bank data and reread RM.
    // The extra pre-checkpoint margin covers the bounded DynamoDB request.
    const timeout = Math.min(15000, this.disponivel() - 12000 - margemCheckpoint);
    if (timeout < 9000) throw new PrazoPagamentoInsuficiente(21000 + margemCheckpoint, this.disponivel(),
      'Tempo insuficiente antes de enviar a criação ao RM; manter pendente sem criar');
    return timeout;
  }
}

// Transporte exclusivo V2: o cliente SOAP e o comportamento legado não são alterados.
export class TransportePagamentoV2 implements TransporteRm {
  private readonly config = new wsDataserver();
  constructor(private readonly prazo: PrazoPagamento) {}
  private async receber<T>(enviar: () => Promise<T>): Promise<T> {
    try { return await enviar(); } catch (erro) { throw erroHttpRm(erro) || erro; }
  }
  private async executar(operacao: 'ReadRecord' | 'SaveRecord', valor: string, servidor: string, contexto: string): Promise<string> {
    const timeout = operacao === 'SaveRecord' && servidor === 'MovMovimentoTBCData'
      ? this.prazo.timeoutCriacao() : this.prazo.timeout();
    const campo = operacao === 'ReadRecord' ? 'PrimaryKey' : 'XML';
    const xml = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${operacao} xmlns="http://www.totvs.com/"><DataServerName>${servidor}</DataServerName><${campo}>${valor}</${campo}><Contexto>${contexto}</Contexto></${operacao}></s:Body></s:Envelope>`;
    const resposta = await this.receber(() => axios.post(`${this.config.getUrl()}:8051/wsDataServer/IwsDataServer`, xml, {
      timeout, signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Basic ${this.config.getCredentials()}`, 'Content-Type': 'text/xml;charset=UTF-8', SOAPAction: `http://www.totvs.com/IwsDataServer/${operacao}` },
    }));
    return lerResultadoSoap(resposta.data, operacao);
  }
  readReacord(chave: string, servidor: string, contexto: string) { return this.executar('ReadRecord', chave, servidor, contexto); }
  saveRecord(xml: string, servidor: string, contexto: string) { return this.executar('SaveRecord', xml, servidor, contexto); }
  async buscarMovimentosPorTicket(coligada: string, ticket: string, codTmv: string): Promise<string[]> {
    if (![coligada, ticket].every(valor => /^\d+$/.test(valor) && Number.isSafeInteger(Number(valor)) && Number(valor) > 0)) {
      throw new Error('Identificadores inválidos para consulta de reconciliação');
    }
    const timeout = this.prazo.timeout();
    const parametros = new URLSearchParams({ parameters: `CODCOLIGADA=${coligada};TICKET=${ticket}` });
    const resposta = await this.receber(() => axios.get(`${this.config.getUrl()}:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/RAIZ.PG.RECON/0/T?${parametros}`, {
      timeout, signal: AbortSignal.timeout(timeout), headers: { Authorization: `Basic ${this.config.getCredentials()}`, Accept: 'application/json' },
    }));
    return parsearReconciliacaoPagamento(resposta.data, coligada, ticket, codTmv).filter(m => m.CODTMV === codTmv).map(m => m.IDMOV);
  }
  async buscarEstoque(coligada: string, filial: string): Promise<string> {
    const timeout = this.prazo.timeout();
    const parametros = `CODCOLIGADA=${encodeURIComponent(coligada)};CODFILIAL=${encodeURIComponent(filial)}`;
    const resposta = await this.receber(() => axios.get(`${this.config.getUrl()}:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/TICKET.RAIZ.0041/0/T?parameters=${parametros}`, {
      timeout, signal: AbortSignal.timeout(timeout), headers: { Authorization: `Basic ${this.config.getCredentials()}`, Accept: 'application/json' },
    }));
    if (!Array.isArray(resposta.data) || resposta.data.length !== 1 || !resposta.data[0]?.CODLOC) {
      throw new Error('Consulta de estoque inválida ou ambígua');
    }
    return String(resposta.data[0].CODLOC);
  }
  async consultarRetomada(coligada: string, ticket: string): Promise<CensoRetomada> {
    if (![coligada, ticket].every(v => /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v)))) {
      throw new Error('Identificadores inválidos para conferir a retomada');
    }
    const timeout = this.prazo.timeout();
    const parametros = new URLSearchParams({ parameters: `CODCOLIGADA=${coligada};TICKET=${ticket}` });
    const resposta = await this.receber(() => axios.get(`${this.config.getUrl()}:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/RAIZ.PG.RETRY/0/T?${parametros}`, {
      timeout, signal: AbortSignal.timeout(timeout), headers: { Authorization: `Basic ${this.config.getCredentials()}`, Accept: 'application/json' },
    }));
    return parsearCensoRetomada(resposta.data, coligada, ticket);
  }
  async consultarContextoFiscal(chave: ChaveContextoFiscal): Promise<unknown> {
    if (![chave.codColigada, chave.codFilial, chave.idNat].every(valor => /^\d+$/.test(valor) && Number.isSafeInteger(Number(valor)) && Number(valor) > 0) ||
      !/^\d+$/.test(chave.codColCfo) || !Number.isSafeInteger(Number(chave.codColCfo)) ||
      !/^[A-Za-z0-9._-]+$/.test(chave.codCfo)) throw new Error('Chave de consulta fiscal inválida');
    const timeout = this.prazo.timeout();
    const parametros = new URLSearchParams({ parameters: [
      ['CODCOLIGADA', chave.codColigada], ['CODFILIAL', chave.codFilial], ['CODCOLCFO', chave.codColCfo],
      ['CODCFO', chave.codCfo], ['IDNAT', chave.idNat],
    ].map(([nome, valor]) => `${nome}=${valor}`).join(';') });
    const resposta = await this.receber(() => axios.get(`${this.config.getUrl()}:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/RAIZ.PG.FISC/0/T?${parametros}`, {
      timeout, signal: AbortSignal.timeout(timeout), headers: { Authorization: `Basic ${this.config.getCredentials()}`, Accept: 'application/json' },
    }));
    return resposta.data;
  }
  async consultarDocumento(chave: ChaveDocumento): Promise<unknown> {
    if (![chave.codColigada, chave.codFilial].every(v => /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v))) ||
      !/^\d+$/.test(chave.codColCfo) || !Number.isSafeInteger(Number(chave.codColCfo)) ||
      !/^[A-Za-z0-9._-]{1,30}$/.test(chave.codCfo) || !tiposDocumentoPagamento.has(chave.codTmv) ||
      !/^\d{1,9}$/.test(chave.numero) || !/^[A-Za-z0-9._-]{0,5}$/.test(chave.serie)) {
      throw new Error('Chave de consulta do documento inválida');
    }
    const timeout = this.prazo.timeout();
    const parametros = new URLSearchParams({ parameters: [
      ['CODCOLIGADA', chave.codColigada], ['CODFILIAL', chave.codFilial], ['CODCOLCFO', chave.codColCfo],
      ['CODCFO', chave.codCfo], ['CODTMV', chave.codTmv], ['NUMERO', chave.numero], ['SERIE', chave.serie || '~'],
    ].map(([nome, valor]) => `${nome}=${valor}`).join(';') });
    const resposta = await this.receber(() => axios.get(`${this.config.getUrl()}:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/RAIZ.PG.DOC2/0/T?${parametros}`, {
      timeout, signal: AbortSignal.timeout(timeout), headers: { Authorization: `Basic ${this.config.getCredentials()}`, Accept: 'application/json' },
    }));
    return resposta.data;
  }
}
