import { type RealtimeIntegration, realtimeRoute } from '#/modules/realtime/contracts'
import { IdentityEvents, type SessionRevokedPayload } from '../contracts'

export const identityRealtime = {
  routes: [
    realtimeRoute<SessionRevokedPayload>({
      name: 'realtime.push-session-revoked',
      eventType: IdentityEvents.SessionRevoked,
      map: (p) => ({
        userId: p.userId,
        closeSessionId: p.sessionId,
        event: {
          type: 'session.revoked',
          data: { sessionId: p.sessionId, reason: p.reason, revokedAt: p.revokedAt },
          // A device that was offline when it was signed out must learn it on reconnect, not when its token expires.
          replay: true,
        },
      }),
    }),
  ],
} satisfies RealtimeIntegration
