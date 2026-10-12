// Prueba de humo de Grafana: manda una traza y un log mínimos por el reenvío
// de la Transaction API y por el proxy de Vite, y explica cada respuesta.
// No imprime el token ni los headers.
//
//   node scripts/probar-otlp.mjs
//   API_URL=http://localhost:3010 FRONT_URL=http://localhost:5174 node scripts/probar-otlp.mjs

import { randomBytes } from 'node:crypto';

const API_URL = (process.env.API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const FRONT_URL = (process.env.FRONT_URL || 'http://localhost:5173').replace(/\/+$/, '');

const MEANING = {
  200: 'Grafana aceptó el envío (puede tardar ~1 minuto en verse).',
  401: 'Grafana rechazó el token: revisa que esté completo, sin comillas y con Basic%20; luego reinicia.',
  404: 'No hay endpoint/token cargado en ese proceso, o el proxy /otlp no se registró: completa el .env y reinicia.',
  413: 'El cuerpo es demasiado grande: la ruta está cayendo en otro handler.',
  502: 'El reenvío funciona pero no alcanzó a Grafana (red o endpoint mal escrito).',
};

function resource(serviceName) {
  return {
    attributes: [
      { key: 'service.name', value: { stringValue: serviceName } },
      { key: 'deployment.environment', value: { stringValue: 'local' } },
    ],
  };
}

function tracePayload(serviceName) {
  const now = BigInt(Date.now()) * 1_000_000n;
  return {
    resourceSpans: [
      {
        resource: resource(serviceName),
        scopeSpans: [
          {
            scope: { name: 'probar-otlp' },
            spans: [
              {
                traceId: randomBytes(16).toString('hex'),
                spanId: randomBytes(8).toString('hex'),
                name: 'prueba de humo OTLP',
                kind: 1,
                startTimeUnixNano: String(now - 5_000_000n),
                endTimeUnixNano: String(now),
              },
            ],
          },
        ],
      },
    ],
  };
}

function logPayload(serviceName) {
  return {
    resourceLogs: [
      {
        resource: resource(serviceName),
        scopeLogs: [
          {
            scope: { name: 'probar-otlp' },
            logRecords: [
              {
                timeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
                severityNumber: 9,
                severityText: 'INFO',
                body: { stringValue: 'Prueba de humo OTLP' },
              },
            ],
          },
        ],
      },
    ],
  };
}

async function probe(label, url, payload) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const text = res.status === 502 ? ` "${await res.text()}"` : '';
    const meaning = MEANING[res.status] ?? 'Respuesta inesperada.';
    console.log(`  ${res.status === 200 ? 'OK ' : 'MAL'} ${label} -> ${res.status}${text}  ${meaning}`);
    return res.status === 200;
  } catch (error) {
    console.log(`  MAL ${label} -> sin respuesta (${error.cause?.code ?? error.name}). ¿Está corriendo y en ese puerto?`);
    return false;
  }
}

console.log(`Transaction API: ${API_URL}`);
const api = [
  await probe('traza por la API', `${API_URL}/otlp/v1/traces`, tracePayload('eventsourcing-transaction-api')),
  await probe('log por la API', `${API_URL}/otlp/v1/logs`, logPayload('eventsourcing-transaction-api')),
];

console.log(`Frontend (proxy de Vite): ${FRONT_URL}`);
const front = [
  await probe('traza por Vite', `${FRONT_URL}/otlp/v1/traces`, tracePayload('eventsourcing-fe')),
  await probe('log por Vite', `${FRONT_URL}/otlp/v1/logs`, logPayload('eventsourcing-fe')),
];

const ok = [...api, ...front].every(Boolean);
console.log('');
console.log(
  ok
    ? 'Todo llegó a Grafana. Búscalo en Explore → Tempo / Loki con service_name eventsourcing-*.'
    : 'Algo no llegó. Revisa el mensaje de cada línea; después de cambiar el .env hay que reiniciar.',
);
process.exitCode = ok ? 0 : 1;
