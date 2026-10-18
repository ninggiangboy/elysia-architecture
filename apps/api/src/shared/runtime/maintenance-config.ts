import { defineSlice, posInt } from '@kit/config'
import { z } from 'zod'

export const maintenanceConfig = defineSlice({
  title: 'Maintenance mode (`bun run deploy` sets it)',
  schema: z.object({
    MAINTENANCE_POLL_INTERVAL_MS: posInt(1000).describe(
      'How often each process reads the maintenance flag; it takes this long to take effect.',
    ),
  }),
})
