import type {
  InAppDefinition,
  NotificationIntegration,
  TemplateValues,
} from '#/modules/notification/contracts'
import { formatMoney } from '#/shared/i18n/format'
import { BillingEvents, type TopUpSucceededPayload } from '../contracts'
import { en } from './messages/en'
import { vi } from './messages/vi'

export const billingNotifications = {
  templates: {
    topUpSucceeded: (d, { locale }) => ({
      amount: formatMoney(
        Number(d.amount),
        typeof d.currency === 'string' ? d.currency : '',
        locale,
      ),
    }),
  } satisfies Record<string, TemplateValues>,
  inApp: [
    {
      name: 'notification.in-app-topup-succeeded',
      eventType: BillingEvents.TopUpSucceeded,
      build: (p: TopUpSucceededPayload) => ({
        userId: p.userId,
        kind: 'payment' as const,
        template: 'topUpSucceeded',
        data: { link: '/settings/wallet', amount: p.amount, currency: p.currency },
      }),
    },
  ] satisfies InAppDefinition[],
  messages: { en, vi },
} satisfies NotificationIntegration
