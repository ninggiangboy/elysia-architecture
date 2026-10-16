import nodemailer from 'nodemailer'
import { MailPermanentError, MailRateLimitedError } from '#/shared/application/mail-errors'
import type { Mailer } from '#/shared/application/ports'
import { classifySmtpError } from './classify-smtp-error'

export interface SmtpOptions {
  host: string
  port: number
  /** true = TLS ngay từ đầu (cổng 465). Cổng 587 giữ false và bật `requireTls` (STARTTLS). */
  secure?: boolean
  requireTls?: boolean
  user?: string
  password?: string
}

/**
 * Gửi qua SMTP. Dùng được cho Mailpit (dev) và Amazon SES qua SMTP interface
 * (host `email-smtp.<region>.amazonaws.com`, cổng 587, `requireTls`, user/password là SMTP credentials của SES).
 */
export class SmtpMailer implements Mailer {
  private transport: nodemailer.Transporter

  constructor(
    options: SmtpOptions,
    private from: string,
  ) {
    this.transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? false,
      requireTLS: options.requireTls ?? false,
      auth: options.user ? { user: options.user, pass: options.password ?? '' } : undefined,
      // Luôn có timeout: handler treo sẽ chặn cả batch của outbox relay.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  }

  async send(mail: { to: string; subject: string; text: string; html: string }): Promise<void> {
    try {
      await this.transport.sendMail({ from: this.from, ...mail })
    } catch (err) {
      const failure = classifySmtpError(err)
      const message = err instanceof Error ? err.message : String(err)
      if (failure.kind === 'rate_limited')
        throw new MailRateLimitedError(message, failure.retryAfterMs)
      if (failure.kind === 'permanent') throw new MailPermanentError(message)
      throw err
    }
  }
}
