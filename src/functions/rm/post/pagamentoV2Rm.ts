import axios from 'axios';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { wsDataserver } from '../../../utils/wsDataserver';

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, trimValues: true });
type Registro = Record<string, string>;

const analisar = (xml: string): Record<string, unknown> => {
  if (typeof xml !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new Error('XML RM inválido');
  }
  return parser.parse(xml);
};

export const lerResultadoSoap = (xml: string, operacao: 'ReadRecord' | 'SaveRecord'): string => {
  const envelope = analisar(xml).Envelope as Record<string, unknown> | undefined;
  const body = envelope?.Body as Record<string, unknown> | undefined;
  if (!body || body.Fault) throw new Error('SOAP RM inválido ou Fault');
  const resposta = body[`${operacao}Response`] as Record<string, unknown> | undefined;
  const resultado = resposta?.[`${operacao}Result`];
  if (typeof resultado !== 'string' || !resultado.trim()) throw new Error('Resultado SOAP RM ausente ou ambíguo');
  return resultado.trim();
};

// Exige um único dataset e registros diretos. Nunca mistura campos de registros distintos.
export const registrosRm = (xml: string, nome: string): Registro[] => {
  const documento = analisar(xml);
  const raizes = Object.keys(documento).filter(k => !k.startsWith('?'));
  if (raizes.length !== 1) throw new Error('Dataset RM ambíguo');
  const raiz = documento[raizes[0]] as Record<string, unknown>;
  if (!raiz || typeof raiz !== 'object' || Array.isArray(raiz)) throw new Error('Dataset RM inválido');
  const registros = raiz[nome];
  if (registros === undefined) return [];
  return (Array.isArray(registros) ? registros : [registros]).map(registro => {
    if (!registro || typeof registro !== 'object' || Object.values(registro).some(v => typeof v !== 'string')) {
      throw new Error(`Registro ${nome} ambíguo ou com campo duplicado`);
    }
    return registro as Registro;
  });
};
export const registroUnico = (xml: string, nome: string): Registro => {
  const registros = registrosRm(xml, nome);
  if (registros.length !== 1) throw new Error(`Esperado exatamente um ${nome}`);
  return registros[0];
};

export interface TransporteRm {
  readReacord(chave: string, servidor: string, contexto: string): Promise<string>;
  saveRecord(xml: string, servidor: string, contexto: string): Promise<string>;
  buscarMovimentosPorTicket(coligada: string, ticket: string, codTmv: string): Promise<string[]>;
  buscarEstoque(coligada: string, filial: string): Promise<string>;
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
    if (this.disponivel() < ms) throw new Error('Tempo insuficiente; operação mantida pendente');
  }
  timeout(): number { this.exigir(4000); return Math.min(8000, this.disponivel() - 3000); }
}

// Transporte exclusivo V2: o cliente SOAP e o comportamento legado não são alterados.
export class TransportePagamentoV2 implements TransporteRm {
  private readonly config = new wsDataserver();
  constructor(private readonly prazo: PrazoPagamento) {}
  private async executar(operacao: 'ReadRecord' | 'SaveRecord', valor: string, servidor: string, contexto: string): Promise<string> {
    const timeout = this.prazo.timeout();
    const campo = operacao === 'ReadRecord' ? 'PrimaryKey' : 'XML';
    const xml = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><${operacao} xmlns="http://www.totvs.com/"><DataServerName>${servidor}</DataServerName><${campo}>${valor}</${campo}><Contexto>${contexto}</Contexto></${operacao}></s:Body></s:Envelope>`;
    const resposta = await axios.post(`${this.config.getUrl()}:8051/wsDataServer/IwsDataServer`, xml, {
      timeout, signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Basic ${this.config.getCredentials()}`, 'Content-Type': 'text/xml;charset=UTF-8', SOAPAction: `http://www.totvs.com/IwsDataServer/${operacao}` },
    });
    return lerResultadoSoap(resposta.data, operacao);
  }
  readReacord(chave: string, servidor: string, contexto: string) { return this.executar('ReadRecord', chave, servidor, contexto); }
  saveRecord(xml: string, servidor: string, contexto: string) { return this.executar('SaveRecord', xml, servidor, contexto); }
  async buscarMovimentosPorTicket(coligada: string, ticket: string, codTmv: string): Promise<string[]> {
    const timeout = this.prazo.timeout();
    const parametros = `CODCOLIGADA=${encodeURIComponent(coligada)};TICKET=${encodeURIComponent(ticket)};CODTMV=${encodeURIComponent(codTmv)}`;
    const resposta = await axios.get(`${this.config.getUrl()}:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/TICKET.RAIZ.0059/0/T?parameters=${parametros}`, {
      timeout, signal: AbortSignal.timeout(timeout), headers: { Authorization: `Basic ${this.config.getCredentials()}`, Accept: 'application/json' },
    });
    if (!Array.isArray(resposta.data) || resposta.data.some((r: Record<string, unknown>) => !r || !/^[1-9]\d*$/.test(String(r.IDMOV)) || !Number.isSafeInteger(Number(r.IDMOV)))) {
      throw new Error('Consulta de ticket retornou resposta inválida; criação bloqueada');
    }
    return resposta.data.map((r: Record<string, unknown>) => String(r.IDMOV));
  }
  async buscarEstoque(coligada: string, filial: string): Promise<string> {
    const timeout = this.prazo.timeout();
    const parametros = `CODCOLIGADA=${encodeURIComponent(coligada)};CODFILIAL=${encodeURIComponent(filial)}`;
    const resposta = await axios.get(`${this.config.getUrl()}:8051/api/framework/v1/consultaSQLServer/RealizaConsulta/TICKET.RAIZ.0041/0/T?parameters=${parametros}`, {
      timeout, signal: AbortSignal.timeout(timeout), headers: { Authorization: `Basic ${this.config.getCredentials()}`, Accept: 'application/json' },
    });
    if (!Array.isArray(resposta.data) || resposta.data.length !== 1 || !resposta.data[0]?.CODLOC) {
      throw new Error('Consulta de estoque inválida ou ambígua');
    }
    return String(resposta.data[0].CODLOC);
  }
}
