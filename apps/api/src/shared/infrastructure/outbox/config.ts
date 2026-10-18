import { z } from 'zod'
import { defineSlice, posInt } from '#/shared/config'

export const outboxConfig = defineSlice({
  title: 'Outbox relay (events between modules)',
  schema: z.object({
    OUTBOX_POLL_INTERVAL_MS: posInt(1000).describe('How often the relay looks for new messages.'),
    OUTBOX_BATCH_SIZE: posInt(200).describe('Messages claimed per relay batch.'),
    OUTBOX_CONCURRENCY: posInt(8).describe(
      'Aggregates processed in parallel per batch; keep below DB_POOL_MAX. Messages of one aggregate stay ordered.',
    ),
    OUTBOX_LEASE_SECONDS: posInt(30).describe(
      'How long a claimed message stays reserved for this relay. Past it another relay may take it, so keep it above the slowest handler (image processing).',
    ),
    OUTBOX_DEFER_BUDGET_HOURS: z.coerce
      .number()
      .positive()
      .default(24)
      .describe(
        'Maximum time a message may be deferred by a rate limit (mail) before it is considered dead.',
      ),
  }),
})
