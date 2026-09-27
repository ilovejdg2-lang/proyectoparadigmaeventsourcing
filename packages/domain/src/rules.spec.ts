import { replay } from './replay';
import { canAppend } from './rules';
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

describe('canAppend', () => {
  it('permite crear la transacción como primer evento', () => {
    expect(canAppend([], created())).toEqual({ ok: true });
  });

  it('rechaza un pago si la transacción no existe', () => {
    expect(canAppend([], requested(1)).ok).toBe(false);
  });

  it('permite solicitar el pago cuando está creada', () => {
    expect(canAppend([created()], requested(2))).toEqual({ ok: true });
  });

  it('rechaza aprobar antes de solicitar el pago', () => {
    expect(canAppend([created()], approved(2)).ok).toBe(false);
  });

  it('permite rechazar o aprobar un pago pendiente', () => {
    const pending = [created(), requested(2)];

    expect(canAppend(pending, rejected(3))).toEqual({ ok: true });
    expect(canAppend(pending, approved(3))).toEqual({ ok: true });
  });

  it('permite reintentar solo después de un rechazo', () => {
    const pending = [created(), requested(2)];
    const rejectedHistory = [...pending, rejected(3)];

    expect(canAppend(pending, retried(3)).ok).toBe(false);
    expect(canAppend(rejectedHistory, retried(4))).toEqual({ ok: true });
  });

  it('permite aprobar después de un reintento', () => {
    const history = [created(), requested(2), rejected(3), retried(4)];

    expect(replay(history)).toMatchObject({
      status: 'PAYMENT_PENDING',
      attemptCount: 2,
    });
    expect(canAppend(history, approved(5))).toEqual({ ok: true });
  });

  it('permite completar solo si el pago fue aprobado', () => {
    const pending = [created(), requested(2)];
    const approvedHistory = [...pending, approved(3)];

    expect(canAppend(pending, completed(3)).ok).toBe(false);
    expect(canAppend(approvedHistory, completed(4))).toEqual({ ok: true });
  });

  it('rechaza cualquier evento cuando ya está completada', () => {
    const done = [created(), requested(2), approved(3), completed(4)];

    expect(canAppend(done, requested(5)).ok).toBe(false);
  });

  it('rechaza una versión que no es la siguiente', () => {
    expect(canAppend([created()], requested(3)).ok).toBe(false);
  });

  it('rechaza un evento de otra transacción', () => {
    const other = { ...requested(2), transactionId: 'txn-2' };

    expect(canAppend([created()], other).ok).toBe(false);
  });
});
