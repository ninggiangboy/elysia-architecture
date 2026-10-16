import { t } from 'elysia'

/** Matches `body()` in error-handler.plugin.ts — every error has this shape. */
const errorShape = {
  error: t.Object({
    code: t.String({
      description: 'Stable error code, for clients to handle',
      examples: ['not_found'],
    }),
    message: t.String({ description: 'Human-readable message' }),
    requestId: t.Optional(
      t.String({ description: 'Same as the x-request-id header, used to look up logs' }),
    ),
    details: t.Optional(
      t.Unknown({ description: 'Only on validation_error: a list of { path, message }' }),
    ),
  }),
}

const ERROR_DESCRIPTIONS = {
  400: 'Invalid data or business rule violation',
  401: 'Missing or invalid credentials',
  403: 'Not allowed (for example a recent confirmation is required)',
  404: 'Resource not found',
  409: 'Conflicts with the current state',
  429: 'Rate limit exceeded',
} as const

type ErrorStatus = keyof typeof ERROR_DESCRIPTIONS

/**
 * Declares the error responses of a route. `codes` lists the possible `error.code` values to show in the docs.
 * Note: errors returned by onError are not re-validated against this schema, so it only serves docs and client typing.
 */
export const errorResponse = (status: ErrorStatus, ...codes: string[]) =>
  t.Object(errorShape, {
    description: codes.length
      ? `${ERROR_DESCRIPTIONS[status]}. Error codes: ${codes.map((c) => `\`${c}\``).join(', ')}`
      : ERROR_DESCRIPTIONS[status],
  })

/** Schema validation errors (400) occur on every route that takes input, so they are bundled in and a route declares only its own. */
export const validationError = (...codes: string[]) =>
  errorResponse(400, 'validation_error', ...codes)

export const BEARER_SCHEME = 'bearerAuth'

export const bearerSecurity = [{ [BEARER_SCHEME]: [] }]

export const openapiDocumentation = {
  info: {
    title: 'Elysia Architecture API',
    version: '0.1.0',
    description:
      'Modular monolith backend. Sign in with a magic link; the access token (JWT) is sent via `Authorization: Bearer`, ' +
      'and the refresh token lives in the HttpOnly cookie `refresh_token`.\n\n' +
      'Every error has the shape `{ "error": { "code", "message", "requestId", "details?" } }`.',
  },
  tags: [
    { name: 'health', description: 'Service health checks' },
    {
      name: 'auth',
      description: 'Passwordless sign-in (magic link, passkey, Google/GitHub), sessions and JWKS',
    },
    {
      name: 'account',
      description:
        "Operations on the current user's account. Sensitive ones answer `403 step_up_required` until the user confirms again (`/account/step-up/*`).",
    },
    { name: 'profile', description: 'Profile and avatar of the current user' },
    {
      name: 'privacy',
      description:
        'Export a copy of your data and delete your account. Both need a recent confirmation (`403 step_up_required`); deleting waits out a grace period in which it can be cancelled.',
    },
    {
      name: 'notifications',
      description: "The current user's in-app notifications (also pushed live over SSE)",
    },
  ],
  components: {
    securitySchemes: {
      [BEARER_SCHEME]: {
        type: 'http' as const,
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token obtained from `POST /auth/magic-link/verify` or `POST /auth/refresh`',
      },
    },
  },
}
