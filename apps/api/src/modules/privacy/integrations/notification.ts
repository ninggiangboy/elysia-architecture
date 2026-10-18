import type {
  InAppDefinition,
  MailContext,
  MailDefinition,
  NotificationDraft,
  NotificationIntegration,
  TemplateValues,
} from '#/modules/notification/contracts'
import { formatDay } from '#/shared/i18n/format'
import {
  type AccountDeletedPayload,
  type AccountDeletionCancelledPayload,
  type AccountDeletionScheduledPayload,
  type DataExportFailedPayload,
  type DataExportReadyPayload,
  PrivacyEvents,
} from '../contracts'
import { en } from './messages/en'
import { vi } from './messages/vi'

const str = (value: unknown) => (typeof value === 'string' ? value : '')

const ACCOUNT = '/settings/account'

const draft = (
  userId: string,
  kind: 'data_export' | 'security_alert',
  template: string,
  data: Record<string, unknown>,
): NotificationDraft => ({ userId, kind, template, data: { link: ACCOUNT, ...data } })

export const privacyNotifications = {
  templates: {
    dataExportReady: (d, { locale }) => ({ date: formatDay(str(d.expiresAt), locale) }),
    dataExportFailed: () => ({}),
    deletionScheduled: (d, { locale }) => ({ date: formatDay(str(d.scheduledFor), locale) }),
    deletionCancelled: () => ({}),
  } satisfies Record<string, TemplateValues>,
  inApp: [
    {
      name: 'notification.in-app-export-ready',
      eventType: PrivacyEvents.DataExportReady,
      build: (p: DataExportReadyPayload) =>
        draft(p.userId, 'data_export', 'dataExportReady', { expiresAt: p.expiresAt }),
    },
    {
      name: 'notification.in-app-export-failed',
      eventType: PrivacyEvents.DataExportFailed,
      build: (p: DataExportFailedPayload) => draft(p.userId, 'data_export', 'dataExportFailed', {}),
    },
    {
      name: 'notification.in-app-deletion-scheduled',
      eventType: PrivacyEvents.AccountDeletionScheduled,
      build: (p: AccountDeletionScheduledPayload) =>
        draft(p.userId, 'security_alert', 'deletionScheduled', {
          scheduledFor: p.scheduledFor,
          deletionScheduledFor: p.scheduledFor,
        }),
    },
    {
      name: 'notification.in-app-deletion-cancelled',
      eventType: PrivacyEvents.AccountDeletionCancelled,
      build: (p: AccountDeletionCancelledPayload) =>
        draft(p.userId, 'security_alert', 'deletionCancelled', {}),
    },
  ] satisfies InAppDefinition[],
  mails: [
    {
      name: 'notification.send-export-ready',
      eventType: PrivacyEvents.DataExportReady,
      template: 'dataExportReady',
      build: (p: DataExportReadyPayload, { locale }: MailContext) => ({
        to: p.email,
        values: { date: formatDay(p.expiresAt, locale) },
        actionUrl: p.downloadUrl,
        // A link that no longer works is not worth sending late.
        expiresAt: p.expiresAt,
      }),
    },
    {
      name: 'notification.send-deletion-scheduled',
      eventType: PrivacyEvents.AccountDeletionScheduled,
      template: 'deletionScheduled',
      build: (p: AccountDeletionScheduledPayload, { locale, webAppUrl }: MailContext) => ({
        to: p.email,
        values: { date: formatDay(p.scheduledFor, locale) },
        markup: { date: 'bold' as const },
        actionUrl: `${webAppUrl}${ACCOUNT}`,
        // The grace period is the whole point of this mail: after it, the account is gone.
        expiresAt: p.scheduledFor,
      }),
    },
    {
      name: 'notification.send-deletion-cancelled',
      eventType: PrivacyEvents.AccountDeletionCancelled,
      template: 'deletionCancelled',
      build: (p: AccountDeletionCancelledPayload) => ({ to: p.email }),
    },
    {
      name: 'notification.send-account-deleted',
      eventType: PrivacyEvents.AccountDeleted,
      template: 'accountDeleted',
      build: (p: AccountDeletedPayload) => ({
        to: p.email,
        values: { email: p.email },
        markup: { email: 'bold' as const },
      }),
    },
  ] satisfies MailDefinition[],
  messages: { en, vi },
} satisfies NotificationIntegration
