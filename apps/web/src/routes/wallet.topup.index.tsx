import { createFileRoute, redirect } from '@tanstack/react-router'

/** Moved to `/settings/wallet/topup`: old bookmarks and notifications still point here. */
export const Route = createFileRoute('/wallet/topup/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/wallet/topup', replace: true })
  },
})
