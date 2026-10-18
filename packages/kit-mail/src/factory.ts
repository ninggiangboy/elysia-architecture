import type { Log } from '@kit/core'
import type { MailConfig } from './config'
import { ConsoleMailer } from './console-mailer'
import type { Mailer } from './ports'
import { SmtpMailer } from './smtp-mailer'

/** The mailer the configuration asks for (`MAIL_DRIVER`). */
export function createMailer(config: MailConfig, log: Log): Mailer {
  if (config.MAIL_DRIVER === 'console')
    return new ConsoleMailer(log, { printLinks: config.MAIL_CONSOLE_PRINT_LINKS })
  return new SmtpMailer(
    {
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      requireTls: config.SMTP_REQUIRE_TLS,
      user: config.SMTP_USER,
      password: config.SMTP_PASSWORD,
    },
    config.MAIL_FROM,
  )
}
