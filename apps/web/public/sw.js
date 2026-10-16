// Service worker: shows Web Push notifications and opens the app when one is clicked.
// Plain JS on purpose — it is served as-is from /sw.js (no build step, no hashed name) so the scope is the whole site.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

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
