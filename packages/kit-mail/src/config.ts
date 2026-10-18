import { bool, defineSlice } from '@kit/config'
import { z } from 'zod'

export const mailConfig = defineSlice({
  title: 'Mail (SMTP: Mailpit in dev) and send throttling',
  notes:
    'Amazon SES SMTP: host email-smtp.<region>.amazonaws.com, port 587, SMTP_REQUIRE_TLS=true. The rate limits are shared across instances (stored in Postgres).',
  example: {
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    MAIL_FROM: '"Elysia App <no-reply@example.test>"',
    MAIL_RATE_PER_SECOND: '10',
  },
  schema: z.object({
    SMTP_HOST: z.string().default('localhost').describe('SMTP server.'),
    SMTP_PORT: z.coerce.number().int().default(1025).describe('SMTP port.'),
    SMTP_USER: z.string().optional().describe('SMTP user, when the server needs auth.'),
    SMTP_PASSWORD: z.string().optional().describe('SMTP password.'),
    SMTP_SECURE: bool('false').describe('TLS from the first byte: true for port 465.'),
    SMTP_REQUIRE_TLS: bool('false').describe('Require STARTTLS: true for port 587.'),
    MAIL_FROM: z
      .string()
      .default('App <no-reply@example.test>')
      .describe('From address of every mail.'),
    MAIL_RATE_PER_SECOND: z.coerce
      .number()
      .positive()
      .default(10)
      .describe(
        'Maximum send rate (mails/second); the provider\'s "max send rate" (SES sandbox: 1).',
      ),
    MAIL_BURST: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Mails that may go out in one burst; defaults to ceil(MAIL_RATE_PER_SECOND).'),
    MAIL_DAILY_QUOTA: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe('Quota per day (UTC); 0 = unlimited. SES: the "24-hour sending quota".'),
  }),
})
