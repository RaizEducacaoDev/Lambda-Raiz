import { createHash } from 'node:crypto';

// This is an observed native snapshot, not an invented SQL audit or evidence
// that no RM writer ever changed and restored a value between two reads.
export type BaselineParcela = { nativeHash: string; targetHash: string };
export type ContinuacaoPagamento = {
  version: 1;
  receipt: { owner: string; digest: string; pg: string; xmlSha256: string };
  baseline?: { movementHash: string; parcels: Record<string, BaselineParcela> };
  progress?: Record<string, 'PREPARED' | 'UPDATING' | 'COMPLETE'>;
};

const canonical = (v: unknown): string => {
  if (v === null || typeof v === 'string' || typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v))) return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}';
  }
  throw new Error('Snapshot nativo inválido');
};
export const hashSnapshot = (v: unknown): string => createHash('sha256').update(canonical(v)).digest('hex');
export const serializarContinuacao = (v: ContinuacaoPagamento): string => { validarContinuacao(v); return canonical(v); };
export const lerContinuacao = (v: string): ContinuacaoPagamento => {
  if (typeof v !== 'string') throw new Error('Controle de continuação inválido');
  const parsed = JSON.parse(v) as ContinuacaoPagamento; validarContinuacao(parsed); return parsed;
};
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v));
const keys = (v: object, expected: string[]) => Object.keys(v).sort().join(',') === expected.slice().sort().join(',');

export function validarContinuacao(v: ContinuacaoPagamento): void {
  if (!v || v.version !== 1 || !keys(v, v.baseline ? ['version', 'receipt', 'baseline', 'progress'] : ['version', 'receipt']) ||
    !v.receipt || !keys(v.receipt, ['owner', 'digest', 'pg', 'xmlSha256']) ||
    !/^[A-Za-z0-9._-]{1,100}$/.test(v.receipt.owner) || !hex(v.receipt.digest) || !id(v.receipt.pg) || !hex(v.receipt.xmlSha256)) {
    throw new Error('Recibo próprio inválido');
  }
  if (!v.baseline) return;
  const b = v.baseline, p = v.progress;
  if (!keys(b, ['movementHash', 'parcels']) || !hex(b.movementHash) || !b.parcels || !p ||
    !Object.keys(b.parcels).length || Object.keys(b.parcels).length > 1000 ||
    Object.keys(b.parcels).sort().join(',') !== Object.keys(p).sort().join(',')) throw new Error('Baseline incompleto');
  for (const [lan, entry] of Object.entries(b.parcels)) {
    if (!id(lan) || !entry || !keys(entry, ['nativeHash', 'targetHash']) ||
      !Object.values(entry).every(hex) || !['PREPARED', 'UPDATING', 'COMPLETE'].includes(p[lan])) throw new Error('Parcela do baseline inválida');
  }
  // A bounded complete root is required; never truncate a parcel manifest.
  if (Buffer.byteLength(canonical(v)) > 300000) throw new Error('Baseline excede o tamanho seguro');
}

export function baselineParcela(lan: Record<string, string>, target: Array<[string, string]>): BaselineParcela {
  return { nativeHash: hashSnapshot(lan), targetHash: hashSnapshot(target) };
}
