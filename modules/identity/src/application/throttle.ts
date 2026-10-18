import { TooManyRequestsError } from '@kit/core'
import type { WindowCount } from '../domain/repositories'

/** 429 with `Retry-After` set to when the oldest counted request leaves the window. */
export function assertUnderLimit(params: {
  seen: WindowCount
  max: number
  windowMs: number
  now: Date
  code: string
  message?: string
}): void {
  if (params.seen.count < params.max) return
  const freesAt = (params.seen.oldest ?? params.now).getTime() + params.windowMs
  throw new TooManyRequestsError(
    params.code,
    params.message ?? 'Too many attempts, try again later',
    Math.max(1, Math.ceil((freesAt - params.now.getTime()) / 1000)),
  )
}
