import { createHash, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { validarEvidencia, type EvidenciaPagamento } from './pagamentoEvidencia';
import { lerContinuacao, serializarContinuacao, validarContinuacao, type ContinuacaoPagamento } from './pagamentoContinuacao';

export type EstadoPagamento = 'RESERVED' | 'CREATING' | 'CREATED' | 'UPDATING' | 'COMPLETE';
export type OperacaoPagamento = {
  pk: string; digest: string; owner: string; lockUntil: number; state: EstadoPagamento; pg?: string;
  protocolVersion?: 2;
  recuperadaCriacaoIncerta?: true;
  // A canonical scalar permits one exact Dynamo CAS over the entire manifest
  // and all parcel phases without unsupported/oversized nested conditions.
  continuation?: string;
};
export interface RepositorioPagamento {
  registrarEvidencia?(operacao: OperacaoPagamento, evidencia: EvidenciaPagamento): Promise<void>;
  consultar(pk: string): Promise<OperacaoPagamento | undefined>;
  corrigirReserva(antes: OperacaoPagamento, digestNovo: string, duracao: number): Promise<OperacaoPagamento>;
  confirmarCriacaoIncerta(antes: OperacaoPagamento, pg: string, duracao: number): Promise<OperacaoPagamento>;
  encerrarAntesDoEnvio(operacao: OperacaoPagamento): Promise<void>;
  concluida(pk: string, digest: string, pg: string | undefined): Promise<OperacaoPagamento | undefined>;
  movimentoConhecido(pk: string, digest: string, pg: string | undefined): Promise<string | undefined>;
  reservar(pk: string, digest: string, pg: string | undefined, duracao: number): Promise<OperacaoPagamento>;
  avancar(operacao: OperacaoPagamento, estado: EstadoPagamento, pg?: string): Promise<OperacaoPagamento>;
  confirmarCriacaoPropria(operacao: OperacaoPagamento, pg: string, xmlSha256: string): Promise<OperacaoPagamento>;
  selarBaseline(operacao: OperacaoPagamento, baseline: NonNullable<ContinuacaoPagamento['baseline']>): Promise<OperacaoPagamento>;
  avancarParcelaPropria(operacao: OperacaoPagamento, idLan: string, estado: 'UPDATING' | 'COMPLETE'): Promise<OperacaoPagamento>;
  conferirEnvioProprio(operacao: OperacaoPagamento, idLan: string): Promise<void>;
}
export class ConflitoPagamento extends Error {
  constructor(mensagem: string, readonly reason?: 'DADOS_SOLICITACAO_ALTERADOS' | 'MOVIMENTO_RESERVA_DIVERGENTE') {
    super(mensagem);
  }
}

function conferirIdentidadeReserva(existente: OperacaoPagamento, digest: string, pg: string | undefined): void {
  if (existente.digest !== digest) {
    throw new ConflitoPagamento('Os dados enviados pelo Zeev mudaram em relação à tentativa anterior deste ticket. Confira os dados corrigidos e a tentativa anterior antes de prosseguir.', 'DADOS_SOLICITACAO_ALTERADOS');
  }
  if (pg && pg !== existente.pg) {
    throw new ConflitoPagamento(existente.pg
      ? 'O movimento recebido do Zeev difere do movimento registrado na tentativa anterior. Confira o campo Movimento e a consulta automática do formulário.'
      : 'O Zeev enviou um movimento, mas a tentativa anterior deste ticket não confirmou nenhum movimento. Confira o campo Movimento e a consulta automática do formulário.',
    'MOVIMENTO_RESERVA_DIVERGENTE');
  }
}

const raizPagamento = (pk: unknown): pk is string => typeof pk === 'string' && /^[^#]+#PG#[1-9]\d*#[1-9]\d*$/.test(pk);
const digestValido = (digest: unknown): digest is string => typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest);
// Only JSON values can occur in this protocol. Reject unsupported snapshots,
// rather than silently dropping attributes from their immutable history.
const ordenarSnapshot = (valor: unknown): unknown => {
  if (valor === null || typeof valor === 'string' || typeof valor === 'boolean' ||
    (typeof valor === 'number' && Number.isFinite(valor))) return valor;
  if (Array.isArray(valor)) return valor.map(ordenarSnapshot);
  if (valor && typeof valor === 'object' && Object.getPrototypeOf(valor) === Object.prototype) {
    return Object.fromEntries(Object.keys(valor).sort().map(k => [k, ordenarSnapshot((valor as Record<string, unknown>)[k])]));
  }
  throw new ConflitoPagamento('Snapshot da reserva inválido; nenhuma retomada autorizada');
};
const snapshotCanonico = (valor: unknown): string => JSON.stringify(ordenarSnapshot(valor));

// Não há TTL nem delete: apagar uma reserva possibilitaria duplicação no RM.
export class DynamoPagamento implements RepositorioPagamento {
  constructor(private readonly tabela: string,
    private readonly cliente = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 1 }))) {}
  private async escreverContinuacao(op: OperacaoPagamento, next: ContinuacaoPagamento,
    creation = false): Promise<OperacaoPagamento> {
    validarContinuacao(next);
    const serialized = serializarContinuacao(next);
    if (!raizPagamento(op.pk) || !digestValido(op.digest) || next.receipt.digest !== op.digest ||
      op.state !== (creation ? 'CREATING' : 'CREATED') ||
      (creation ? Object.prototype.hasOwnProperty.call(op, 'pg') : op.pg !== next.receipt.pg) ||
      Buffer.byteLength(snapshotCanonico({ ...op, continuation: serialized })) > 350000) {
      throw new ConflitoPagamento('Raiz não admite continuação bancária própria');
    }
    const values: Record<string, unknown> = { ':owner': op.owner, ':state': op.state, ':digest': op.digest,
      ':until': op.lockUntil, ':now': Date.now(), ':next': serialized, ':pg': next.receipt.pg };
    let condition = '#owner = :owner AND #state = :state AND digest = :digest AND lockUntil = :until AND lockUntil > :now';
    if (op.continuation) {
      lerContinuacao(op.continuation); values[':old'] = op.continuation;
      condition += ' AND #continuation = :old';
    } else condition += ' AND attribute_not_exists(#continuation)';
    condition += creation ? ' AND attribute_not_exists(pg)' : ' AND pg = :pg';
    if (creation) values[':created'] = 'CREATED';
    try {
      const response = await this.cliente.send(new UpdateCommand({ TableName: this.tabela, Key: { pk: op.pk },
        UpdateExpression: 'SET #continuation = :next' + (creation ? ', #state = :created, pg = :pg' : ''),
        ConditionExpression: condition,
        ExpressionAttributeNames: { '#owner': 'owner', '#state': 'state', '#continuation': 'continuation' },
        ExpressionAttributeValues: values, ReturnValues: 'ALL_NEW' }), { abortSignal: AbortSignal.timeout(2000) });
      if (!response.Attributes) throw new Error('Continuação sem confirmação');
      return response.Attributes as OperacaoPagamento;
    } catch (error) {
      // An uncertain ACK never resends a financial write or rearms UPDATING.
      // The same immutable requested result can only be accepted by readback.
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') throw error;
      const actual = await this.consultar(op.pk);
      if (actual?.owner === op.owner && actual.lockUntil === op.lockUntil && actual.lockUntil > Date.now() &&
        actual.state === 'CREATED' && actual.pg === next.receipt.pg && actual.digest === op.digest &&
        actual.continuation === serialized) return actual;
      throw error;
    }
  }
  async confirmarCriacaoPropria(op: OperacaoPagamento, pg: string, xmlSha256: string): Promise<OperacaoPagamento> {
    if (op.continuation || op.recuperadaCriacaoIncerta) throw new ConflitoPagamento('Origem própria não pode ser reconstruída');
    return this.escreverContinuacao(op, { version: 1, receipt: { owner: op.owner, digest: op.digest, pg, xmlSha256 } }, true);
  }
  async selarBaseline(op: OperacaoPagamento, baseline: NonNullable<ContinuacaoPagamento['baseline']>): Promise<OperacaoPagamento> {
    const c = op.continuation ? lerContinuacao(op.continuation) : undefined;
    if (!c || c.baseline || c.receipt.owner !== op.owner) throw new ConflitoPagamento('Baseline exige a invocação que recebeu a chave própria');
    const progress = Object.fromEntries(Object.keys(baseline.parcels).map(id => [id, 'PREPARED' as const]));
    return this.escreverContinuacao(op, { ...c, baseline, progress });
  }
  async avancarParcelaPropria(op: OperacaoPagamento, idLan: string, state: 'UPDATING' | 'COMPLETE'): Promise<OperacaoPagamento> {
    const c = op.continuation ? lerContinuacao(op.continuation) : undefined;
    if (!c) throw new ConflitoPagamento('Parcela sem recibo próprio');
    validarContinuacao(c);
    const previous = c.progress?.[idLan];
    if (!c.baseline?.parcels[idLan] || !previous || (state === 'UPDATING' && previous !== 'PREPARED')) {
      throw new ConflitoPagamento('Parcela não admite novo envio bancário');
    }
    return this.escreverContinuacao(op, { ...c, progress: { ...c.progress!, [idLan]: state } });
  }
  async conferirEnvioProprio(op: OperacaoPagamento, idLan: string): Promise<void> {
    const c = op.continuation ? lerContinuacao(op.continuation) : undefined;
    if (!c || c.progress?.[idLan] !== 'UPDATING') throw new ConflitoPagamento('Parcela sem autorização de envio');
    const actual = await this.consultar(op.pk);
    if (!actual || actual.state !== 'CREATED' || actual.owner !== op.owner || actual.digest !== op.digest ||
      actual.pg !== op.pg || actual.lockUntil !== op.lockUntil || actual.lockUntil <= Date.now() ||
      actual.continuation !== op.continuation) throw new ConflitoPagamento('Autorização de envio perdeu a raiz/lease');
  }
  async registrarEvidencia(op: OperacaoPagamento, evidencia: EvidenciaPagamento): Promise<void> {
    validarEvidencia(evidencia);
    if (!raizPagamento(op.pk) || !digestValido(op.digest) || !/^[A-Za-z0-9._-]{1,100}$/.test(op.owner) ||
      (evidencia.phase === 'prepared' ? op.state !== 'RESERVED' : op.state !== 'CREATING')) {
      throw new Error('Estado inválido para registrar evidência da criação');
    }
    // This immutable record is evidence only: it never changes the root,
    // acquires a lease or authorizes a retry. An orphan is harmless.
    const conteudo = { version: 1, digest: op.digest, owner: op.owner, observedState: op.state, evidence: evidencia };
    const evidenceSha256 = createHash('sha256').update(snapshotCanonico(conteudo)).digest('hex');
    const registro = { pk: `${op.pk}#EVIDENCE#${op.owner}#${evidenceSha256}`, evidenceSha256, ...conteudo };
    try {
      await this.cliente.send(new PutCommand({ TableName: this.tabela, Item: registro,
        ConditionExpression: 'attribute_not_exists(pk)' }), { abortSignal: AbortSignal.timeout(2000) });
    } catch (erro) {
      if (!(erro instanceof Error) || erro.name !== 'ConditionalCheckFailedException') throw erro;
      const gravado = await this.cliente.send(new GetCommand({ TableName: this.tabela,
        Key: { pk: registro.pk }, ConsistentRead: true }), { abortSignal: AbortSignal.timeout(2000) });
      if (!gravado.Item || snapshotCanonico(gravado.Item) !== snapshotCanonico(registro)) throw new Error('Evidência imutável divergente');
    }
  }
  async consultar(pk: string): Promise<OperacaoPagamento | undefined> {
    const resposta = await this.cliente.send(new GetCommand({ TableName: this.tabela, Key: { pk }, ConsistentRead: true }),
      { abortSignal: AbortSignal.timeout(2000) });
    if (resposta.Item && resposta.Item.pk !== pk) throw new ConflitoPagamento('Leitura da reserva não corresponde à operação solicitada');
    return resposta.Item as OperacaoPagamento | undefined;
  }
  // The caller validates the corrected input; RM decides duplicate-document
  // rules. Only an expired attempt without any recorded movement may change.
  async corrigirReserva(antes: OperacaoPagamento, digestNovo: string, duracao: number): Promise<OperacaoPagamento> {
    if (!digestValido(digestNovo) || digestNovo === antes.digest ||
        !['RESERVED', 'CREATING'].includes(antes.state) ||
        (Object.prototype.hasOwnProperty.call(antes, 'protocolVersion') && antes.protocolVersion !== 2)) {
      throw new ConflitoPagamento('Reserva não admite correção automática da intenção');
    }
    return this.retomar(antes, 'RESERVED', digestNovo, undefined, duracao, antes.state as 'RESERVED' | 'CREATING');
  }
  // Requires a positive, complete RM identity/amount/date/installment proof for
  // this same digest, validated by the service. Zero RM rows never call here.
  async confirmarCriacaoIncerta(antes: OperacaoPagamento, pg: string, duracao: number): Promise<OperacaoPagamento> {
    if (typeof pg !== 'string' || !/^[1-9]\d*$/.test(pg) || !Number.isSafeInteger(Number(pg))) {
      throw new ConflitoPagamento('Movimento confirmado inválido; nenhuma retomada autorizada');
    }
    return this.retomar(antes, 'CREATED', antes.digest, pg, duracao);
  }
  // Only a caller that has not passed its durable CREATING checkpoint may end
  // this lease. A lost checkpoint response cannot satisfy this RESERVED CAS.
  async encerrarAntesDoEnvio(op: OperacaoPagamento): Promise<void> {
    if (!raizPagamento(op.pk) || op.state !== 'RESERVED' || op.protocolVersion !== 2 ||
        Object.prototype.hasOwnProperty.call(op, 'pg') || !digestValido(op.digest) ||
        typeof op.owner !== 'string' || !op.owner || !Number.isSafeInteger(op.lockUntil) || op.lockUntil <= 0) {
      throw new ConflitoPagamento('Reserva não admite encerramento antes do envio');
    }
    await this.cliente.send(new UpdateCommand({ TableName: this.tabela, Key: { pk: op.pk },
      UpdateExpression: 'SET #owner = :newOwner, lockUntil = :expired',
      ConditionExpression: '#owner = :oldOwner AND #state = :reserved AND digest = :digest' +
        ' AND lockUntil = :oldUntil AND protocolVersion = :protocol AND attribute_not_exists(pg)',
      ExpressionAttributeNames: { '#owner': 'owner', '#state': 'state' },
      ExpressionAttributeValues: { ':newOwner': randomUUID(), ':expired': Date.now() - 1, ':oldOwner': op.owner,
        ':reserved': 'RESERVED', ':digest': op.digest, ':oldUntil': op.lockUntil, ':protocol': 2 } }),
    { abortSignal: AbortSignal.timeout(2000) });
  }
  private async retomar(antes: OperacaoPagamento, estado: 'RESERVED' | 'CREATED', digest: string,
    pg: string | undefined, duracao: number,
    estadoAnterior: 'RESERVED' | 'CREATING' = estado === 'RESERVED' ? 'RESERVED' : 'CREATING'): Promise<OperacaoPagamento> {
    const agora = Date.now();
    if (!raizPagamento(antes.pk) || !digestValido(antes.digest) || typeof antes.owner !== 'string' || !antes.owner ||
      antes.state !== estadoAnterior || Object.prototype.hasOwnProperty.call(antes, 'pg') ||
      !Number.isSafeInteger(antes.lockUntil) || antes.lockUntil <= 0 || antes.lockUntil > agora ||
      !Number.isSafeInteger(duracao) || duracao <= 0 || !Number.isSafeInteger(agora + duracao + 60000)) {
      throw new ConflitoPagamento('Estado, prazo ou vínculo da reserva não admite esta retomada');
    }
    const serializado = snapshotCanonico(antes);
    const snapshot = JSON.parse(serializado) as OperacaoPagamento;
    const snapshotSha256 = createHash('sha256').update(serializado).digest('hex');
    const historico = { pk: `${snapshot.pk}#HISTORY#${snapshotSha256}`, snapshotSha256, snapshot };
    try {
      await this.cliente.send(new PutCommand({ TableName: this.tabela, Item: historico,
        ConditionExpression: 'attribute_not_exists(pk)' }), { abortSignal: AbortSignal.timeout(2000) });
    } catch (erro) {
      if (!(erro instanceof Error) || erro.name !== 'ConditionalCheckFailedException') throw erro;
      const gravado = await this.cliente.send(new GetCommand({ TableName: this.tabela,
        Key: { pk: historico.pk }, ConsistentRead: true }), { abortSignal: AbortSignal.timeout(2000) });
      if (!gravado.Item || snapshotCanonico(gravado.Item) !== snapshotCanonico(historico)) {
        throw new ConflitoPagamento('Histórico imutável da reserva não corresponde ao snapshot');
      }
    }
    // An orphan history is harmless if another writer wins. Never delete the
    // root, overwrite history or infer that a timed-out CAS did not commit.
    const owner = randomUUID(), lockUntil = Date.now() + duracao + 60000;
    if (!Number.isSafeInteger(lockUntil)) throw new ConflitoPagamento('Prazo da retomada inválido');
    const nomes: Record<string, string> = { '#owner': 'owner', '#state': 'state' };
    const valores: Record<string, unknown> = { ':owner': owner, ':until': lockUntil, ':digest': digest,
      ':newState': estado, ':oldOwner': snapshot.owner, ':oldState': snapshot.state,
      ':oldDigest': snapshot.digest, ':oldUntil': snapshot.lockUntil, ':now': Date.now() };
    let condicaoProtocolo = ' AND attribute_not_exists(protocolVersion)';
    if (Object.prototype.hasOwnProperty.call(snapshot, 'protocolVersion')) {
      valores[':protocol'] = snapshot.protocolVersion;
      condicaoProtocolo = ' AND protocolVersion = :protocol';
    }
    if (pg) { valores[':pg'] = pg; valores[':recuperada'] = true; }
    const resposta = await this.cliente.send(new UpdateCommand({ TableName: this.tabela, Key: { pk: snapshot.pk },
      UpdateExpression: `SET #owner = :owner, lockUntil = :until, digest = :digest, #state = :newState${pg ? ', pg = :pg, recuperadaCriacaoIncerta = :recuperada' : ''}`,
      ConditionExpression: '#owner = :oldOwner AND #state = :oldState AND digest = :oldDigest AND lockUntil = :oldUntil' +
        ' AND lockUntil <= :now AND attribute_not_exists(pg)' + condicaoProtocolo,
      ExpressionAttributeNames: nomes, ExpressionAttributeValues: valores, ReturnValues: 'ALL_NEW' }),
    { abortSignal: AbortSignal.timeout(2000) });
    if (!resposta.Attributes) throw new Error('Retomada sem confirmação de estado; consultar reserva');
    return resposta.Attributes as OperacaoPagamento;
  }
  // Read-only fact for deciding whether a creation-only validation applies.
  // This does not acquire a lease or authorize creation from an old snapshot.
  async movimentoConhecido(pk: string, digest: string, pg: string | undefined): Promise<string | undefined> {
    const resposta = await this.cliente.send(new GetCommand({ TableName: this.tabela, Key: { pk }, ConsistentRead: true }),
      { abortSignal: AbortSignal.timeout(2000) });
    const existente = resposta.Item as OperacaoPagamento | undefined;
    if (!existente) return undefined;
    conferirIdentidadeReserva(existente, digest, pg);
    if (!['CREATED', 'UPDATING', 'COMPLETE'].includes(existente.state)) return undefined;
    if (!existente.pg || !/^[1-9]\d*$/.test(existente.pg) || !Number.isSafeInteger(Number(existente.pg))) {
      throw new ConflitoPagamento('Reserva sem movimento durável válido; reconciliar');
    }
    return existente.pg;
  }
  async concluida(pk: string, digest: string, pg: string | undefined): Promise<OperacaoPagamento | undefined> {
    const resposta = await this.cliente.send(new GetCommand({ TableName: this.tabela, Key: { pk }, ConsistentRead: true }),
      { abortSignal: AbortSignal.timeout(2000) });
    const existente = resposta.Item as OperacaoPagamento | undefined;
    if (!existente) return undefined;
    conferirIdentidadeReserva(existente, digest, pg);
    if (existente.state !== 'COMPLETE') return undefined;
    if (!existente.pg || !/^[1-9]\d*$/.test(existente.pg)) {
      throw new ConflitoPagamento('Reserva concluída sem movimento válido; reconciliar');
    }
    return existente;
  }
  async reservar(pk: string, digest: string, pg: string | undefined, duracao: number): Promise<OperacaoPagamento> {
    const agora = Date.now();
    const novo: OperacaoPagamento = { pk, digest, owner: randomUUID(), lockUntil: agora + duracao + 60000,
      state: pg ? 'CREATED' : 'RESERVED', ...(pg ? { pg } : {}), ...(raizPagamento(pk) ? { protocolVersion: 2 as const } : {}) };
    try {
      await this.cliente.send(new PutCommand({ TableName: this.tabela, Item: novo,
        ConditionExpression: 'attribute_not_exists(pk)' }), { abortSignal: AbortSignal.timeout(2000) });
      return novo;
    } catch (erro) {
      if (!(erro instanceof Error) || erro.name !== 'ConditionalCheckFailedException') throw erro;
    }
    const resposta = await this.cliente.send(new GetCommand({ TableName: this.tabela, Key: { pk }, ConsistentRead: true }),
      { abortSignal: AbortSignal.timeout(2000) });
    const existente = resposta.Item as OperacaoPagamento | undefined;
    if (!existente) throw new ConflitoPagamento('A tentativa anterior não foi encontrada na releitura do controle de pagamento. A criação não será repetida sem confirmar esse controle.');
    conferirIdentidadeReserva(existente, digest, pg);
    if (existente.state === 'COMPLETE') {
      if (!existente.pg || !/^[1-9]\d*$/.test(existente.pg)) throw new ConflitoPagamento('Reserva concluída sem movimento válido; reconciliar');
      return existente;
    }
    if (!['RESERVED', 'CREATING', 'CREATED', 'UPDATING'].includes(existente.state) || existente.lockUntil > agora) {
      throw new ConflitoPagamento('Ticket em processamento ou estado desconhecido');
    }
    if (existente.state === 'CREATING') {
      // An expired unconfirmed attempt no longer permanently blocks a new
      // request. Preserve its snapshot and fence the previous owner before
      // returning to the normal RM lookup/creation path.
      return this.retomar(existente, 'RESERVED', digest, undefined, duracao, 'CREATING');
    }
    await this.cliente.send(new UpdateCommand({ TableName: this.tabela, Key: { pk },
      UpdateExpression: 'SET #owner = :owner, lockUntil = :until',
      ConditionExpression: '#owner = :oldOwner AND #state = :state AND digest = :digest AND lockUntil <= :now',
      ExpressionAttributeNames: { '#owner': 'owner', '#state': 'state' },
      ExpressionAttributeValues: { ':owner': novo.owner, ':until': novo.lockUntil, ':oldOwner': existente.owner,
        ':state': existente.state, ':digest': digest, ':now': agora } }), { abortSignal: AbortSignal.timeout(2000) });
    return { ...existente, owner: novo.owner, lockUntil: novo.lockUntil };
  }
  async avancar(op: OperacaoPagamento, estado: EstadoPagamento, pg = op.pg): Promise<OperacaoPagamento> {
    const proximo = { ...op, state: estado, ...(pg ? { pg } : {}) };
    if (op.continuation) {
      const continuation = lerContinuacao(op.continuation);
      if (estado === 'COMPLETE' && continuation.baseline &&
        Object.values(continuation.progress!).some(state => state !== 'COMPLETE')) {
        throw new ConflitoPagamento('Há parcelas próprias ainda não confirmadas');
      }
    }
    await this.cliente.send(new PutCommand({ TableName: this.tabela, Item: proximo,
      ConditionExpression: '#owner = :owner AND #state = :oldState AND digest = :digest AND lockUntil > :now' +
        (op.continuation ? ' AND #continuation = :continuation' : ''),
      ExpressionAttributeNames: { '#owner': 'owner', '#state': 'state', ...(op.continuation ? { '#continuation': 'continuation' } : {}) },
      ExpressionAttributeValues: { ':owner': op.owner, ':oldState': op.state, ':digest': op.digest, ':now': Date.now(),
        ...(op.continuation ? { ':continuation': op.continuation } : {}) } }),
      { abortSignal: AbortSignal.timeout(2000) });
    return proximo;
  }
}
