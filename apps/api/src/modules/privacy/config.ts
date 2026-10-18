import { defineSlice, duration, posInt } from '@kit/config'
import { z } from 'zod'

export const privacyConfig = defineSlice({
  title: 'Privacy: data export and account deletion',
  schema: z
    .object({
      PRIVACY_DELETION_GRACE_PERIOD: duration('14d').describe(
        'Account deletion: time between asking and the erasure starting. The user can cancel in between.',
      ),
      PRIVACY_EXPORT_TTL: duration('7d').describe(
        'How long a finished data export can be downloaded. At most 7d: the longest an S3 presigned link can live.',
      ),
      PRIVACY_JOBS_INTERVAL_SECONDS: posInt(30).describe(
        'How often the jobs look for deletions whose grace period ended, silent modules and expired exports.',
      ),
      PRIVACY_STALL_AFTER: duration('10m').describe(
        'A data export or an erasure with no progress for this long is re-sent to the modules that have not answered.',
      ),
      PRIVACY_MAX_NUDGES: z.coerce
        .number()
        .int()
        .nonnegative()
        .default(5)
        .describe(
          'Re-sends before giving up: an export then fails, an erasure waits for an operator (`privacy:resume`).',
        ),
    })
    .superRefine((env, ctx) => {
      if (env.PRIVACY_EXPORT_TTL > 7 * 86400)
        ctx.addIssue({
          code: 'custom',
          path: ['PRIVACY_EXPORT_TTL'],
          message: 'must be at most 7d (the longest an S3 presigned link can live)',
        })
    }),
})

export type PrivacyConfig = z.infer<typeof privacyConfig.schema>
