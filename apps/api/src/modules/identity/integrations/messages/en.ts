/** What identity says to people through the notification module (mail and in-app/push), in the source language. Keys must not contain `_` except plural suffixes; the notification module merges every installed integration's catalog. */
export const en = {
  common: {
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
  },
} as const
