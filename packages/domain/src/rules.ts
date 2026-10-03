import { assessNext, replay, type AppendDecision } from './replay';
import { TransactionEvent } from './transaction-event';

export type { AppendDecision };

export function canAppend(
  events: TransactionEvent[],
  next: TransactionEvent,
): AppendDecision {
  let state = null;

  if (events.length > 0) {
    try {
      state = replay(events);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Historial inválido';
      return { ok: false, reason };
    }

    if (!state) {
      return { ok: false, reason: 'No se pudo reconstruir el estado' };
    }
  }

  return assessNext(state, next);
}
