import { TransactionEvent } from './transaction-event';

export type TransactionStatus =
  | 'CREATED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_REJECTED'
  | 'PAYMENT_APPROVED'
  | 'COMPLETED';

export interface TransactionState {
  transactionId: string;
  status: TransactionStatus;
  amount: number;
  currency: string;
  customerId: string;
  version: number;
  attemptCount: number;
  paymentId?: string;
  lastRejectionReason?: string;
  approvalCode?: string;
  completedAt?: string;
}

function apply(
  state: TransactionState,
  event: Exclude<TransactionEvent, { type: 'TransactionCreated' }>,
): TransactionState {
  switch (event.type) {
    case 'PaymentRequested':
      return {
        ...state,
        status: 'PAYMENT_PENDING',
        paymentId: event.data.paymentId,
        attemptCount: 1,
        version: event.version,
      };
    case 'PaymentRejected':
      return {
        ...state,
        status: 'PAYMENT_REJECTED',
        lastRejectionReason: event.data.reason,
        version: event.version,
      };
    case 'PaymentRetried':
      return {
        ...state,
        status: 'PAYMENT_PENDING',
        attemptCount: event.data.attemptNumber,
        version: event.version,
      };
    case 'PaymentApproved':
      return {
        ...state,
        status: 'PAYMENT_APPROVED',
        approvalCode: event.data.approvalCode,
        version: event.version,
      };
    case 'TransactionCompleted':
      return {
        ...state,
        status: 'COMPLETED',
        completedAt: event.data.completedAt,
        version: event.version,
      };
  }
}

export function replay(events: TransactionEvent[]): TransactionState | null {
  if (events.length === 0) {
    return null;
  }

  const [first, ...rest] = events;

  if (first.type !== 'TransactionCreated') {
    throw new Error('El historial debe empezar con TransactionCreated');
  }

  let state: TransactionState = {
    transactionId: first.transactionId,
    status: 'CREATED',
    amount: first.data.amount,
    currency: first.data.currency,
    customerId: first.data.customerId,
    version: first.version,
    attemptCount: 0,
  };

  for (const event of rest) {
    if (event.transactionId !== state.transactionId) {
      throw new Error('Los eventos pertenecen a otra transacción');
    }

    if (event.type === 'TransactionCreated') {
      throw new Error('TransactionCreated solo puede ser el primer evento');
    }

    state = apply(state, event);
  }

  return state;
}
