import { createFileRoute, redirect } from '@tanstack/react-router'

/** Moved to `/settings/wallet`: old bookmarks, notifications and push messages still point here. */
export const Route = createFileRoute('/wallet/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/wallet', replace: true })
  },
})
