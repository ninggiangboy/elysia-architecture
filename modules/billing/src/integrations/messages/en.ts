/** What billing says to people through the notification module (in-app/push), in the source language. Keys must not contain `_` except plural suffixes; the notification module merges every installed integration's catalog. */
export const en = {
  inApp: {
    topUpSucceeded: {
      title: 'Your top-up was received',
      body: '{{amount}} was added to your wallet.',
    },
  },
} as const
