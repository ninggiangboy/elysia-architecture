import type { Log } from '@kit/core'
import type { Mailer } from './ports'

/**
 * Sends nothing: writes each mail to the log. For running an app without a mail server (a starter, a demo, a laptop on a
 * plane). `printLinks` adds the links found in the text, which is how a magic-link sign-in works without a mailbox.
 */
export class ConsoleMailer implements Mailer {
  constructor(
    private log: Log,
    private options: { printLinks?: boolean } = {},
  ) {}

  async send(mail: { to: string; subject: string; text: string; html: string }): Promise<void> {
    const fields: Record<string, unknown> = { to: mail.to, subject: mail.subject }
    if (this.options.printLinks) fields.links = mail.text.match(/https?:\/\/\S+/g) ?? []
    this.log.info(fields, 'mail not sent (MAIL_DRIVER=console)')
  }
}
