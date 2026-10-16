import { t } from 'elysia'

/** Khớp với `body()` trong error-handler.plugin.ts — mọi lỗi đều có dạng này. */
const errorShape = {
  error: t.Object({
    code: t.String({
      description: 'Mã lỗi ổn định, dùng để client xử lý',
      examples: ['not_found'],
    }),
    message: t.String({ description: 'Thông điệp dành cho người đọc' }),
    requestId: t.Optional(
      t.String({ description: 'Trùng với header x-request-id, dùng để tra log' }),
    ),
    details: t.Optional(
      t.Unknown({ description: 'Chỉ có ở validation_error: danh sách { path, message }' }),
    ),
  }),
}

const ERROR_DESCRIPTIONS = {
  400: 'Dữ liệu không hợp lệ hoặc vi phạm quy tắc nghiệp vụ',
  401: 'Thiếu hoặc sai thông tin xác thực',
  404: 'Không tìm thấy tài nguyên',
  409: 'Xung đột với trạng thái hiện tại',
  429: 'Vượt giới hạn tần suất',
} as const

type ErrorStatus = keyof typeof ERROR_DESCRIPTIONS

/**
 * Khai báo response lỗi cho một route. `codes` liệt kê các `error.code` có thể gặp để hiện trong docs.
 * Lưu ý: lỗi do onError trả ra không bị validate lại theo schema này, nên nó chỉ phục vụ tài liệu và type cho client.
 */
export const errorResponse = (status: ErrorStatus, ...codes: string[]) =>
  t.Object(errorShape, {
    description: codes.length
      ? `${ERROR_DESCRIPTIONS[status]}. Mã lỗi: ${codes.map((c) => `\`${c}\``).join(', ')}`
      : ERROR_DESCRIPTIONS[status],
  })

/** Lỗi validate schema (400) có mặt ở mọi route nhận input, nên gộp sẵn để route chỉ khai báo phần riêng. */
export const validationError = (...codes: string[]) =>
  errorResponse(400, 'validation_error', ...codes)

export const BEARER_SCHEME = 'bearerAuth'

export const bearerSecurity = [{ [BEARER_SCHEME]: [] }]

export const openapiDocumentation = {
  info: {
    title: 'Elysia Architecture API',
    version: '0.1.0',
    description:
      'Backend modular monolith. Đăng nhập bằng magic link; access token (JWT) gửi qua `Authorization: Bearer`, ' +
      'refresh token nằm trong cookie HttpOnly `refresh_token`.\n\n' +
      'Mọi lỗi có dạng `{ "error": { "code", "message", "requestId", "details?" } }`.',
  },
  tags: [
    { name: 'health', description: 'Kiểm tra tình trạng dịch vụ' },
    { name: 'auth', description: 'Đăng nhập passwordless, phiên và JWKS' },
    { name: 'account', description: 'Thao tác trên tài khoản của người dùng hiện tại' },
    { name: 'profile', description: 'Hồ sơ và ảnh đại diện của người dùng hiện tại' },
  ],
  components: {
    securitySchemes: {
      [BEARER_SCHEME]: {
        type: 'http' as const,
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token lấy từ `POST /auth/magic-link/verify` hoặc `POST /auth/refresh`',
      },
    },
  },
}
