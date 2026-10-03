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

export type AppendDecision = { ok: true } | { ok: false; reason: string };

function isAllowed(
  status: TransactionStatus,
  type: TransactionEvent['type'],
): boolean {
  switch (status) {
    case 'CREATED':
      return type === 'PaymentRequested';
    case 'PAYMENT_PENDING':
      return type === 'PaymentRejected' || type === 'PaymentApproved';
    case 'PAYMENT_REJECTED':
      return type === 'PaymentRetried';
    case 'PAYMENT_APPROVED':
      return type === 'TransactionCompleted';
    case 'COMPLETED':
      return false;
  }
}

/**
 * Única máquina de transiciones. La usan tanto canAppend como replay.
 */
export function assessNext(
  state: TransactionState | null,
  next: TransactionEvent,
): AppendDecision {
  if (!state) {
    if (next.type !== 'TransactionCreated') {
      return {
        ok: false,
        reason: 'La transacción debe empezar con TransactionCreated',
      };
    }

    if (next.version !== 1) {
      return { ok: false, reason: 'La primera versión debe ser 1' };
    }

    return { ok: true };
  }

  if (next.transactionId !== state.transactionId) {
    return { ok: false, reason: 'El evento pertenece a otra transacción' };
  }

  if (next.version !== state.version + 1) {
    return {
      ok: false,
      reason: `La versión debe ser ${state.version + 1}, pero se recibió ${next.version}`,
    };
  }

  if (!isAllowed(state.status, next.type)) {
    return {
      ok: false,
      reason: `${next.type} no es válido cuando el estado es ${state.status}`,
    };
  }

  if (next.type === 'PaymentRequested' && next.data.amount !== state.amount) {
    return {
      ok: false,
      reason: 'El monto del pago no coincide con el monto de la transacción',
    };
  }

  if (
    next.type === 'PaymentRetried' &&
    next.data.attemptNumber !== state.attemptCount + 1
  ) {
    return {
      ok: false,
      reason: `El número de reintento debe ser ${state.attemptCount + 1}`,
    };
  }

  return { ok: true };
}

function apply(
  state: TransactionState | null,
  event: TransactionEvent,
): TransactionState {
  if (event.type === 'TransactionCreated') {
    return {
      transactionId: event.transactionId,
      status: 'CREATED',
      amount: event.data.amount,
      currency: event.data.currency,
      customerId: event.data.customerId,
      version: event.version,
      attemptCount: 0,
    };
  }

  if (!state) {
    throw new Error('La transacción debe empezar con TransactionCreated');
  }

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

  let state: TransactionState | null = null;

  for (const event of events) {
    const decision = assessNext(state, event);
    if (!decision.ok) {
      throw new Error(decision.reason);
    }
    state = apply(state, event);
  }

  return state;
}
