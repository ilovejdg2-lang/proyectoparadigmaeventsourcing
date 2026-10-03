import { InvalidEventLogError, parseEventLog } from './event-log';
import { replay } from './replay';
import { TransactionEvent } from './transaction-event';

const occurredAt = '2026-09-27T12:00:00.000Z';

function created(): TransactionEvent {
  return {
    eventId: 'evt-1',
    transactionId: 'txn-1',
    type: 'TransactionCreated',
    version: 1,
    occurredAt,
    data: { amount: 1500, currency: 'CRC', customerId: 'cust-1' },
  };
}

function requested(): TransactionEvent {
  return {
    eventId: 'evt-2',
    transactionId: 'txn-1',
    type: 'PaymentRequested',
    version: 2,
    occurredAt,
    data: { paymentId: 'pay-1', amount: 1500 },
  };
}

describe('parseEventLog', () => {
  it('lee un JSONL válido y conserva una secuencia reproducible', () => {
    const content = `${JSON.stringify(created())}\n${JSON.stringify(requested())}\n`;
    const events = parseEventLog(content);

    expect(events.map((event) => event.type)).toEqual([
      'TransactionCreated',
      'PaymentRequested',
    ]);
    expect(replay(events)).toMatchObject({
      status: 'PAYMENT_PENDING',
      version: 2,
      amount: 1500,
    });
  });

  it('rechaza una línea corrupta intermedia y no devuelve el prefijo válido', () => {
    const content = [
      JSON.stringify(created()),
      '{"eventId":',
      JSON.stringify(requested()),
    ].join('\n');

    expect(() => parseEventLog(content)).toThrow(InvalidEventLogError);
    expect(() => parseEventLog(content)).toThrow(/Línea 2/);
  });

  it('ignora únicamente una última línea JSON incompleta', () => {
    const content = `${JSON.stringify(created())}\n{"eventId":"evt-trunc"`;
    const events = parseEventLog(content);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('TransactionCreated');
  });

  it('no ignora una última línea que es JSON pero no es un evento', () => {
    const content = `${JSON.stringify(created())}\n{"hello":true}`;

    expect(() => parseEventLog(content)).toThrow(/no es un evento/);
  });

  it('rechaza el archivo completo si un stream tiene un salto de versión', () => {
    const skipped = { ...requested(), version: 4 };
    const content = `${JSON.stringify(created())}\n${JSON.stringify(skipped)}\n`;

    expect(() => parseEventLog(content)).toThrow(InvalidEventLogError);
    expect(() => parseEventLog(content)).toThrow(/txn-1/);
  });
});