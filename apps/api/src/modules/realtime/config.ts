import { z } from 'zod'
import { defineSlice, posInt } from '#/shared/config'

export const realtimeConfig = defineSlice({
  title: 'Realtime (SSE)',
  schema: z.object({
    REALTIME_REPLAY_WINDOW_SECONDS: posInt(900).describe(
      'How long a disconnected SSE client can still replay the events that opted in (`session.revoked`) via `Last-Event-ID`. Keep it at least ACCESS_TOKEN_TTL: after that a device that missed its sign-out can no longer refresh its session anyway.',
    ),
  }),
})

export type RealtimeConfig = z.infer<typeof realtimeConfig.schema>
