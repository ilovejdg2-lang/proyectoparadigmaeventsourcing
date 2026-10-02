import { TransactionEvent } from '@eventsourcing/domain';

export const EVENT_STORE_TOKEN = Symbol('EVENT_STORE');

export interface IEventStore {
  /**
   * Agrega un nuevo evento de manera append-only respetando la versión y reglas de transición.
   */
  append(
    event: TransactionEvent,
    expectedVersion?: number,
  ): Promise<TransactionEvent>;

  /**
   * Obtiene todos los eventos de una transacción ordenados por versión.
   */
  getEventsByTransactionId(transactionId: string): Promise<TransactionEvent[]>;

  /**
   * Obtiene todos los eventos del almacén (historial global append-only).
   */
  getAllEvents(): Promise<TransactionEvent[]>;

  /**
   * Obtiene la lista de IDs de transacciones registradas.
   */
  getTransactionIds(): Promise<string[]>;
}
