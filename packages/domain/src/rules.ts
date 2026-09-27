import { replay, TransactionStatus } from './replay';
import { TransactionEvent } from './transaction-event';

export type AppendDecision =
  | { ok: true }
  | { ok: false; reason: string };

function isAllowed(status: TransactionStatus, type: TransactionEvent['type']): boolean {
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

export function canAppend(
  events: TransactionEvent[],
  next: TransactionEvent,
): AppendDecision {
  if (events.length === 0) {
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

  let state;
  try {
    state = replay(events);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Historial inválido';
    return { ok: false, reason };
  }

  if (!state) {
    return { ok: false, reason: 'No se pudo reconstruir el estado' };
  }

  if (next.transactionId !== state.transactionId) {
    return { ok: false, reason: 'El evento pertenece a otra transacción' };
  }

  if (next.version !== state.version + 1) {
    return { ok: false, reason: 'La versión debe ser la siguiente' };
  }

  if (!isAllowed(state.status, next.type)) {
    return {
      ok: false,
      reason: `${next.type} no es válido cuando el estado es ${state.status}`,
    };
  }

  return { ok: true };
}
