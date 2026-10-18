import type { RealtimeIntegration } from '@mod/realtime/contracts'
import { BillingEvents, type TopUpFailedPayload, type TopUpSucceededPayload } from '../contracts'

// "Your money moved": the wallet and the history of the user's other open tabs refetch.
export const billingRealtime = {
  routes: [
    {
      name: 'realtime.push-topup-succeeded',
      eventType: BillingEvents.TopUpSucceeded,
      map: (p: TopUpSucceededPayload) => ({
        userId: p.userId,
        event: {
          type: 'billing.topup',
          data: {
            topUpId: p.topUpId,
            status: 'succeeded',
            currency: p.currency,
            amount: p.amount,
            balance: p.balance,
          },
          // A tab that was closed when the money arrived must still learn it on reconnect.
          replay: true,
        },
      }),
    },
    {
      name: 'realtime.push-topup-failed',
      eventType: BillingEvents.TopUpFailed,
      map: (p: TopUpFailedPayload) => ({
        userId: p.userId,
        event: {
          type: 'billing.topup',
          data: { topUpId: p.topUpId, status: 'failed', currency: p.currency, amount: p.amount },
        },
      }),
    },
  ],
} satisfies RealtimeIntegration
