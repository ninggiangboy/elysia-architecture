import { Elysia } from 'elysia'
import { UnauthorizedError } from '#/shared/application/errors'
import { requestContext } from '#/shared/infrastructure/request-context'
import { bearerSecurity, errorResponse } from './openapi'

export interface AuthSession {
  userId: string
  sessionId: string
}

/** Minimal shape shared needs — identity's AccessTokenVerifier satisfies it (shared does not import modules). */
export interface TokenVerifier {
  verify(token: string): Promise<AuthSession>
}

/**
 * The `auth: true` macro for routes. Only verifies signature/exp with the public key (stateless, no DB query),
 * so any service that has the JWKS can reuse it.
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
        let session: AuthSession
        try {
          session = await verifier.verify(header.slice(7))
        } catch {
          throw new UnauthorizedError('invalid_token', 'Invalid or expired token')
        }
        const ctx = requestContext.get()
        if (ctx) ctx.userId = session.userId
        return { auth: session }
      },
    },
  })
