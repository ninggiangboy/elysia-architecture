/** The notifications feature's messages in English, the source language (merged with every other feature's in `src/i18n`). */
export const en = {
  notifications: {
    title: 'Notifications',
    newCount: 'Notifications, {{count}} new',
    unread: '{{count}} unread',
    markAll: 'Mark all as read',
    settings: 'Notification settings',
    loading: 'Loading notifications',
    caughtUp: "You're all caught up",
    empty: 'You have no notifications yet.',
    unreadPrefix: 'Unread: ',
    markRead: 'Mark read',
    loadOlder: 'Load older',
    settingsTitle: 'Notification settings',
    settingsDescription:
      'Choose how you hear about account activity. The notifications themselves are in the bell menu.',
    push: {
      onTitle: 'Browser notifications are on',
      onText:
        'This browser shows a system notification when something happens, even when the app is closed.',
      offTitle: 'Browser notifications are off',
      offText: 'Get a system notification on this browser, even when the app is closed.',
      deniedTitle: 'Browser notifications are blocked',
      deniedText: "Allow them in your browser's site settings to get alerts here.",
      unsupported: 'This browser cannot show notifications from this app.',
      turnOff: 'Turn off',
      turnOn: 'Turn on',
    },
    templates: {
      welcome: {
        title: 'Welcome aboard',
        body: 'Your account is ready. Add a display name and an avatar to make it yours.',
      },
      emailChanged: {
        title: 'Your email address was changed',
        body: 'Your account email is now {{email}}.',
      },
      suspiciousSession: {
        title: 'A device was signed out for your safety',
        body: 'We saw a sign-in token being reused, which can mean it was stolen, so we signed that device out. Review your signed-in devices.',
      },
      newSignIn: {
        title: 'New sign-in to your account',
        body: '{{device}}{{ip}} signed in. If this was not you, sign that device out.',
      },
      passkeyAdded: {
        title: 'A passkey was added',
        body: '"{{name}}" can now sign in to your account. If this was not you, remove it and sign out your other devices.',
      },
      passkeyRemoved: {
        title: 'A passkey was removed',
        body: '"{{name}}" can no longer sign in to your account.',
      },
      oauthLinked: {
        title: '{{provider}} was connected',
        body: 'Your {{provider}} account can now sign in to your account. If this was not you, disconnect it and sign out your other devices.',
      },
      oauthUnlinked: {
        title: '{{provider}} was disconnected',
        body: 'Your {{provider}} account can no longer sign in to your account.',
      },
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
      topUpSucceeded: {
        title: 'Your top-up was received',
        body: '{{amount}} was added to your wallet.',
      },
    },
    live: {
      signedOut: 'This device was signed out from another device',
      exportReady: 'Your data export is ready',
      deleted: 'Your account has been deleted',
      fallback: 'New notification',
    },
  },
} as const
