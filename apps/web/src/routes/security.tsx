import { createFileRoute, redirect } from '@tanstack/react-router'

/** Moved to `/settings/security`: old bookmarks, notifications and push messages still point here. */
export const Route = createFileRoute('/security')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/security', replace: true })
  },
})
