import { Elysia, t } from 'elysia'
import { ValidationError } from '#/shared/application/errors'
import { authPlugin, type TokenVerifier } from '#/shared/http/auth.plugin'
import { errorResponse, validationError } from '#/shared/http/openapi'
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

const meBody = t.Object(
  {
    id: t.String(),
    email: t.String({ format: 'email' }),
    displayName: t.String(),
    bio: t.Nullable(t.String()),
    avatarUrl: t.Nullable(t.String({ description: 'Presigned GET URL, hết hạn sau 1 giờ' })),
    version: t.Integer({
      description: 'Gửi lại trong `If-Match` khi cập nhật. 0 = chưa có bản ghi profile',
    }),
    createdAt: t.String({ format: 'date-time' }),
  },
  { description: 'Thông tin tài khoản kèm hồ sơ' },
)

export const profileRoutes = ({ verifier, useCases: uc }: ProfileRouteDeps) =>
  new Elysia({ prefix: '/me', tags: ['profile'] })
    .use(authPlugin(verifier))
    .get('/', ({ auth }) => uc.getMe.execute({ userId: auth.userId }), {
      auth: true,
      detail: { summary: 'Lấy thông tin của tôi' },
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
              description: 'Phiên bản hiện có (`version`) để chống ghi đè; sai phiên bản trả 409',
            }),
          ),
        }),
        detail: {
          summary: 'Cập nhật hồ sơ',
          description: 'Chỉ cập nhật các trường được gửi. `bio: null` để xoá bio.',
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
          contentType: t.String({ description: 'image/jpeg, image/png hoặc image/webp' }),
          contentLength: t.Integer({ description: 'Kích thước file (byte), tối đa 2 MB' }),
        }),
        detail: {
          summary: 'Xin URL upload avatar',
          description:
            'Trả presigned URL; client `PUT` file thẳng lên storage rồi gọi `PUT /me/avatar` với `key`.',
        },
        response: {
          200: t.Object(
            {
              uploadUrl: t.String(),
              key: t.String({ description: 'Gửi lại ở `PUT /me/avatar`' }),
              method: t.Literal('PUT'),
              headers: t.Record(t.String(), t.String(), {
                description: 'Header bắt buộc khi upload',
              }),
              expiresIn: t.Number({ description: 'Thời gian sống của URL (giây)' }),
            },
            { description: 'Thông tin upload' },
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
          key: t.String({ minLength: 1, maxLength: 200, description: '`key` nhận từ upload-url' }),
        }),
        detail: {
          summary: 'Đặt avatar',
          description: 'Xác nhận file đã upload và gán làm avatar; avatar cũ được xoá bất đồng bộ.',
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

function parseIfMatch(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value.replace(/^W\//, '').replace(/"/g, ''))
  if (!Number.isInteger(n) || n < 0)
    throw new ValidationError('invalid_if_match', 'Invalid If-Match header')
  return n
}
