/** What privacy says to people through the notification module (mail and in-app/push), in the source language. Keys must not contain `_` except plural suffixes; the notification module merges every installed integration's catalog. */
export const en = {
  mail: {
    dataExportReady: {
      subject: 'Your data export is ready',
      title: 'Your data export is ready',
      body: 'Your copy is ready. The link works until {{date}}. The file contains personal data: keep it somewhere safe and do not share the link. If you did not ask for it, someone may be using your account.',
      action: 'Download',
    },
    deletionScheduled: {
      subject: 'Your account is scheduled for deletion',
      title: 'Account scheduled for deletion',
      body: 'Your account will be permanently erased on {{date}}. Until then you can change your mind. If you did not ask for this, cancel it and sign out your other devices.',
      action: 'Cancel the deletion',
    },
    deletionCancelled: {
      subject: 'Account deletion cancelled',
      title: 'Deletion cancelled',
      body: 'The deletion of your account was cancelled. Nothing was erased. If this was not you, review your signed-in devices.',
    },
    accountDeleted: {
      subject: 'Your account has been deleted',
      title: 'Account deleted',
      body: 'The account {{email}} and its data have been erased. This is the last message we will send you.',
    },
  },
  inApp: {
    dataExportReady: {
      title: 'Your data export is ready',
      body: 'Your copy is ready to download until {{date}}. We also sent the link by email.',
    },
    dataExportFailed: {
      title: 'Your data export could not be prepared',
      body: 'Something went wrong while collecting your data. Please try again.',
    },
    deletionScheduled: {
      title: 'Your account is scheduled for deletion',
      body: 'It will be erased on {{date}}. If this was not you, cancel it now and sign out your other devices.',
    },
    deletionCancelled: {
      title: 'Account deletion cancelled',
      body: 'Your account will not be deleted. If this was not you, review your signed-in devices.',
    },
  },
} as const
