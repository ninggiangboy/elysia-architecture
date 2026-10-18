import { allOrNone, blank, defineSlice, duration, posInt } from '@kit/config'
import { z } from 'zod'

export const notificationConfig = defineSlice({
  title: 'Notifications: Web Push and retention',
  notes:
    'Web Push (VAPID) is off unless all three VAPID values are set; `keys:generate` writes them. Changing the key pair drops every existing browser subscription.',
  schema: z
    .object({
      VAPID_PUBLIC_KEY: blank.describe('Web Push public key (URL-safe base64).'),
      VAPID_PRIVATE_KEY: blank.describe('Web Push private key.'),
      VAPID_SUBJECT: blank.describe('A `mailto:` or `https://` contact for the push services.'),
      PUSH_QUIET_WINDOW_SECONDS: z.coerce
        .number()
        .int()
        .nonnegative()
        .default(30)
        .describe(
          'After a Web Push to a user, notifications in the same window of this length are stored but not pushed; 0 = push all.',
        ),
      NOTIFICATION_RETENTION: duration('90d').describe(
        'In-app notifications older than this are deleted (read or not).',
      ),
      NOTIFICATION_PRUNE_INTERVAL_SECONDS: posInt(3600).describe(
        'How often notifications past the retention are looked for.',
      ),
    })
    .superRefine((env, ctx) => {
      allOrNone(ctx, {
        VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: env.VAPID_SUBJECT,
      })
      if (env.VAPID_SUBJECT && !/^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT))
        ctx.addIssue({
          code: 'custom',
          path: ['VAPID_SUBJECT'],
          message: 'VAPID_SUBJECT must be a mailto: or https:// URL',
        })
    }),
})

export type NotificationConfig = z.infer<typeof notificationConfig.schema>
