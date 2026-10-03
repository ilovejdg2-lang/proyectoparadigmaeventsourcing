import { replay } from './replay';
import { TransactionEvent } from './transaction-event';

const occurredAt = '2026-09-27T12:00:00.000Z';

function created(version = 1): TransactionEvent {
  return {
    eventId: `evt-${version}`,
    transactionId: 'txn-1',
    type: 'TransactionCreated',
    version,
    occurredAt,
    data: { amount: 1500, currency: 'CRC', customerId: 'cust-1' },
  };
}

function requested(version: number): TransactionEvent {
  return {
    eventId: `evt-${version}`,
    transactionId: 'txn-1',
    type: 'PaymentRequested',
    version,
    occurredAt,
    data: { paymentId: 'pay-1', amount: 1500 },
  };
}

function rejected(version: number): TransactionEvent {
  return {
    eventId: `evt-${version}`,
    transactionId: 'txn-1',
    type: 'PaymentRejected',
    version,
    occurredAt,
    data: { reason: 'fondos insuficientes' },
  };
}

function retried(version: number): TransactionEvent {
  return {
    eventId: `evt-${version}`,
    transactionId: 'txn-1',
    type: 'PaymentRetried',
    version,
    occurredAt,
    data: { attemptNumber: 2 },
  };
}

function approved(version: number): TransactionEvent {
  return {
    eventId: `evt-${version}`,
    transactionId: 'txn-1',
    type: 'PaymentApproved',
    version,
    occurredAt,
    data: { approvalCode: 'AP-9' },
  };
}

function completed(version: number): TransactionEvent {
  return {
    eventId: `evt-${version}`,
    transactionId: 'txn-1',
    type: 'TransactionCompleted',
    version,
    occurredAt,
    data: { completedAt: occurredAt },
  };
}

describe('replay', () => {
  it('devuelve null si no hay eventos', () => {
    expect(replay([])).toBeNull();
  });

  it('reconstruye una transacción recién creada', () => {
    expect(replay([created()])).toEqual({
      transactionId: 'txn-1',
      status: 'CREATED',
      amount: 1500,
      currency: 'CRC',
      customerId: 'cust-1',
      version: 1,
      attemptCount: 0,
    });
  });

  it('reconstruye el camino feliz hasta COMPLETED', () => {
    const state = replay([created(), requested(2), approved(3), completed(4)]);

    expect(state).toMatchObject({
      status: 'COMPLETED',
      amount: 1500,
      approvalCode: 'AP-9',
      attemptCount: 1,
      version: 4,
      completedAt: occurredAt,
    });
  });

  it('reconstruye un rechazo y un reintento', () => {
    const state = replay([
      created(),
      requested(2),
      rejected(3),
      retried(4),
      approved(5),
      completed(6),
    ]);

    expect(state).toMatchObject({
      status: 'COMPLETED',
      attemptCount: 2,
      lastRejectionReason: 'fondos insuficientes',
      version: 6,
    });
  });

  it('deja el estado en PAYMENT_REJECTED si el historial termina ahí', () => {
    expect(replay([created(), requested(2), rejected(3)])).toMatchObject({
      status: 'PAYMENT_REJECTED',
      lastRejectionReason: 'fondos insuficientes',
      version: 3,
    });
  });

  it('rechaza un primer evento que no es TransactionCreated', () => {
    expect(() => replay([requested(1)])).toThrow(/TransactionCreated/);
  });

  it('rechaza un primer evento cuya versión no es 1', () => {
    expect(() => replay([created(2)])).toThrow(/primera versión/);
  });

  it('rechaza una versión faltante', () => {
    expect(() => replay([created(), requested(3)])).toThrow(
      /debe ser 2, pero se recibió 3/,
    );
  });

  it('rechaza una versión duplicada', () => {
    expect(() => replay([created(), requested(1)])).toThrow(
      /debe ser 2, pero se recibió 1/,
    );
  });

  it('rechaza un evento ilegal para el estado actual', () => {
    expect(() => replay([created(), approved(2)])).toThrow(
      /PaymentApproved no es válido cuando el estado es CREATED/,
    );
  });

  it('rechaza un evento de otra transacción', () => {
    const other = { ...requested(2), transactionId: 'txn-2' };

    expect(() => replay([created(), other])).toThrow(/otra transacción/);
  });

  it('rechaza TransactionCreated seguido de TransactionCompleted', () => {
    expect(() => replay([created(), completed(2)])).toThrow(
      /TransactionCompleted no es válido cuando el estado es CREATED/,
    );
  });

  it('rechaza un historial fuera de orden', () => {
    expect(() => replay([requested(2), created(1)])).toThrow(
      /TransactionCreated/,
    );
  });

  it('rechaza un monto de pago distinto al de la transacción', () => {
    const wrongAmount = requested(2);
    wrongAmount.data = { ...wrongAmount.data, amount: 1 };

    expect(() => replay([created(), wrongAmount])).toThrow(/monto/);
  });

  it('rechaza un attemptNumber que no es el siguiente reintento', () => {
    const wrongAttempt = retried(4);
    wrongAttempt.data = { ...wrongAttempt.data, attemptNumber: 9 };

    expect(() =>
      replay([created(), requested(2), rejected(3), wrongAttempt]),
    ).toThrow(/número de reintento debe ser 2/);
  });
});
