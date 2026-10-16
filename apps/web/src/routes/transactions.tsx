import { createFileRoute, redirect } from '@tanstack/react-router'

/** Moved to `/wallet`: old bookmarks, notifications and push messages still point here. */
export const Route = createFileRoute('/transactions')({
  beforeLoad: () => {
    throw redirect({ to: '/wallet', replace: true })
  },
})
