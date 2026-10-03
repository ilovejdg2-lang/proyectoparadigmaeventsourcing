import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { EVENT_STORE_TOKEN } from './event-store/event-store.interface';
import { InMemoryEventStore } from './event-store/in-memory-event-store';
import { TransactionNotFoundException } from './exceptions/transaction-not-found.exception';
import { InvalidTransactionTransitionException } from './exceptions/invalid-transition.exception';
import { TransactionConflictException } from './exceptions/transaction-conflict.exception';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let eventStore: InMemoryEventStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-service-'));
    process.env.EVENT_STORE_FILE = path.join(tempDir, 'event-store.jsonl');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        {
          provide: EVENT_STORE_TOKEN,
          useClass: InMemoryEventStore,
        },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
    eventStore = module.get<InMemoryEventStore>(EVENT_STORE_TOKEN);
    eventStore.clear();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('Flujo completo de transacción (Happy Path)', () => {
    it('ejecuta el ciclo de vida completo: Crear -> Solicitar -> Aprobar -> Completar', async () => {
      // 1. Crear transacción
      const createRes = await service.createTransaction({
        amount: 25000,
        currency: 'CRC',
        customerId: 'client-001',
      });

      expect(createRes.event.type).toBe('TransactionCreated');
      expect(createRes.event.version).toBe(1);
      expect(createRes.state.status).toBe('CREATED');
      expect(createRes.state.version).toBe(1);
      expect(createRes.state.attemptCount).toBe(0);

      const txnId = createRes.event.transactionId;

      // 2. Solicitar pago
      const reqRes = await service.requestPayment(txnId, {
        paymentId: 'pay-001',
        amount: 25000,
      });

      expect(reqRes.event.type).toBe('PaymentRequested');
      expect(reqRes.event.version).toBe(2);
      expect(reqRes.state.status).toBe('PAYMENT_PENDING');
      expect(reqRes.state.paymentId).toBe('pay-001');
      expect(reqRes.state.attemptCount).toBe(1);

      // 3. Aprobar pago
      const approveRes = await service.approvePayment(txnId, {
        approvalCode: 'AUTH-123456',
      });

      expect(approveRes.event.type).toBe('PaymentApproved');
      expect(approveRes.event.version).toBe(3);
      expect(approveRes.state.status).toBe('PAYMENT_APPROVED');
      expect(approveRes.state.approvalCode).toBe('AUTH-123456');

      // 4. Completar transacción
      const completeRes = await service.completeTransaction(txnId, {
        completedAt: new Date().toISOString(),
      });

      expect(completeRes.event.type).toBe('TransactionCompleted');
      expect(completeRes.event.version).toBe(4);
      expect(completeRes.state.status).toBe('COMPLETED');

      // Verificar historial de eventos
      const history = await service.getEvents(txnId);
      expect(history).toHaveLength(4);
      expect(history.map((e) => e.type)).toEqual([
        'TransactionCreated',
        'PaymentRequested',
        'PaymentApproved',
        'TransactionCompleted',
      ]);
    });
  });

  describe('Flujo con rechazo y reintento', () => {
    it('ejecuta: Crear -> Solicitar -> Rechazar -> Reintentar -> Aprobar -> Completar', async () => {
      // 1. Crear
      const created = await service.createTransaction({
        amount: 100,
        currency: 'USD',
        customerId: 'client-002',
      });
      const txnId = created.event.transactionId;

      // 2. Solicitar
      await service.requestPayment(txnId, {});

      // 3. Rechazar
      const rejectRes = await service.rejectPayment(txnId, {
        reason: 'Fondos insuficientes',
      });
      expect(rejectRes.event.type).toBe('PaymentRejected');
      expect(rejectRes.state.status).toBe('PAYMENT_REJECTED');
      expect(rejectRes.state.lastRejectionReason).toBe('Fondos insuficientes');

      // 4. Reintentar
      const retryRes = await service.retryPayment(txnId, {});
      expect(retryRes.event.type).toBe('PaymentRetried');
      expect(retryRes.state.status).toBe('PAYMENT_PENDING');
      expect(retryRes.state.attemptCount).toBe(2);

      // 5. Aprobar
      const approveRes = await service.approvePayment(txnId, {
        approvalCode: 'AUTH-RETRY-OK',
      });
      expect(approveRes.state.status).toBe('PAYMENT_APPROVED');

      // 6. Completar
      const completeRes = await service.completeTransaction(txnId, {});
      expect(completeRes.state.status).toBe('COMPLETED');

      const history = await service.getEvents(txnId);
      expect(history).toHaveLength(6);
      expect(history.map((e) => e.type)).toEqual([
        'TransactionCreated',
        'PaymentRequested',
        'PaymentRejected',
        'PaymentRetried',
        'PaymentApproved',
        'TransactionCompleted',
      ]);
    });
  });

  describe('Manejo de errores y excepciones', () => {
    it('lanza TransactionNotFoundException si la transacción no existe', async () => {
      await expect(
        service.requestPayment('no-existe', {}),
      ).rejects.toThrow(TransactionNotFoundException);
    });

    it('lanza InvalidTransactionTransitionException si se intenta una transición no permitida', async () => {
      const created = await service.createTransaction({
        amount: 50,
        currency: 'USD',
        customerId: 'c-3',
      });
      const txnId = created.event.transactionId;

      // Intentar completar directamente cuando está en CREATED
      await expect(
        service.completeTransaction(txnId, {}),
      ).rejects.toThrow(InvalidTransactionTransitionException);
    });

    it('rechaza un monto distinto y no agrega el evento', async () => {
      const created = await service.createTransaction({
        amount: 80,
        currency: 'CRC',
        customerId: 'c-amount',
      });
      const txnId = created.event.transactionId;

      await expect(
        service.requestPayment(txnId, { amount: 10 }),
      ).rejects.toThrow(InvalidTransactionTransitionException);

      const history = await service.getEvents(txnId);
      expect(history).toHaveLength(1);
    });

    it('calcula el reintento y rechaza un attemptNumber arbitrario', async () => {
      const created = await service.createTransaction({
        amount: 80,
        currency: 'CRC',
        customerId: 'c-retry',
      });
      const txnId = created.event.transactionId;
      await service.requestPayment(txnId, {});
      await service.rejectPayment(txnId, { reason: 'timeout' });

      await expect(
        service.retryPayment(txnId, { attemptNumber: 9 }),
      ).rejects.toThrow(/debe ser 2/);

      const retry = await service.retryPayment(txnId, {});
      expect(retry.event.type).toBe('PaymentRetried');
      if (retry.event.type === 'PaymentRetried') {
        expect(retry.event.data.attemptNumber).toBe(2);
      }
      expect(retry.state.attemptCount).toBe(2);
    });

    it('acepta expectedVersion correcto y rechaza uno incorrecto', async () => {
      const created = await service.createTransaction({
        amount: 80,
        currency: 'CRC',
        customerId: 'c-version',
      });
      const txnId = created.event.transactionId;

      await expect(
        service.requestPayment(txnId, { expectedVersion: 4 }),
      ).rejects.toThrow(TransactionConflictException);

      const payment = await service.requestPayment(txnId, { expectedVersion: 1 });
      expect(payment.event.version).toBe(2);
      expect(payment.state.status).toBe('PAYMENT_PENDING');
    });
  });
});
