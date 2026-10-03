import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InMemoryEventStore } from './in-memory-event-store';
import {
  InvalidEventLogError,
  PaymentApproved,
  PaymentRequested,
  replay,
  TransactionCreated,
} from '@eventsourcing/domain';
import { TransactionConflictException } from '../exceptions/transaction-conflict.exception';
import { InvalidTransactionTransitionException } from '../exceptions/invalid-transition.exception';

describe('InMemoryEventStore', () => {
  let store: InMemoryEventStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-event-store-'));
    process.env.EVENT_STORE_FILE = path.join(tempDir, 'event-store.jsonl');
    store = new InMemoryEventStore();
    store.clear();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
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

    const external = await store.getEventsByTransactionId('txn-100');
    external[0].data.amount = 1;
    external.push({ ...external[0] });
    const stored = await store.getEventsByTransactionId('txn-100');
    expect(stored).toHaveLength(2);
    expect(stored[0].data.amount).toBe(5000);
  });

  it('reconstruye el mismo estado al reiniciar desde el JSONL', async () => {
    await store.append(baseCreatedEvent);
    const paymentReq: PaymentRequested = {
      eventId: 'evt-2',
      transactionId: 'txn-100',
      type: 'PaymentRequested',
      version: 2,
      occurredAt: baseCreatedEvent.occurredAt,
      data: { paymentId: 'pay-1', amount: 5000 },
    };
    await store.append(paymentReq, 1);

    const before = replay(await store.getEventsByTransactionId('txn-100'));
    const restarted = new InMemoryEventStore();
    restarted.onModuleInit();
    const after = replay(await restarted.getEventsByTransactionId('txn-100'));

    expect(after).toEqual(before);
    expect(after).toMatchObject({
      status: 'PAYMENT_PENDING',
      version: 2,
      amount: 5000,
    });
  });

  it('no modifica la memoria si falla la escritura del archivo', async () => {
    const blockedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-store-ro-'));
    const blockedPath = path.join(blockedRoot, 'not-a-file');
    fs.mkdirSync(blockedPath);
    const previous = process.env.EVENT_STORE_FILE;
    process.env.EVENT_STORE_FILE = blockedPath;

    try {
      const failingStore = new InMemoryEventStore();
      await expect(failingStore.append(baseCreatedEvent)).rejects.toThrow(
        /persistir/,
      );
      await expect(failingStore.getAllEvents()).resolves.toEqual([]);
      await expect(
        failingStore.getEventsByTransactionId('txn-100'),
      ).resolves.toEqual([]);
    } finally {
      process.env.EVENT_STORE_FILE = previous;
      fs.rmSync(blockedRoot, { recursive: true, force: true });
    }
  });

  it('carga un JSONL válido', () => {
    const file = process.env.EVENT_STORE_FILE as string;
    fs.writeFileSync(
      file,
      `${JSON.stringify(baseCreatedEvent)}\n`,
      'utf-8',
    );

    store.onModuleInit();

    return expect(store.getEventsByTransactionId('txn-100')).resolves.toEqual([
      baseCreatedEvent,
    ]);
  });

  it('no arranca con un stream parcial si hay una línea corrupta intermedia', async () => {
    const file = process.env.EVENT_STORE_FILE as string;
    const second: PaymentRequested = {
      eventId: 'evt-2',
      transactionId: 'txn-100',
      type: 'PaymentRequested',
      version: 2,
      occurredAt: baseCreatedEvent.occurredAt,
      data: { paymentId: 'pay-1', amount: 5000 },
    };
    fs.writeFileSync(
      file,
      [JSON.stringify(baseCreatedEvent), '{"roto":', JSON.stringify(second)].join(
        '\n',
      ),
      'utf-8',
    );

    expect(() => store.onModuleInit()).toThrow(InvalidEventLogError);
    await expect(store.getAllEvents()).resolves.toEqual([]);
    await expect(store.getEventsByTransactionId('txn-100')).resolves.toEqual(
      [],
    );
  });

  it('ignora solo una última línea incompleta al cargar', async () => {
    const file = process.env.EVENT_STORE_FILE as string;
    fs.writeFileSync(
      file,
      `${JSON.stringify(baseCreatedEvent)}\n{"eventId":"trunc"`,
      'utf-8',
    );

    store.onModuleInit();

    const events = await store.getEventsByTransactionId('txn-100');
    expect(events).toEqual([baseCreatedEvent]);
  });
});
