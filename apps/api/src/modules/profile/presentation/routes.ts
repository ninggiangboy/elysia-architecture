import { authPlugin, type TokenVerifier } from '@kit/auth'
import { ValidationError } from '@kit/core'
import { errorResponse, validationError } from '@kit/http'
import { Elysia, t } from 'elysia'
import type { GetMe } from '../application/use-cases/get-me'
import type { RequestAvatarUpload } from '../application/use-cases/request-avatar-upload'
import type { RequestCoverUpload } from '../application/use-cases/request-cover-upload'
import type { SetAvatar } from '../application/use-cases/set-avatar'
import type { SetCover } from '../application/use-cases/set-cover'
import type { UpdateProfile } from '../application/use-cases/update-profile'

export interface ProfileRouteDeps {
  verifier: TokenVerifier
  useCases: {
    getMe: GetMe
    updateProfile: UpdateProfile
    requestAvatarUpload: RequestAvatarUpload
    setAvatar: SetAvatar
    requestCoverUpload: RequestCoverUpload
    setCover: SetCover
  }
}

const meBody = t.Object(
  {
    id: t.String(),
    email: t.String({ format: 'email' }),
    locale: t.String({ description: 'Language the account is addressed in: `en` or `vi`' }),
    displayName: t.String(),
    bio: t.Nullable(t.String()),
    avatarUrl: t.Nullable(t.String({ description: 'Presigned GET URL, expires after 1 hour' })),
    coverUrl: t.Nullable(t.String({ description: 'Presigned GET URL, expires after 1 hour' })),
    version: t.Integer({
      description: 'Send back in `If-Match` when updating. 0 = no profile record yet',
    }),
    createdAt: t.String({ format: 'date-time' }),
  },
  { description: 'Account information with profile' },
)

export const profileRoutes = ({ verifier, useCases: uc }: ProfileRouteDeps) =>
  new Elysia({ prefix: '/me', tags: ['profile'] })
    .use(authPlugin(verifier))
    .get('/', ({ auth }) => uc.getMe.execute({ userId: auth.userId }), {
      auth: true,
      detail: { summary: 'Get my account' },
      response: { 200: meBody, 404: errorResponse(404, 'user_not_found') },
    })
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
        headers: t.Object({
          'if-match': t.Optional(
            t.String({
              description:
                'Current version (`version`) to prevent overwrites; a wrong version returns 409',
            }),
          ),
        }),
        detail: {
          summary: 'Update profile',
          description: 'Updates only the fields sent. `bio: null` clears the bio.',
        },
        response: {
          200: meBody,
          400: validationError('invalid_if_match', 'invalid_display_name', 'invalid_bio'),
          404: errorResponse(404, 'user_not_found'),
          409: errorResponse(409, 'version_conflict', 'profile_conflict'),
        },
      },
    )
    .post(
      '/avatar/upload-url',
      ({ auth, body }) => uc.requestAvatarUpload.execute({ userId: auth.userId, ...body }),
      {
        auth: true,
        body: t.Object({
          contentType: t.String({ description: 'image/jpeg, image/png or image/webp' }),
          contentLength: t.Integer({ description: 'File size (bytes), max 2 MB' }),
        }),
        detail: {
          summary: 'Xin URL upload avatar',
          description:
            'Returns a presigned URL; the client `PUT`s the file straight to storage, then calls `PUT /me/avatar` with the `key`.',
        },
        response: {
          200: t.Object(
            {
              uploadUrl: t.String(),
              key: t.String({ description: 'Send back in `PUT /me/avatar`' }),
              method: t.Literal('PUT'),
              headers: t.Record(t.String(), t.String(), {
                description: 'Headers required for the upload',
              }),
              expiresIn: t.Number({ description: 'URL lifetime (seconds)' }),
            },
            { description: 'Upload information' },
          ),
          400: validationError('unsupported_avatar_type', 'avatar_too_large'),
        },
      },
    )
    .put(
      '/avatar',
      ({ auth, body }) => uc.setAvatar.execute({ userId: auth.userId, key: body.key }),
      {
        auth: true,
        body: t.Object({
          key: t.String({
            minLength: 1,
            maxLength: 200,
            description: '`key` received from upload-url',
          }),
        }),
        detail: {
          summary: 'Set avatar',
          description:
            'Confirms the file was uploaded and sets it as the avatar; the old avatar is deleted asynchronously.',
        },
        response: {
          200: meBody,
          400: validationError(
            'invalid_avatar_key',
            'avatar_not_uploaded',
            'unsupported_avatar_type',
            'avatar_too_large',
          ),
          404: errorResponse(404, 'user_not_found'),
        },
      },
    )
    .post(
      '/cover/upload-url',
      ({ auth, body }) => uc.requestCoverUpload.execute({ userId: auth.userId, ...body }),
      {
        auth: true,
        body: t.Object({
          contentType: t.String({ description: 'image/jpeg, image/png or image/webp' }),
          contentLength: t.Integer({ description: 'File size (bytes), max 5 MB' }),
        }),
        detail: {
          summary: 'Xin URL upload ảnh bìa',
          description:
            'Returns a presigned URL; the client `PUT`s the file straight to storage, then calls `PUT /me/cover` with the `key`.',
        },
        response: {
          200: t.Object(
            {
              uploadUrl: t.String(),
              key: t.String({ description: 'Send back in `PUT /me/cover`' }),
              method: t.Literal('PUT'),
              headers: t.Record(t.String(), t.String(), {
                description: 'Headers required for the upload',
              }),
              expiresIn: t.Number({ description: 'URL lifetime (seconds)' }),
            },
            { description: 'Upload information' },
          ),
          400: validationError('unsupported_cover_type', 'cover_too_large'),
        },
      },
    )
    .put(
      '/cover',
      ({ auth, body }) => uc.setCover.execute({ userId: auth.userId, key: body.key }),
      {
        auth: true,
        body: t.Object({
          key: t.String({
            minLength: 1,
            maxLength: 200,
            description: '`key` received from cover/upload-url',
          }),
        }),
        detail: {
          summary: 'Set cover image',
          description:
            'Confirms the file was uploaded and sets it as the cover image; the old cover is deleted asynchronously.',
        },
        response: {
          200: meBody,
          400: validationError('invalid_cover_key', 'cover_not_uploaded', 'invalid_cover'),
          404: errorResponse(404, 'user_not_found'),
        },
      },
    )

function parseIfMatch(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value.replace(/^W\//, '').replace(/"/g, ''))
  if (!Number.isInteger(n) || n < 0)
    throw new ValidationError('invalid_if_match', 'Invalid If-Match header')
  return n
}
