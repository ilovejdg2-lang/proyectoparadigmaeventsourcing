import { logs } from '@opentelemetry/api-logs';
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { OtelLogger } from './otel-logger';

describe('OtelLogger', () => {
  const exporter = new InMemoryLogRecordExporter();
  const provider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter })],
  });
  let logger: OtelLogger;

  beforeAll(() => {
    logs.setGlobalLoggerProvider(provider);
  });

  beforeEach(() => {
    exporter.reset();
    logger = new OtelLogger();
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    logs.disable();
    await provider.shutdown();
  });

  it('manda el texto como body y los campos como atributos', () => {
    logger.log(
      {
        message: 'Evento agregado [PaymentRejected] txn-1 v3',
        event_type: 'PaymentRejected',
        event_version: 3,
        transaction_id: 'txn-1',
        ignored: undefined,
      },
      'InMemoryEventStore',
    );

    const [record] = exporter.getFinishedLogRecords();
    expect(record.body).toBe('Evento agregado [PaymentRejected] txn-1 v3');
    expect(record.severityText).toBe('INFO');
    expect(record.attributes).toEqual({
      'log.context': 'InMemoryEventStore',
      event_type: 'PaymentRejected',
      event_version: 3,
      transaction_id: 'txn-1',
    });
  });

  it('imprime en consola solo el texto, no el objeto', () => {
    const stdout = jest.spyOn(process.stdout, 'write');

    logger.log({ message: 'hola', transaction_id: 'txn-1' }, 'Test');

    const printed = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(printed).toContain('hola');
    expect(printed).not.toContain('transaction_id');
  });

  it('usa WARN para advertencias', () => {
    logger.warn({ message: 'Comando rechazado', reason: 'x' }, 'Comandos');

    const [record] = exporter.getFinishedLogRecords();
    expect(record.severityText).toBe('WARN');
    expect(record.attributes.reason).toBe('x');
  });

  it('incluye el stack cuando un error trae traza y contexto', () => {
    logger.error('Falló', 'Error: boom\n    at x', 'Comandos');

    const [record] = exporter.getFinishedLogRecords();
    expect(record.severityText).toBe('ERROR');
    expect(record.body).toBe('Falló');
    expect(record.attributes['exception.stacktrace']).toBe(
      'Error: boom\n    at x',
    );
    expect(record.attributes['log.context']).toBe('Comandos');
  });

  it('convierte un Error en tipo y stack de excepción', () => {
    const error = new TypeError('dato inválido');

    logger.error(error);

    const [record] = exporter.getFinishedLogRecords();
    expect(record.body).toBe('dato inválido');
    expect(record.attributes['exception.type']).toBe('TypeError');
    expect(record.attributes['exception.stacktrace']).toBe(error.stack);
  });
});
