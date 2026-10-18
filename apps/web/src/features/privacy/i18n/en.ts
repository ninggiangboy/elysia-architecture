/** The privacy feature's messages in English, the source language (merged with every other feature's in `src/i18n`). */
export const en = {
  privacy: {
    title: 'Privacy',
    description: 'Take a copy of your data with you, or have it erased.',
    loading: 'Loading privacy settings',
    exportTitle: 'Export your data',
    exportDescription:
      'We collect what every part of the service holds about you into one file and email you the link. The link works for a week.',
    deleteTitle: 'Delete your account',
    deleteDescription: 'Erases your account and all of its data from every part of the service.',
    export: {
      list: 'Data exports',
      none: 'You have not requested an export yet.',
      requested: 'Requested {{date}}',
      progress: 'Export progress',
      collecting: 'Collecting',
      assembling: 'Packing',
      ready: 'Ready',
      failed: 'Failed',
      expired: 'Expired',
      readySummary: 'Available until {{date}}',
      readySummarySized: '{{size}} · available until {{date}}',
      failedSummary: 'Something went wrong. You can request it again.',
      expiredSummary: 'The download is no longer available.',
      parts: '{{done}} of {{total}} parts collected',
      download: 'Download',
      footer:
        'A zip with what each part of the service holds about you. Asking for it, and downloading it, ask you to confirm it is you.',
      request: 'Request an export',
      requestedToast: 'Preparing your export. We will email you the link when it is ready.',
    },
    deletion: {
      running: 'Your account is being deleted',
      progress: 'Deletion progress',
      runningParts:
        '{{done}} of {{total}} parts erased. This can no longer be cancelled; you will be signed out when it is done.',
      scheduled: 'Your account will be deleted on {{date}}',
      scheduledText: 'Until then everything works as usual, and you can change your mind.',
      explain:
        'Deleting your account erases your profile, your files, your notifications and your sign-in methods. We wait before we start, so you can still change your mind.',
      cancelNoConfirm: 'Cancelling does not need a confirmation.',
      needsConfirm: 'Asks you to confirm it is you.',
      cancel: 'Cancel the deletion',
      cancelled: 'Your account will not be deleted',
      delete: 'Delete my account',
      dialogTitle: 'Delete your account?',
      dialogBody:
        'Your account and everything in it will be erased for good once the waiting period is over. We email you now, and you can cancel from this page until then. Want a copy first? Request an export above.',
      keep: 'Keep my account',
    },
  },
} as const
