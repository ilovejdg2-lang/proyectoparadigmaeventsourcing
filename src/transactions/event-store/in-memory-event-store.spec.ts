import { InMemoryEventStore } from './in-memory-event-store';
import { TransactionCreated, PaymentRequested, PaymentApproved } from '@eventsourcing/domain';
import { TransactionConflictException } from '../exceptions/transaction-conflict.exception';
import { InvalidTransactionTransitionException } from '../exceptions/invalid-transition.exception';

describe('InMemoryEventStore', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    // Usamos una ruta vacía o temporal para no depender de archivos en pruebas unitarias
    process.env.EVENT_STORE_FILE = '';
    store = new InMemoryEventStore();
    store.clear();
  });

  const baseCreatedEvent: TransactionCreated = {
    eventId: 'evt-1',
    transactionId: 'txn-100',
    type: 'TransactionCreated',
    version: 1,
    occurredAt: new Date().toISOString(),
    data: {
      amount: 5000,
      currency: 'USD',
      customerId: 'cust-1',
    },
  };

  it('agrega el primer evento TransactionCreated correctamente', async () => {
    const appended = await store.append(baseCreatedEvent);
    expect(appended).toEqual(baseCreatedEvent);

    const events = await store.getEventsByTransactionId('txn-100');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('TransactionCreated');
    expect(events[0].version).toBe(1);
  });

  it('rechaza un primer evento que no sea TransactionCreated', async () => {
    const paymentReq: PaymentRequested = {
      eventId: 'evt-2',
      transactionId: 'txn-new',
      type: 'PaymentRequested',
      version: 1,
      occurredAt: new Date().toISOString(),
      data: {
        paymentId: 'pay-1',
        amount: 5000,
      },
    };

    await expect(store.append(paymentReq)).rejects.toThrow(
      InvalidTransactionTransitionException,
    );
  });

  it('rechaza crear una transacción con un ID que ya existe', async () => {
    await store.append(baseCreatedEvent);

    const duplicateCreated: TransactionCreated = {
      ...baseCreatedEvent,
      eventId: 'evt-dup',
    };

    await expect(store.append(duplicateCreated)).rejects.toThrow(
      TransactionConflictException,
    );
  });

  it('rechaza eventos con versión no consecutiva', async () => {
    await store.append(baseCreatedEvent);

    const skippedVersion: PaymentRequested = {
      eventId: 'evt-3',
      transactionId: 'txn-100',
      type: 'PaymentRequested',
      version: 3, // Debería ser 2
      occurredAt: new Date().toISOString(),
      data: {
        paymentId: 'pay-1',
        amount: 5000,
      },
    };

    await expect(store.append(skippedVersion)).rejects.toThrow(
      TransactionConflictException,
    );
  });

  it('valida control de concurrencia optimista con expectedVersion', async () => {
    await store.append(baseCreatedEvent);

    const paymentReq: PaymentRequested = {
      eventId: 'evt-2',
      transactionId: 'txn-100',
      type: 'PaymentRequested',
      version: 2,
      occurredAt: new Date().toISOString(),
      data: {
        paymentId: 'pay-1',
        amount: 5000,
      },
    };

    // Si especificamos expectedVersion errónea (ej. 2 en vez de la actual 1)
    await expect(store.append(paymentReq, 2)).rejects.toThrow(
      TransactionConflictException,
    );

    // Con la esperada correcta (1) debe ser exitoso
    const appended = await store.append(paymentReq, 1);
    expect(appended.version).toBe(2);
  });

  it('rechaza transiciones inválidas según las reglas de dominio', async () => {
    await store.append(baseCreatedEvent);

    // Intentar aprobar directamente sin haber solicitado pago primero
    const directApproval: PaymentApproved = {
      eventId: 'evt-direct',
      transactionId: 'txn-100',
      type: 'PaymentApproved',
      version: 2,
      occurredAt: new Date().toISOString(),
      data: {
        approvalCode: 'AUTH-123',
      },
    };

    await expect(store.append(directApproval)).rejects.toThrow(
      InvalidTransactionTransitionException,
    );
  });

  it('mantiene la inmutabilidad y lista todos los eventos globales de forma append-only', async () => {
    await store.append(baseCreatedEvent);

    const paymentReq: PaymentRequested = {
      eventId: 'evt-2',
      transactionId: 'txn-100',
      type: 'PaymentRequested',
      version: 2,
      occurredAt: new Date().toISOString(),
      data: {
        paymentId: 'pay-1',
        amount: 5000,
      },
    };
    await store.append(paymentReq);

    const allEvents = await store.getAllEvents();
    expect(allEvents).toHaveLength(2);
    expect(allEvents[0].version).toBe(1);
    expect(allEvents[1].version).toBe(2);

    const txIds = await store.getTransactionIds();
    expect(txIds).toContain('txn-100');
  });
});
