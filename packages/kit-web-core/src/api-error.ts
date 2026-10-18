/** What the API answers with on failure (every error has this shape). */
export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string; details?: unknown }
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/**
 * Turns an Eden Treaty result into its data or a thrown `ApiError`. `describe` picks the text of the error: the app's
 * translation of the error `code`, falling back to the server's own message.
 */
export function createUnwrap(
  describe: (code: string | undefined, serverMessage: string | undefined) => string,
) {
  return function unwrap<R extends { data: unknown; error: unknown }>(
    res: R,
  ): NonNullable<R['data']> {
    if (res.error) {
      const { status, value } = res.error as { status: number; value: ApiErrorBody | undefined }
      throw new ApiError(
        value?.error?.code ?? 'unknown_error',
        describe(value?.error?.code, value?.error?.message),
        status,
      )
    }
    return res.data as NonNullable<R['data']>
  }
}
