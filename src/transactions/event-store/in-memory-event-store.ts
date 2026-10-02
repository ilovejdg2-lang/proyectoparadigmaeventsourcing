import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { canAppend, TransactionEvent } from '@eventsourcing/domain';
import { IEventStore } from './event-store.interface';
import { TransactionConflictException } from '../exceptions/transaction-conflict.exception';
import { InvalidTransactionTransitionException } from '../exceptions/invalid-transition.exception';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class InMemoryEventStore implements IEventStore, OnModuleInit {
  private readonly logger = new Logger(InMemoryEventStore.name);
  private readonly events: TransactionEvent[] = [];
  private readonly streams: Map<string, TransactionEvent[]> = new Map();
  private readonly filePath: string;

  constructor() {
    this.filePath =
      process.env.EVENT_STORE_FILE ||
      path.resolve(process.cwd(), 'data', 'event-store.jsonl');
  }

  onModuleInit() {
    this.loadFromFile();
  }

  private loadFromFile(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf-8');
        const lines = content.split('\n').filter((line) => line.trim().length > 0);
        for (const line of lines) {
          const event = JSON.parse(line) as TransactionEvent;
          this.events.push(event);
          if (!this.streams.has(event.transactionId)) {
            this.streams.set(event.transactionId, []);
          }
          this.streams.get(event.transactionId)!.push(event);
        }
        this.logger.log(
          `Cargados ${this.events.length} eventos desde el archivo append-only: ${this.filePath}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudieron cargar eventos previos de ${this.filePath}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  private persistEvent(event: TransactionEvent): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.filePath, JSON.stringify(event) + '\n', 'utf-8');
    } catch (error) {
      this.logger.error(
        `Error al escribir de manera append-only en ${this.filePath}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  async append(
    event: TransactionEvent,
    expectedVersion?: number,
  ): Promise<TransactionEvent> {
    const stream = this.streams.get(event.transactionId) ?? [];
    const currentVersion = stream.length > 0 ? stream[stream.length - 1].version : 0;

    // Control de concurrencia optimista si se especificó expectedVersion
    if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
      throw new TransactionConflictException(
        `Conflicto de concurrencia para la transacción '${event.transactionId}': versión esperada ${expectedVersion}, pero la versión actual es ${currentVersion}.`,
      );
    }

    // Regla de unicidad para inicio de transacción
    if (stream.length > 0 && event.type === 'TransactionCreated') {
      throw new TransactionConflictException(
        `La transacción '${event.transactionId}' ya existe (versión actual: ${currentVersion}).`,
      );
    }

    // Validación de incremento estricto de versión
    if (event.version !== currentVersion + 1) {
      throw new TransactionConflictException(
        `Versión inválida para el evento ${event.type}: se esperaba ${
          currentVersion + 1
        }, pero se recibió ${event.version}.`,
      );
    }

    // Validación de reglas de dominio mediante canAppend
    const decision = canAppend(stream, event);
    if (!decision.ok) {
      throw new InvalidTransactionTransitionException(decision.reason);
    }

    // Escritura append-only (inmutable)
    const immutableEvent = Object.freeze({ ...event });
    if (!this.streams.has(event.transactionId)) {
      this.streams.set(event.transactionId, []);
    }
    this.streams.get(event.transactionId)!.push(immutableEvent);
    this.events.push(immutableEvent);

    this.persistEvent(immutableEvent);

    this.logger.log(
      `Evento agregado [${event.type}] v${event.version} a la transacción ${event.transactionId} (ID de evento: ${event.eventId})`,
    );

    return immutableEvent;
  }

  async getEventsByTransactionId(
    transactionId: string,
  ): Promise<TransactionEvent[]> {
    const stream = this.streams.get(transactionId);
    return stream ? [...stream] : [];
  }

  async getAllEvents(): Promise<TransactionEvent[]> {
    return [...this.events];
  }

  async getTransactionIds(): Promise<string[]> {
    return Array.from(this.streams.keys());
  }

  /**
   * Método de utilidad para pruebas (limpiar almacén)
   */
  clear(): void {
    this.events.length = 0;
    this.streams.clear();
  }
}
