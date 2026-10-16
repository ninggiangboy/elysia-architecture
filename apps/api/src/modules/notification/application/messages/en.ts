/**
 * What the notification module says to people (mail and in-app/push), in the source language. A new language is a
 * sibling file with the same keys and `{{placeholders}}` (`messages.test.ts` checks it) added in `./index.ts`.
 * Keys must not contain `_` (that is how plural forms are told apart). Messages are plain text: where a mail needs
 * markup (bold, the code), the template passes it in through the placeholder.
 */
export const en = {
  common: {
    minutes_one: '{{count}} minute',
    minutes_other: '{{count}} minutes',
    openLink: 'Or open the link:',
    unknownDevice: 'an unknown device',
    deviceOn: '{{browser}} on {{os}}',
  },
  mail: {
    magicLink: {
      subject: 'Your sign-in link',
      title: 'Sign in',
      body: 'Sign in with the link below. It expires in {{expires}} and can only be used once. If you did not request this, you can ignore this email.',
      action: 'Sign in',
    },
    stepUpCode: {
      subject: 'Your confirmation code: {{code}}',
      title: 'Confirm it is you',
      body: 'Your confirmation code is {{code}}. It expires in {{expires}}. If you did not ask for it, someone may be using your account: you can ignore this email, but consider signing out your other devices.',
    },
    welcome: {
      subject: 'Welcome!',
      title: 'Welcome!',
      body: 'Your account {{email}} is ready.',
      action: 'Open the app',
    },
    confirmEmailChange: {
      subject: 'Confirm your new email address',
      title: 'Confirm new email',
      body: 'Use the link below to confirm you want to use this address. It expires in {{expires}}.',
      action: 'Confirm email',
    },
    emailChanged: {
      subject: 'Your account email was changed',
      title: 'Email changed',
      body: "The email of account {{oldEmail}} was changed to {{newEmail}}. If this wasn't you, contact support right away.",
    },
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
} as const
