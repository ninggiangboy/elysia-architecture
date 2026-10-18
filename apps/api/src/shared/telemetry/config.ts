import { blank, defineSlice } from '@kit/config'
import { z } from 'zod'

export const telemetryConfig = defineSlice({
  title:
    'Tracing (OpenTelemetry → Jaeger UI at http://localhost:16686; `bun run infra:up` starts it)',
  notes:
    'Spans are exported when the endpoint is set: HTTP request → outbox relay → event handlers, linked through the message headers.',
  example: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' },
  schema: z.object({
    OTEL_EXPORTER_OTLP_ENDPOINT: blank
      .pipe(z.url().optional())
      .describe(
        'OTLP/HTTP endpoint of a collector (Jaeger: http://localhost:4318). Unset = tracing off.',
      ),
    OTEL_SERVICE_NAME: z
      .string()
      .default('elysia-architecture-api')
      .describe('Service name on the spans.'),
  }),
})
