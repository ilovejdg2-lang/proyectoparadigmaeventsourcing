import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import {
  parseEventLog,
  TransactionEvent,
  canAppend,
} from '@eventsourcing/domain';
import { IEventStore } from './event-store.interface';
import { TransactionConflictException } from '../exceptions/transaction-conflict.exception';
import { InvalidTransactionTransitionException } from '../exceptions/invalid-transition.exception';
import * as fs from 'fs';
import * as path from 'path';

function cloneEvent(event: TransactionEvent): TransactionEvent {
  return JSON.parse(JSON.stringify(event)) as TransactionEvent;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as object)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function storedEvent(event: TransactionEvent): TransactionEvent {
  return deepFreeze(cloneEvent(event));
}

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
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    const content = fs.readFileSync(this.filePath, 'utf-8');
    const loaded = parseEventLog(content);
    const nextEvents: TransactionEvent[] = [];
    const nextStreams = new Map<string, TransactionEvent[]>();

    for (const event of loaded) {
      const frozen = storedEvent(event);
      nextEvents.push(frozen);
      const stream = nextStreams.get(event.transactionId) ?? [];
      stream.push(frozen);
      nextStreams.set(event.transactionId, stream);
    }

    this.events.length = 0;
    this.events.push(...nextEvents);
    this.streams.clear();
    for (const [transactionId, stream] of nextStreams) {
      this.streams.set(transactionId, stream);
    }

    this.logger.log(
      `Cargados ${nextEvents.length} eventos desde el archivo append-only: ${this.filePath}`,
    );
  }

  private persistEvent(event: TransactionEvent): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.filePath, JSON.stringify(event) + '\n', 'utf-8');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const message = `No se pudo persistir el evento en ${this.filePath}: ${reason}`;
      this.logger.error(message);
      throw new InternalServerErrorException(message);
    }
  }

  private remember(event: TransactionEvent): void {
    if (!this.streams.has(event.transactionId)) {
      this.streams.set(event.transactionId, []);
    }
    this.streams.get(event.transactionId)!.push(event);
    this.events.push(event);
  }

  async append(
    event: TransactionEvent,
    expectedVersion?: number,
  ): Promise<TransactionEvent> {
    const stream = this.streams.get(event.transactionId) ?? [];
    const currentVersion = stream.length > 0 ? stream[stream.length - 1].version : 0;

    if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
      throw new TransactionConflictException(
        `Conflicto de concurrencia para la transacción '${event.transactionId}': versión esperada ${expectedVersion}, pero la versión actual es ${currentVersion}.`,
      );
    }

    if (stream.length > 0 && event.type === 'TransactionCreated') {
      throw new TransactionConflictException(
        `La transacción '${event.transactionId}' ya existe (versión actual: ${currentVersion}).`,
      );
    }

    if (event.version !== currentVersion + 1) {
      throw new TransactionConflictException(
        `Versión inválida para el evento ${event.type}: se esperaba ${
          currentVersion + 1
        }, pero se recibió ${event.version}.`,
      );
    }

    const decision = canAppend(stream, event);
    if (!decision.ok) {
      throw new InvalidTransactionTransitionException(decision.reason);
    }

    const immutableEvent = storedEvent(event);
    this.persistEvent(immutableEvent);
    this.remember(immutableEvent);

    this.logger.log(
      `Evento agregado [${event.type}] v${event.version} a la transacción ${event.transactionId} (ID de evento: ${event.eventId})`,
    );

    return cloneEvent(immutableEvent);
  }

  async getEventsByTransactionId(
    transactionId: string,
  ): Promise<TransactionEvent[]> {
    const stream = this.streams.get(transactionId);
    return stream ? stream.map((event) => cloneEvent(event)) : [];
  }

  async getAllEvents(): Promise<TransactionEvent[]> {
    return this.events.map((event) => cloneEvent(event));
  }

  async getTransactionIds(): Promise<string[]> {
    return Array.from(this.streams.keys());
  }

  /**
   * Método de utilidad para pruebas (limpiar almacén en memoria).
   */
  clear(): void {
    this.events.length = 0;
    this.streams.clear();
  }
}
