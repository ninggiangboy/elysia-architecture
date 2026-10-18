/** The shape of every error the API answers with (see the error handler). */
export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string; details?: unknown }
}
