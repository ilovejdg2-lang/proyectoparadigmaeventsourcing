import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { catchError, Observable, throwError } from 'rxjs';

function reasonOf(error: HttpException): string {
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' ? message : error.message;
}

@Injectable()
export class RejectedCommandInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Comandos');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      catchError((error: unknown) => {
        const transactionId =
          typeof req.params?.id === 'string' ? req.params.id : undefined;

        if (error instanceof HttpException && error.getStatus() < 500) {
          const reason = reasonOf(error);
          this.logger.warn({
            message: `Comando rechazado: ${req.method} ${req.originalUrl} -> ${error.getStatus()} ${reason}`,
            http_method: req.method,
            http_path: req.originalUrl,
            http_status_code: error.getStatus(),
            reason,
            transaction_id: transactionId,
          });
        } else {
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.error(
            {
              message: `Error procesando ${req.method} ${req.originalUrl}: ${err.message}`,
              http_method: req.method,
              http_path: req.originalUrl,
              transaction_id: transactionId,
            },
            err.stack,
          );
        }

        return throwError(() => error);
      }),
    );
  }
}
