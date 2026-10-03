import { replay } from './replay';
import { isTransactionEvent, TransactionEvent } from './transaction-event';

export class InvalidEventLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEventLogError';
  }
}

function isIncompleteJson(line: string): boolean {
  try {
    JSON.parse(line);
    return false;
  } catch {
    return true;
  }
}

/**
 * Lee un JSONL append-only.
 * Ignora solo una última línea truncada (escritura cortada).
 * Cualquier otra línea inválida, o una secuencia que replay rechace,
 * invalida el archivo completo: no se devuelve un stream parcial.
 */
export function parseEventLog(content: string): TransactionEvent[] {
  if (content.length === 0) {
    return [];
  }

  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  if (lines.length === 0 || lines.every((line) => line.trim() === '')) {
    return [];
  }

  const parsed: Array<{ lineNumber: number; event: TransactionEvent }> = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    const isLast = index === lines.length - 1;

    if (line.trim() === '') {
      throw new InvalidEventLogError(
        `Línea ${lineNumber} vacía dentro del historial`,
      );
    }

    if (isIncompleteJson(line)) {
      if (isLast) {
        continue;
      }
      throw new InvalidEventLogError(
        `Línea ${lineNumber} corrupta: JSON inválido`,
      );
    }

    const value: unknown = JSON.parse(line);
    if (!isTransactionEvent(value)) {
      throw new InvalidEventLogError(
        `Línea ${lineNumber} no es un evento de transacción válido`,
      );
    }

    parsed.push({ lineNumber, event: value });
  }

  const streams = new Map<string, TransactionEvent[]>();
  const accepted: TransactionEvent[] = [];

  for (const { lineNumber, event } of parsed) {
    const stream = streams.get(event.transactionId) ?? [];
    stream.push(event);

    try {
      replay(stream);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'secuencia inválida';
      throw new InvalidEventLogError(
        `Línea ${lineNumber}: el stream '${event.transactionId}' es inválido: ${reason}`,
      );
    }

    streams.set(event.transactionId, stream);
    accepted.push(event);
  }

  return accepted;
}
