import { http, unwrap } from './api'

/** Browser side of Web Push: service worker registration, permission and the `PushSubscription`. */

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

export type PushState = 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on'

/**
 * The Permissions API is asked first: headless Chromium (and some embedded browsers) report `Notification.permission`
 * as `denied` even where notifications are allowed. Browsers without it (older Safari) throw → fall back.
 */
async function permission(): Promise<'granted' | 'denied' | 'prompt'> {
  try {
    return (await navigator.permissions.query({ name: 'notifications' })).state
  } catch {
    return Notification.permission === 'default' ? 'prompt' : Notification.permission
  }
}

const registration = () =>
  navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready)

const currentSubscription = async () => (await registration()).pushManager.getSubscription()

const toBytes = (base64url: string) => {
  const padded = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

const serverKey = async () =>
  unwrap(await http.api.notifications.push['public-key'].get()).publicKey

const register = async (subscription: PushSubscription) => {
  const { endpoint, keys } = subscription.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth)
    throw new Error('The browser returned an incomplete push subscription')
  unwrap(
    await http.api.notifications.push.subscription.put({
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    }),
  )
}

/** What the toggle should show right now. `unavailable` = the server has no VAPID keys. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  if (!(await serverKey())) return 'unavailable'
  const allowed = await permission()
  if (allowed === 'denied') return 'denied'
  return allowed === 'granted' && (await currentSubscription()) ? 'on' : 'off'
}

/** Asks for permission (must run from a click), subscribes this browser and registers it with the API. */
export async function enablePush(): Promise<PushState> {
  const key = await serverKey()
  if (!pushSupported() || !key) return 'unavailable'
  if ((await Notification.requestPermission()) !== 'granted') return pushState()
  const reg = await registration()
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) }))
  await register(subscription)
  return 'on'
}

/** Removes this browser from the API, then from the push service. */
export async function disablePush(): Promise<PushState> {
  const subscription = pushSupported() ? await currentSubscription() : null
  if (subscription) {
    unwrap(
      await http.api.notifications.push.subscription.delete({ endpoint: subscription.endpoint }),
    )
    await subscription.unsubscribe()
  }
  return pushState()
}

/**
 * Called on every app start while signed in: re-sends an existing subscription so it follows key rotation and ties it
 * to the current login session. Never asks for permission and never creates a subscription.
 */
export async function syncPush() {
  if (!pushSupported() || (await permission()) !== 'granted') return
  const subscription = await currentSubscription()
  if (subscription && (await serverKey())) await register(subscription)
}

/**
 * Sign-out: forget this browser's subscription locally so the next account that signs in here does not inherit it.
 * The server already drops it when the session is revoked, so this is deliberately best effort.
 */
export async function forgetPush() {
  try {
    if (pushSupported()) await (await currentSubscription())?.unsubscribe()
  } catch {}
}
