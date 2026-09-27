import { isTransactionEvent, TransactionEvent } from './transaction-event';

const occurredAt = '2026-09-27T12:00:00.000Z';

function event(
  type: TransactionEvent['type'],
  data: TransactionEvent['data'],
  version = 1,
): TransactionEvent {
  return {
    eventId: 'evt-1',
    transactionId: 'txn-1',
    type,
    version,
    occurredAt,
    data,
  } as TransactionEvent;
}

describe('isTransactionEvent', () => {
  it.each([
    event('TransactionCreated', {
      amount: 1500,
      currency: 'CRC',
      customerId: 'cust-1',
    }),
    event('PaymentRequested', { paymentId: 'pay-1', amount: 1500 }, 2),
    event('PaymentRejected', { reason: 'fondos insuficientes' }, 3),
    event('PaymentRetried', { attemptNumber: 2 }, 4),
    event('PaymentApproved', { approvalCode: 'AP-9' }, 5),
    event('TransactionCompleted', { completedAt: occurredAt }, 6),
  ])('acepta un $type', (candidate) => {
    expect(isTransactionEvent(candidate)).toBe(true);
  });

  it('rechaza un tipo desconocido', () => {
    expect(
      isTransactionEvent({
        eventId: 'evt-1',
        transactionId: 'txn-1',
        type: 'PaymentCancelled',
        version: 1,
        occurredAt,
        data: {},
      }),
    ).toBe(false);
  });

  it('rechaza una transacción creada sin monto', () => {
    expect(
      isTransactionEvent({
        ...event('TransactionCreated', {
          amount: 1500,
          currency: 'CRC',
          customerId: 'cust-1',
        }),
        data: { currency: 'CRC', customerId: 'cust-1' },
      }),
    ).toBe(false);
  });

  it('rechaza la versión 0', () => {
    expect(
      isTransactionEvent({
        ...event('PaymentRejected', { reason: 'timeout' }),
        version: 0,
      }),
    ).toBe(false);
  });

  it('rechaza un sobre sin transactionId', () => {
    expect(
      isTransactionEvent({
        eventId: 'evt-1',
        type: 'PaymentApproved',
        version: 1,
        occurredAt,
        data: { approvalCode: 'AP-1' },
      }),
    ).toBe(false);
  });
});
