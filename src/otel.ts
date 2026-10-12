import 'dotenv/config';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
if (endpoint) {
  // Cargar el SDK tarda bastante; si no hay endpoint, ni siquiera se carga.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startOtel } = require('./otel-sdk') as typeof import('./otel-sdk');
  startOtel(endpoint, 'eventsourcing-transaction-api');
}
