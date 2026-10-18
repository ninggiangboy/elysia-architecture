import { DomainError } from '@kit/core'

export const MAX_ENDPOINT_LENGTH = 2048
export const MAX_KEY_LENGTH = 256
/** A user rarely has more than a few browsers; the cap bounds the fan-out of every notification. */
export const MAX_SUBSCRIPTIONS_PER_USER = 10

export class InvalidPushSubscriptionError extends DomainError {
  constructor(message: string) {
    super('invalid_push_subscription', message, 'validation')
  }
}

export interface PushSubscriptionProps {
  id: string
  userId: string
  /** The login session that registered it. Revoking the session (logout, "sign out that device") drops the subscription. */
  sessionId: string
  /** The push service URL for ONE browser profile. Unique across users: it is also the subscription's identity. */
  endpoint: string
  /** Client public key (base64url) the payload is encrypted to. */
  p256dh: string
  /** Client auth secret (base64url). */
  auth: string
  userAgent: string | null
  createdAt: Date
}

/** The server POSTs to `endpoint`, so it must be a public https URL — never an address inside our network. */
function assertPublicHttpsUrl(endpoint: string) {
  if (endpoint.length > MAX_ENDPOINT_LENGTH)
    throw new InvalidPushSubscriptionError('Endpoint is too long')
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new InvalidPushSubscriptionError('Endpoint must be a valid URL')
  }
  const host = url.hostname
  const isIpLiteral = /^[\d.]+$/.test(host) || host.includes(':')
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new InvalidPushSubscriptionError('Endpoint must be an https URL')
  if (isIpLiteral || !host.includes('.') || host.endsWith('.local') || host.endsWith('.internal'))
    throw new InvalidPushSubscriptionError('Endpoint must point to a public push service')
}

/** One browser (or device) of a user that agreed to receive Web Push. */
export class PushSubscription {
  private constructor(readonly props: PushSubscriptionProps) {}

  static create(input: PushSubscriptionProps): PushSubscription {
    const endpoint = input.endpoint.trim()
    assertPublicHttpsUrl(endpoint)
    const b64url = /^[A-Za-z0-9_-]+={0,2}$/
    for (const key of [input.p256dh, input.auth])
      if (!key || key.length > MAX_KEY_LENGTH || !b64url.test(key))
        throw new InvalidPushSubscriptionError('Subscription keys are invalid')
    return new PushSubscription({ ...input, endpoint })
  }

  static restore(props: PushSubscriptionProps): PushSubscription {
    return new PushSubscription(props)
  }

  get id() {
    return this.props.id
  }
  get endpoint() {
    return this.props.endpoint
  }
}
