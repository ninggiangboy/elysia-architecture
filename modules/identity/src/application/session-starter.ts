import type { Clock } from '@kit/core'
import type { OutboxWriter } from '@kit/messaging'
import { sessionStarted } from './session-events'
import type { SessionIssuer, SessionMeta, SessionTokens } from './session-issuer'

/** Starts a login session after the user proved who they are, and records `session_started`. Call inside the UnitOfWork. */
export class SessionStarter {
  constructor(
    private sessions: SessionIssuer,
    private outbox: OutboxWriter,
    private clock: Clock,
  ) {}

  async start(params: {
    userId: string
    meta: SessionMeta
    /** `passkey`, `password`, `oauth:google`… */
    method: string
    /** `totp` or `recovery_code` when a second factor was asked for. */
    secondFactor?: string
    newUser?: boolean
  }): Promise<SessionTokens> {
    const session = await this.sessions.issue({
      userId: params.userId,
      fresh: true,
      meta: params.meta,
    })
    await this.outbox.add([
      sessionStarted(
        {
          userId: params.userId,
          sessionId: session.sessionId,
          ip: params.meta.ip,
          userAgent: params.meta.userAgent,
          newUser: params.newUser ?? false,
          method: params.method,
          ...(params.secondFactor && { secondFactor: params.secondFactor }),
        },
        this.clock.now(),
      ),
    ])
    return session
  }
}
