import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export type EstadoPagamento = 'RESERVED' | 'CREATING' | 'CREATED' | 'UPDATING' | 'COMPLETE';
export type OperacaoPagamento = {
  pk: string; digest: string; owner: string; lockUntil: number; state: EstadoPagamento; pg?: string;
};
export interface RepositorioPagamento {
  reservar(pk: string, digest: string, pg: string | undefined, duracao: number): Promise<OperacaoPagamento>;
  avancar(operacao: OperacaoPagamento, estado: EstadoPagamento, pg?: string): Promise<OperacaoPagamento>;
}
export class ConflitoPagamento extends Error {}

// Não há TTL nem delete: apagar uma reserva possibilitaria duplicação no RM.
export class DynamoPagamento implements RepositorioPagamento {
  constructor(private readonly tabela: string,
    private readonly cliente = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 1 }))) {}
  async reservar(pk: string, digest: string, pg: string | undefined, duracao: number): Promise<OperacaoPagamento> {
    const agora = Date.now();
    const novo: OperacaoPagamento = { pk, digest, owner: randomUUID(), lockUntil: agora + duracao + 60000,
      state: pg ? 'CREATED' : 'RESERVED', ...(pg ? { pg } : {}) };
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
    if (!existente || existente.digest !== digest || (pg && pg !== existente.pg)) throw new ConflitoPagamento('Ticket reservado com dados diferentes; reconciliar antes de prosseguir');
    if (existente.state === 'COMPLETE') {
      if (!existente.pg || !/^[1-9]\d*$/.test(existente.pg)) throw new ConflitoPagamento('Reserva concluída sem movimento válido; reconciliar');
      return existente;
    }
    if (existente.state === 'CREATING') throw new ConflitoPagamento('Criação RM incerta; requer reconciliação, nunca nova criação automática');
    if (!['RESERVED', 'CREATED', 'UPDATING'].includes(existente.state) || existente.lockUntil > agora) {
      throw new ConflitoPagamento('Ticket em processamento ou estado desconhecido');
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
    await this.cliente.send(new PutCommand({ TableName: this.tabela, Item: proximo,
      ConditionExpression: '#owner = :owner AND #state = :oldState AND digest = :digest AND lockUntil > :now',
      ExpressionAttributeNames: { '#owner': 'owner', '#state': 'state' },
      ExpressionAttributeValues: { ':owner': op.owner, ':oldState': op.state, ':digest': op.digest, ':now': Date.now() } }),
      { abortSignal: AbortSignal.timeout(2000) });
    return proximo;
  }
}
