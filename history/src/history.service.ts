import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  InvalidEventLogError,
  parseEventLog,
  replay,
  TransactionEvent,
  TransactionState,
} from '@eventsourcing/domain';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class HistoryService {
  private readonly filePath: string;

  constructor() {
    this.filePath =
      process.env.EVENT_STORE_FILE ||
      path.resolve(process.cwd(), 'data', 'event-store.jsonl');
  }

  listTransactions(): TransactionState[] {
    const grouped = new Map<string, TransactionEvent[]>();

    for (const event of this.readAll()) {
      const stream = grouped.get(event.transactionId) ?? [];
      stream.push(event);
      grouped.set(event.transactionId, stream);
    }

    return [...grouped.values()].map((stream) => this.replayStream(stream));
  }

  getEvents(transactionId: string): TransactionEvent[] {
    const events = this.readAll()
      .filter((event) => event.transactionId === transactionId)
      .sort((left, right) => left.version - right.version);

    if (events.length === 0) {
      throw new NotFoundException(
        `No se encontró la transacción con ID '${transactionId}'`,
      );
    }

    return events;
  }

  getState(transactionId: string): TransactionState {
    return this.replayStream(this.getEvents(transactionId));
  }

  readPage(): string {
    return fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
  }

  private replayStream(events: TransactionEvent[]): TransactionState {
    try {
      const state = replay(events);
      if (!state) {
        throw new UnprocessableEntityException(
          'No se pudo reconstruir el estado de la transacción',
        );
      }
      return state;
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        throw error;
      }
      const reason = error instanceof Error ? error.message : 'historial inválido';
      throw new UnprocessableEntityException(reason);
    }
  }

  private readAll(): TransactionEvent[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    let content: string;
    try {
      content = fs.readFileSync(this.filePath, { encoding: 'utf-8', flag: 'r' });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `No se pudo leer el event store: ${reason}`,
      );
    }

    try {
      return parseEventLog(content);
    } catch (error) {
      if (error instanceof InvalidEventLogError) {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }
  }
}
