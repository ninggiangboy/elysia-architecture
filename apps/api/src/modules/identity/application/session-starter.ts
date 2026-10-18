import type { Clock } from '#/shared/core'
import type { OutboxWriter } from '#/shared/messaging'
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
    /** `passkey`, `oauth:google`… */
    method: string
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
        },
        this.clock.now(),
      ),
    ])
    return session
  }
}
