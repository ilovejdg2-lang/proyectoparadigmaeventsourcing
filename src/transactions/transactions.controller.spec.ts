import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { EVENT_STORE_TOKEN } from './event-store/event-store.interface';
import { InMemoryEventStore } from './event-store/in-memory-event-store';

describe('TransactionsController', () => {
  let controller: TransactionsController;
  let service: TransactionsService;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-controller-'));
    process.env.EVENT_STORE_FILE = path.join(tempDir, 'event-store.jsonl');
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        TransactionsService,
        {
          provide: EVENT_STORE_TOKEN,
          useClass: InMemoryEventStore,
        },
      ],
    }).compile();

    controller = module.get<TransactionsController>(TransactionsController);
    service = module.get<TransactionsService>(TransactionsService);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('crea una transacción a través del endpoint POST /transactions', async () => {
    const res = await controller.createTransaction({
      amount: 1000,
      currency: 'USD',
      customerId: 'cust-test',
    });

    expect(res.event.type).toBe('TransactionCreated');
    expect(res.state.status).toBe('CREATED');
    expect(res.event.version).toBe(1);
  });

  it('obtiene el estado y los eventos por ID', async () => {
    const created = await controller.createTransaction({
      amount: 2000,
      currency: 'CRC',
      customerId: 'cust-query',
    });

    const txnId = created.event.transactionId;

    const state = await controller.getState(txnId);
    expect(state.transactionId).toBe(txnId);
    expect(state.status).toBe('CREATED');

    const events = await controller.getEvents(txnId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('TransactionCreated');
  });
});
