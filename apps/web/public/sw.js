// Service worker: shows Web Push notifications, opens the app when one is clicked, and shows /offline.html when a page is opened with no connection.
// Plain JS on purpose — it is served as-is from /sw.js (no build step, no hashed name) so the scope is the whole site.

const OFFLINE_CACHE = 'offline-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) =>
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      // `reload`: take the page from the network, not from an HTTP cache that may hold an older copy.
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  ),
)
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== OFFLINE_CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  ),
)

// Only page loads, and only when the network itself fails (fetch rejects). A response — even a 502 or 503 from a deploy —
// is passed through untouched: that is the app's maintenance dialog's business, not "offline".
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.mode !== 'navigate') return
  event.respondWith(
    fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
  )
})

self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch {
    // A payload we cannot read still has to produce a notification (browsers require one per push).
  }
  const title =
    typeof message.title === 'string' && message.title ? message.title : 'New notification'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof message.body === 'string' ? message.body : '',
      // Same tag = a redelivered push replaces the notification instead of stacking a duplicate.
      tag: typeof message.id === 'string' ? message.id : undefined,
      // A folded notification keeps its tag: replace the old one, but still alert for the new event.
      renotify: typeof message.id === 'string',
      data: { link: typeof message.link === 'string' ? message.link : '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Only ever navigate inside this origin, whatever the payload says.
  let target = new URL('/', self.location.origin)
  try {
    const url = new URL(event.notification.data?.link ?? '/', self.location.origin)
    if (url.origin === self.location.origin) target = url
  } catch {}
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (open) {
        await open.focus()
        if ('navigate' in open) await open.navigate(target.href)
      } else {
        await self.clients.openWindow(target.href)
      }
    })(),
  )
})
