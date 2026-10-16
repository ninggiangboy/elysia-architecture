import { createFileRoute, redirect } from '@tanstack/react-router'

/** Moved to `/settings/wallet/topup`: old bookmarks, notifications and push messages still point here. */
export const Route = createFileRoute('/topup/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/wallet/topup', replace: true })
  },
})
