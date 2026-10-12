import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { AnyValueMap, logs, SeverityNumber } from '@opentelemetry/api-logs';

export interface LogFields {
  message: string;
  [attribute: string]: string | number | boolean | undefined;
}

const SEVERITY: Record<LogLevel, [SeverityNumber, string]> = {
  verbose: [SeverityNumber.TRACE, 'TRACE'],
  debug: [SeverityNumber.DEBUG, 'DEBUG'],
  log: [SeverityNumber.INFO, 'INFO'],
  warn: [SeverityNumber.WARN, 'WARN'],
  error: [SeverityNumber.ERROR, 'ERROR'],
  fatal: [SeverityNumber.FATAL, 'FATAL'],
};

function isLogFields(value: unknown): value is LogFields {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

export class OtelLogger extends ConsoleLogger {
  log(message: unknown, ...params: unknown[]) {
    super.log(this.text(message), ...params);
    this.emit('log', message, params);
  }

  warn(message: unknown, ...params: unknown[]) {
    super.warn(this.text(message), ...params);
    this.emit('warn', message, params);
  }

  error(message: unknown, ...params: unknown[]) {
    super.error(this.text(message), ...params);
    this.emit('error', message, params);
  }

  debug(message: unknown, ...params: unknown[]) {
    super.debug(this.text(message), ...params);
    this.emit('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]) {
    super.verbose(this.text(message), ...params);
    this.emit('verbose', message, params);
  }

  fatal(message: unknown, ...params: unknown[]) {
    super.fatal(this.text(message), ...params);
    this.emit('fatal', message, params);
  }

  private text(message: unknown): unknown {
    return isLogFields(message) ? message.message : message;
  }

  private emit(level: LogLevel, message: unknown, params: unknown[]) {
    const attributes: AnyValueMap = {};
    const last = params[params.length - 1];
    if (typeof last === 'string') attributes['log.context'] = last;
    if (
      level === 'error' &&
      params.length > 1 &&
      typeof params[0] === 'string'
    ) {
      attributes['exception.stacktrace'] = params[0];
    }

    let body: string;
    if (isLogFields(message)) {
      const { message: text, ...fields } = message;
      body = text;
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) attributes[key] = value;
      }
    } else if (message instanceof Error) {
      body = message.message;
      attributes['exception.type'] = message.name;
      if (message.stack) attributes['exception.stacktrace'] = message.stack;
    } else {
      body = typeof message === 'string' ? message : JSON.stringify(message);
    }

    const [severityNumber, severityText] = SEVERITY[level];
    logs.getLogger('nestjs').emit({
      severityNumber,
      severityText,
      body,
      attributes,
    });
  }
}
