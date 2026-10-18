import type { IntegrationEventHandler } from '@kit/messaging'
import type { AppModule } from '@kit/runtime'
import { IdentityEvents, type MagicLinkRequestedPayload } from '@mod/identity/contracts'

/**
 * A stand-in for the notification module: prints the sign-in link instead of mailing it. It is an app-level handler on a
 * module's contract event (the "reacting to events" extension point); install `@mod/notification` to send real mail.
 */
export function mailbox(
  webAppUrl: string,
  log: { info(fields: object, message: string): void },
): AppModule {
  const handler: IntegrationEventHandler = {
    name: 'starter.print-magic-link',
    eventType: IdentityEvents.MagicLinkRequested,
    async handle(message) {
      const p = message.payload as unknown as MagicLinkRequestedPayload
      const url = `${webAppUrl.replace(/\/$/, '')}/auth/callback?token=${encodeURIComponent(p.token)}`
      log.info({ to: p.email, url }, 'sign-in link (the starter prints it instead of mailing it)')
    },
  }
  return { name: 'mailbox', handlers: [handler] }
}
