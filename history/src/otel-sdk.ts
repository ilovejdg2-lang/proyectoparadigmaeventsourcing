import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';

function deploymentEnvironment(): string {
  const fromAttributes = (process.env.OTEL_RESOURCE_ATTRIBUTES ?? '')
    .split(',')
    .map((pair) => pair.split('='))
    .find(([key]) => key?.trim() === 'deployment.environment')?.[1]
    ?.trim();
  if (fromAttributes) return fromAttributes;
  return process.env.NODE_ENV === 'production' ? 'production' : 'local';
}

export function startOtel(endpoint: string, defaultServiceName: string) {
  const collectorHost = new URL(endpoint).hostname;
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME || defaultServiceName,
      'deployment.environment': deploymentEnvironment(),
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
    logRecordProcessors: [
      new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() }),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) =>
            (req.url ?? '').startsWith('/otlp'),
          ignoreOutgoingRequestHook: (req) => req.hostname === collectorHost,
        },
        '@opentelemetry/instrumentation-undici': {
          ignoreRequestHook: (req) =>
            new URL(req.origin).hostname === collectorHost,
        },
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();
  process.on('SIGTERM', () => {
    void sdk.shutdown().finally(() => process.exit(0));
  });
}
