import type { Catalog } from '@kit/i18n'

/** What billing says to people through the notification module (in-app/push), in Vietnamese. Keys must not contain `_` except plural suffixes; the notification module merges every installed integration's catalog. */
export const vi = {
  inApp: {
    topUpSucceeded: {
      title: 'Đã nhận khoản nạp tiền của bạn',
      body: 'Đã nạp {{amount}} vào ví của bạn.',
    },
  },
} as const satisfies Catalog
