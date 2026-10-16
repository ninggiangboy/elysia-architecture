import { createFileRoute, redirect } from '@tanstack/react-router'

/** Moved to `/settings/notifications`: old bookmarks, notifications and push messages still point here. */
export const Route = createFileRoute('/notifications/settings')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/notifications', replace: true })
  },
})
