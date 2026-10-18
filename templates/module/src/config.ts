import { defineSlice } from '@kit/config'
import { z } from 'zod'

export const __name__Config = defineSlice({
  title: '__Name__',
  schema: z.object({
    __NAME___REPLY: z
      .string()
      .min(1)
      .default('pong')
      .describe('What `GET /api/__name__/ping` answers.'),
  }),
})

export type __Name__Config = z.infer<typeof __name__Config.schema>
