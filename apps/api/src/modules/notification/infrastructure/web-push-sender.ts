import webpush, { WebPushError } from 'web-push'
import type { PushMessage, PushOutcome, PushTarget, WebPushSender } from '../application/ports'

export interface WebPushSenderOptions {
  /** `mailto:` or https URL the push service can contact about misbehaving senders. */
  subject: string
  publicKey: string
  privateKey: string
  /** How long the push service keeps an undelivered message (browser offline). */
  ttlSeconds?: number
  timeoutMs?: number
}

/** Sends Web Push with VAPID through the `web-push` library (RFC 8030 + RFC 8291 payload encryption). */
export class WebPushLibrarySender implements WebPushSender {
  constructor(private options: WebPushSenderOptions) {}

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        {
          vapidDetails: {
            subject: this.options.subject,
            publicKey: this.options.publicKey,
            privateKey: this.options.privateKey,
          },
          TTL: this.options.ttlSeconds ?? 3600,
          timeout: this.options.timeoutMs ?? 10_000,
          urgency: 'normal',
          // Same topic = the push service collapses a pending duplicate instead of queuing a second one.
          topic: message.id.replace(/-/g, '').slice(0, 32),
        },
      )
      return 'delivered'
    } catch (err) {
      if (!(err instanceof WebPushError)) return 'retry' // network error / timeout
      if (err.statusCode === 404 || err.statusCode === 410) return 'gone'
      if (err.statusCode === 429 || err.statusCode >= 500) return 'retry'
      return 'rejected'
    }
  }
}
