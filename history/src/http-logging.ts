import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

export function logRequests(req: Request, res: Response, next: NextFunction) {
  if (req.originalUrl.startsWith('/otlp')) {
    next();
    return;
  }

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const fields = {
      message: `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`,
      http_method: req.method,
      http_path: req.originalUrl,
      http_status_code: res.statusCode,
      duration_ms: Math.round(durationMs),
    };
    if (res.statusCode >= 500) logger.error(fields);
    else logger.log(fields);
  });
  next();
}
