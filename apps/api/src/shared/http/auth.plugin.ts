import { Elysia } from 'elysia'
import { UnauthorizedError } from '#/shared/application/errors'
import { requestContext } from '#/shared/infrastructure/request-context'
import { bearerSecurity, errorResponse } from './openapi'

export interface AuthSession {
  userId: string
  sessionId: string
}

/** Cấu trúc tối thiểu shared cần — AccessTokenVerifier của identity thoả mãn nó (shared không import module). */
export interface TokenVerifier {
  verify(token: string): Promise<AuthSession>
}

/**
 * Macro `auth: true` cho route. Chỉ verify chữ ký/exp bằng public key (stateless, không truy vấn DB),
 * nên bất kỳ service nào có JWKS đều dùng lại được.
 */
export const authPlugin = (verifier: TokenVerifier) =>
  new Elysia({ name: 'auth' }).macro({
    auth: {
      detail: { security: bearerSecurity },
      response: { 401: errorResponse(401, 'missing_token', 'invalid_token') },
      // Đọc từ `request` chứ không từ `headers`: route khai báo schema headers sẽ bị lược bỏ các header không khai báo.
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
