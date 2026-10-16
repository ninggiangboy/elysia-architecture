import { createFileRoute, redirect } from '@tanstack/react-router'

/** Moved to `/settings/account`: old bookmarks, notifications and push messages still point here. */
export const Route = createFileRoute('/privacy')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/account', replace: true })
  },
})
