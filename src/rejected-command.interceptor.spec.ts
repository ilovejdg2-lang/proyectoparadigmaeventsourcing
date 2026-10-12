import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { RejectedCommandInterceptor } from './rejected-command.interceptor';

function contextFor(method: string, url: string, id?: string) {
  const req = { method, originalUrl: url, params: id ? { id } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function failingWith(error: unknown): CallHandler {
  return { handle: () => throwError(() => error) };
}

describe('RejectedCommandInterceptor', () => {
  const interceptor = new RejectedCommandInterceptor();
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registra una advertencia con el motivo cuando un comando es rechazado', async () => {
    const conflict = new ConflictException(
      'Conflicto de concurrencia: versión esperada 1, actual 2',
    );

    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor('POST', '/transactions/txn-1/approve-payment', 'txn-1'),
          failingWith(conflict),
        ),
      ),
    ).rejects.toBe(conflict);

    expect(warn).toHaveBeenCalledWith({
      message:
        'Comando rechazado: POST /transactions/txn-1/approve-payment -> 409 Conflicto de concurrencia: versión esperada 1, actual 2',
      http_method: 'POST',
      http_path: '/transactions/txn-1/approve-payment',
      http_status_code: 409,
      reason: 'Conflicto de concurrencia: versión esperada 1, actual 2',
      transaction_id: 'txn-1',
    });
  });

  it('une los mensajes de validación en el motivo', async () => {
    const invalid = new BadRequestException([
      'amount must be positive',
      'currency should not be empty',
    ]);

    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor('POST', '/transactions'),
          failingWith(invalid),
        ),
      ),
    ).rejects.toBe(invalid);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        http_status_code: 400,
        reason: 'amount must be positive, currency should not be empty',
        transaction_id: undefined,
      }),
    );
  });

  it('no cuenta como comando rechazado una consulta GET que no encuentra nada', async () => {
    const notFound = new NotFoundException('No existe');

    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor('GET', '/transactions/nope', 'nope'),
          failingWith(notFound),
        ),
      ),
    ).rejects.toBe(notFound);

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('registra como error, con stack, una falla inesperada', async () => {
    const boom = new Error('disco lleno');

    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor('POST', '/transactions/txn-1/complete', 'txn-1'),
          failingWith(boom),
        ),
      ),
    ).rejects.toBe(boom);

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Error procesando POST /transactions/txn-1/complete: disco lleno',
        transaction_id: 'txn-1',
      }),
      boom.stack,
    );
  });
});
