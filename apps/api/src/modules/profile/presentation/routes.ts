import { Elysia, t } from 'elysia'
import { ValidationError } from '#/shared/application/errors'
import { authPlugin, type TokenVerifier } from '#/shared/http/auth.plugin'
import type { GetMe } from '../application/use-cases/get-me'
import type { RequestAvatarUpload } from '../application/use-cases/request-avatar-upload'
import type { SetAvatar } from '../application/use-cases/set-avatar'
import type { UpdateProfile } from '../application/use-cases/update-profile'

export interface ProfileRouteDeps {
  verifier: TokenVerifier
  useCases: {
    getMe: GetMe
    updateProfile: UpdateProfile
    requestAvatarUpload: RequestAvatarUpload
    setAvatar: SetAvatar
  }
}

export const profileRoutes = ({ verifier, useCases: uc }: ProfileRouteDeps) =>
  new Elysia({ prefix: '/me', tags: ['profile'] })
    .use(authPlugin(verifier))
    .get('/', ({ auth }) => uc.getMe.execute({ userId: auth.userId }), { auth: true })
    .patch(
      '/profile',
      ({ auth, body, headers }) =>
        uc.updateProfile.execute({
          userId: auth.userId,
          displayName: body.displayName,
          bio: body.bio,
          expectedVersion: parseIfMatch(headers['if-match']),
        }),
      {
        auth: true,
        body: t.Object({
          displayName: t.Optional(t.String({ maxLength: 200 })),
          bio: t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
        }),
        headers: t.Object({ 'if-match': t.Optional(t.String()) }),
      },
    )
    .post(
      '/avatar/upload-url',
      ({ auth, body }) => uc.requestAvatarUpload.execute({ userId: auth.userId, ...body }),
      {
        auth: true,
        body: t.Object({ contentType: t.String(), contentLength: t.Integer() }),
      },
    )
    .put(
      '/avatar',
      ({ auth, body }) => uc.setAvatar.execute({ userId: auth.userId, key: body.key }),
      {
        auth: true,
        body: t.Object({ key: t.String({ minLength: 1, maxLength: 200 }) }),
      },
    )

function parseIfMatch(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value.replace(/^W\//, '').replace(/"/g, ''))
  if (!Number.isInteger(n) || n < 0)
    throw new ValidationError('invalid_if_match', 'Invalid If-Match header')
  return n
}
