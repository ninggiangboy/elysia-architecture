import { authPlugin, type TokenVerifier } from '@kit/auth'
import { errorResponse } from '@kit/http'
import { Elysia, t } from 'elysia'
import type { Ping } from '../application/use-cases/ping'

export interface __Name__RouteDeps {
  verifier: TokenVerifier
  useCases: { ping: Ping }
}

export const __name__Routes = ({ verifier, useCases: uc }: __Name__RouteDeps) =>
  new Elysia({ prefix: '/__name__', tags: ['__name__'] })
    .use(authPlugin(verifier))
    .get('/ping', ({ auth }) => uc.ping.execute({ userId: auth.userId }), {
      auth: true,
      detail: { summary: 'Is the module alive, for the signed-in user' },
      response: {
        200: t.Object({
          module: t.String(),
          reply: t.String(),
          userId: t.String(),
          at: t.String({ format: 'date-time' }),
        }),
        401: errorResponse(401, 'unauthorized'),
      },
    })
