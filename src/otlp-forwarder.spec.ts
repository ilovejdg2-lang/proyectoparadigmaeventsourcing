import * as http from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import { forwardOtlp } from './otlp-forwarder';

interface Received {
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

const SERVER_TOKEN = Buffer.from('123456:token-del-servidor').toString(
  'base64',
);

function appWithForwarder() {
  const app = express();
  app.use('/otlp/v1', forwardOtlp);
  return app;
}

function startCollector(): Promise<{
  url: string;
  received: Received[];
  close: () => Promise<void>;
}> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      res.setHeader('Content-Type', 'application/json');
      res.end('{"partialSuccess":{}}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        received,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function closedPortUrl(): Promise<string> {
  const server = http.createServer();
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(`http://127.0.0.1:${port}/otlp`));
    });
  });
}

describe('forwardOtlp', () => {
  const saved = {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
  };

  beforeEach(() => {
    process.env.OTEL_EXPORTER_OTLP_HEADERS = `Authorization=Basic%20${SERVER_TOKEN}`;
  });

  afterAll(() => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = saved.endpoint;
    process.env.OTEL_EXPORTER_OTLP_HEADERS = saved.headers;
  });

  it('responde 404 cuando no hay endpoint configurado', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = '';

    await request(appWithForwarder())
      .post('/otlp/v1/traces')
      .set('Content-Type', 'application/json')
      .send('{}')
      .expect(404);
  });

  it('responde 404 para una señal que no es traces, metrics ni logs', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:1/otlp';

    await request(appWithForwarder())
      .post('/otlp/v1/profiles')
      .send('{}')
      .expect(404);
  });

  it.each(['traces', 'metrics', 'logs'])(
    'reenvía %s con los bytes originales y el Authorization del servidor',
    async (signal) => {
      const collector = await startCollector();
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `${collector.url}/otlp/`;
      const body = Buffer.from([0x0a, 0x00, 0xff, 0x7b, 0x7d]);

      try {
        await request(appWithForwarder())
          .post(`/otlp/v1/${signal}`)
          .set('Content-Type', 'application/x-protobuf')
          .set('Authorization', 'Basic del-navegador')
          .send(body)
          .expect(200)
          .expect('Content-Type', /application\/json/);

        expect(collector.received).toHaveLength(1);
        const [forwarded] = collector.received;
        expect(forwarded.url).toBe(`/otlp/v1/${signal}`);
        expect(forwarded.headers['content-type']).toBe(
          'application/x-protobuf',
        );
        expect(forwarded.headers.authorization).toBe(`Basic ${SERVER_TOKEN}`);
        expect(forwarded.body.equals(body)).toBe(true);
      } finally {
        await collector.close();
      }
    },
  );

  it('no manda Authorization si el servidor no tiene header configurado', async () => {
    const collector = await startCollector();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `${collector.url}/otlp`;
    process.env.OTEL_EXPORTER_OTLP_HEADERS = '';

    try {
      await request(appWithForwarder())
        .post('/otlp/v1/logs')
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Basic del-navegador')
        .send('{"resourceLogs":[]}')
        .expect(200);

      expect(collector.received[0].headers.authorization).toBeUndefined();
    } finally {
      await collector.close();
    }
  });

  it('responde 413 cuando el cuerpo pasa de 1 MiB', async () => {
    const collector = await startCollector();
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `${collector.url}/otlp`;

    try {
      await request(appWithForwarder())
        .post('/otlp/v1/traces')
        .set('Content-Type', 'application/x-protobuf')
        .send(Buffer.alloc(1024 * 1024 + 1))
        .expect(413);

      expect(collector.received).toHaveLength(0);
    } finally {
      await collector.close();
    }
  });

  it('responde 502 "collector unavailable" sin filtrar la credencial', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = await closedPortUrl();

    const res = await request(appWithForwarder())
      .post('/otlp/v1/traces')
      .set('Content-Type', 'application/json')
      .send('{}')
      .expect(502);

    expect(res.text).toBe('collector unavailable');
    expect(res.text).not.toContain(SERVER_TOKEN);
  });
});
