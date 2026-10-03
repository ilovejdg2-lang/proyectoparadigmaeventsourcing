import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TransactionEvent } from '@eventsourcing/domain';
import { HistoryAppModule } from './app.module';

const occurredAt = '2026-10-02T12:00:00.000Z';

function event(
  type: TransactionEvent['type'],
  version: number,
  data: TransactionEvent['data'],
  transactionId = 'txn-1',
): TransactionEvent {
  return {
    eventId: `evt-${transactionId}-${version}`,
    transactionId,
    type,
    version,
    occurredAt,
    data,
  } as TransactionEvent;
}

function happyPath(): TransactionEvent[] {
  return [
    event('TransactionCreated', 1, {
      amount: 1500,
      currency: 'CRC',
      customerId: 'cust-1',
    }),
    event('PaymentRequested', 2, { paymentId: 'pay-1', amount: 1500 }),
    event('PaymentApproved', 3, { approvalCode: 'AP-9' }),
    event('TransactionCompleted', 4, { completedAt: occurredAt }),
  ];
}

function rejectionPath(): TransactionEvent[] {
  return [
    event(
      'TransactionCreated',
      1,
      { amount: 900, currency: 'USD', customerId: 'cust-2' },
      'txn-2',
    ),
    event('PaymentRequested', 2, { paymentId: 'pay-2', amount: 900 }, 'txn-2'),
    event('PaymentRejected', 3, { reason: 'fondos insuficientes' }, 'txn-2'),
    event('PaymentRetried', 4, { attemptNumber: 2 }, 'txn-2'),
    event('PaymentApproved', 5, { approvalCode: 'AP-2' }, 'txn-2'),
    event('TransactionCompleted', 6, { completedAt: occurredAt }, 'txn-2'),
  ];
}

describe('History API (HTTP)', () => {
  let app: INestApplication;
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-api-'));
    filePath = path.join(tempDir, 'event-store.jsonl');
    process.env.EVENT_STORE_FILE = filePath;

    const moduleRef = await Test.createTestingModule({
      imports: [HistoryAppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeLog(events: TransactionEvent[], trailing?: string): void {
    const body = events.map((item) => JSON.stringify(item)).join('\n');
    const suffix = trailing === undefined ? '\n' : `\n${trailing}`;
    fs.writeFileSync(filePath, events.length === 0 ? '' : body + suffix, 'utf-8');
  }

  it('no crea el archivo cuando el event store todavía no existe', async () => {
    const response = await request(app.getHttpServer()).get('/history/transactions');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('lista, reconstruye el estado y devuelve el historial ordenado', async () => {
    writeLog([...happyPath(), ...rejectionPath()]);

    const list = await request(app.getHttpServer()).get('/history/transactions');
    expect(list.status).toBe(200);
    expect(list.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transactionId: 'txn-1',
          status: 'COMPLETED',
          version: 4,
          attemptCount: 1,
        }),
        expect.objectContaining({
          transactionId: 'txn-2',
          status: 'COMPLETED',
          version: 6,
          attemptCount: 2,
          lastRejectionReason: 'fondos insuficientes',
        }),
      ]),
    );

    const state = await request(app.getHttpServer()).get(
      '/history/transactions/txn-1',
    );
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      transactionId: 'txn-1',
      status: 'COMPLETED',
      amount: 1500,
      approvalCode: 'AP-9',
    });

    const history = await request(app.getHttpServer()).get(
      '/history/transactions/txn-1/events',
    );
    expect(history.status).toBe(200);
    expect(history.body.map((item: TransactionEvent) => item.type)).toEqual([
      'TransactionCreated',
      'PaymentRequested',
      'PaymentApproved',
      'TransactionCompleted',
    ]);
    expect(history.body.map((item: TransactionEvent) => item.version)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('responde 404 si la transacción no está en el log', async () => {
    writeLog(happyPath());

    const response = await request(app.getHttpServer()).get(
      '/history/transactions/no-existe',
    );

    expect(response.status).toBe(404);
    expect(response.body.status).toBeUndefined();
  });

  it('responde 422 ante una línea corrupta intermedia y no devuelve un estado', async () => {
    fs.writeFileSync(
      filePath,
      [
        JSON.stringify(happyPath()[0]),
        '{"eventId":',
        JSON.stringify(happyPath()[1]),
      ].join('\n'),
      'utf-8',
    );

    const list = await request(app.getHttpServer()).get('/history/transactions');
    const state = await request(app.getHttpServer()).get(
      '/history/transactions/txn-1',
    );

    expect(list.status).toBe(422);
    expect(list.body.message).toMatch(/Línea 2/);
    expect(list.body.transactionId).toBeUndefined();
    expect(state.status).toBe(422);
    expect(state.body.status).toBeUndefined();
    expect(state.body.transactionId).toBeUndefined();
  });

  it('responde 422 si el stream es TransactionCreated seguido de TransactionCompleted', async () => {
    writeLog([
      happyPath()[0],
      event('TransactionCompleted', 2, { completedAt: occurredAt }),
    ]);

    const response = await request(app.getHttpServer()).get(
      '/history/transactions/txn-1',
    );

    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/TransactionCompleted/);
    expect(response.body.status).toBeUndefined();
  });

  it('ignora una última línea incompleta y reconstruye el resto', async () => {
    writeLog(happyPath(), '{"eventId":"trunc"');

    const response = await request(app.getHttpServer()).get(
      '/history/transactions/txn-1',
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'COMPLETED', version: 4 });
  });

  it('sirve la pantalla con los dos bloques de consulta', async () => {
    const response = await request(app.getHttpServer()).get('/');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/html/);
    expect(response.text).toContain('Estado actual reconstruido');
    expect(response.text).toContain('Historial cronológico');
  });
});
