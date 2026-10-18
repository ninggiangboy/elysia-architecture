import { Elysia } from 'elysia'
import { requestContext } from '#/shared/context'
import { UnauthorizedError } from '#/shared/core'
import { bearerSecurity, errorResponse } from '#/shared/http'

export interface AuthSession {
  userId: string
  sessionId: string
  /** Epoch seconds of the user's last strong authentication; absent after a plain refresh. See `StepUpPolicy`. */
  authTime?: number
}

/** Minimal shape shared needs — identity's AccessTokenVerifier satisfies it (shared does not import modules). */
export interface TokenVerifier {
  verify(token: string): Promise<AuthSession>
}

async function authenticate(verifier: TokenVerifier, header: string): Promise<AuthSession> {
  let session: AuthSession
  try {
    session = await verifier.verify(header.slice(7))
  } catch {
    throw new UnauthorizedError('invalid_token', 'Invalid or expired token')
  }
  const ctx = requestContext.get()
  if (ctx) ctx.userId = session.userId
  return session
}

/**
 * The `auth: true` macro for routes. Only verifies signature/exp with the public key (stateless, no DB query),
 * so any service that has the JWKS can reuse it. `authOptional: true` is for routes that serve both signed-in and
 * anonymous callers: `maybeAuth` is the session, or null when no token was sent (a bad token is still a 401).
 */
export const authPlugin = (verifier: TokenVerifier) =>
  new Elysia({ name: 'auth' }).macro({
    auth: {
      detail: { security: bearerSecurity },
      response: { 401: errorResponse(401, 'missing_token', 'invalid_token') },
      // Read from `request`, not `headers`: a route that declares a headers schema has undeclared headers stripped.
      async resolve({ request }) {
        const header = request.headers.get('authorization')
        if (!header?.startsWith('Bearer ')) {
          throw new UnauthorizedError('missing_token', 'Missing bearer token')
        }
        return { auth: await authenticate(verifier, header) }
      },
    },
    authOptional: {
      detail: { security: bearerSecurity },
      response: { 401: errorResponse(401, 'invalid_token') },
      async resolve({ request }) {
        const header = request.headers.get('authorization')
        if (!header?.startsWith('Bearer ')) return { maybeAuth: null as AuthSession | null }
        return { maybeAuth: (await authenticate(verifier, header)) as AuthSession | null }
      },
    },
  })
