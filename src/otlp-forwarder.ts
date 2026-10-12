import express, { NextFunction, Request, Response } from 'express';

const SIGNALS = new Set(['traces', 'metrics', 'logs']);
const MAX_BODY = '1mb';

const rawParser = express.raw({ type: () => true, limit: MAX_BODY });

function serverAuthorization(): string | undefined {
  const headers = process.env.OTEL_EXPORTER_OTLP_HEADERS ?? '';
  for (const pair of headers.split(',')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const key = pair.slice(0, separator).trim();
    if (key.toLowerCase() !== 'authorization') continue;
    return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return undefined;
}

async function forward(req: Request, res: Response, signal: string) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) {
    res.status(404).end();
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': req.headers['content-type'] ?? 'application/x-protobuf',
  };
  const authorization = serverAuthorization();
  if (authorization) headers.Authorization = authorization;

  const body = new Uint8Array(
    Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
  );

  try {
    const upstream = await fetch(
      `${endpoint.replace(/\/+$/, '')}/v1/${signal}`,
      { method: 'POST', headers, body },
    );
    const payload = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.status(upstream.status).send(payload);
  } catch {
    res.status(502).type('text/plain').send('collector unavailable');
  }
}

export function forwardOtlp(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'POST') {
    next();
    return;
  }

  const signal = req.path.replace(/^\/+/, '');
  if (!SIGNALS.has(signal)) {
    res.status(404).end();
    return;
  }

  rawParser(req, res, (err?: { status?: number; type?: string }) => {
    if (err) {
      const status = err.type === 'entity.too.large' ? 413 : (err.status ?? 400);
      res.status(status).end();
      return;
    }
    void forward(req, res, signal);
  });
}
