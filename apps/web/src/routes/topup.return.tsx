import { createFileRoute, redirect } from '@tanstack/react-router'

/** Moved to `/wallet/topup/return`: payments started before the move still send the buyer back here. */
export const Route = createFileRoute('/topup/return')({
  validateSearch: (search: Record<string, unknown>): { topUp: string } => ({
    topUp: typeof search.topUp === 'string' ? search.topUp : '',
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/wallet/topup/return', search, replace: true })
  },
})
