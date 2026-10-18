/** What identity says to people through the notification module (mail and in-app/push), in the source language. Keys must not contain `_` except plural suffixes; the notification module merges every installed integration's catalog. */
export const en = {
  common: {
    unknownDevice: 'an unknown device',
    deviceOn: '{{browser}} on {{os}}',
    passwordChange: {
      set: 'was set',
      changed: 'was changed',
      removed: 'was removed',
      reset: 'was reset',
    },
    someone: 'Someone',
  },
  mail: {
    magicLink: {
      subject: 'Your sign-in link',
      title: 'Sign in',
      body: 'Sign in with the link below, or type the code {{code}} on the sign-in page (handy when you read this on another device). Both expire in {{expires}} and work only once. If you did not request this, you can ignore this email.',
      action: 'Sign in',
    },
    stepUpCode: {
      subject: 'Your confirmation code: {{code}}',
      title: 'Confirm it is you',
      body: 'Your confirmation code is {{code}}. It expires in {{expires}}. If you did not ask for it, someone may be using your account: you can ignore this email, but consider signing out your other devices.',
    },
    signupVerification: {
      subject: 'Confirm your email: {{code}}',
      title: 'Confirm your email',
      body: 'Use the link below to finish creating your account, or type the code {{code}} on the sign-up page. Both expire in {{expires}}. If you did not sign up, you can ignore this email.',
      action: 'Confirm email',
    },
    accountExists: {
      subject: 'You already have an account',
      title: 'You already have an account',
      body: 'Someone tried to create an account with {{email}}, which already has one. If it was you, sign in instead (or reset your password from the sign-in page). If not, nothing happened and you can ignore this email.',
      action: 'Sign in',
    },
    passwordReset: {
      subject: 'Reset your password',
      title: 'Reset your password',
      body: 'Use the link below to choose a new password. It expires in {{expires}}, works once, and signs you out everywhere. If you did not ask for it, you can ignore this email.',
      action: 'Choose a new password',
    },
    passwordChanged: {
      subject: 'Your password changed',
      title: 'Password changed',
      body: 'The password of your account {{what}}. If this was not you, reset it right away and contact support.',
    },
    invitation: {
      subject: 'You are invited',
      title: 'You are invited',
      body: '{{inviter}} invited {{email}} to join. Sign in with this address to create your account.',
      action: 'Get started',
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
    passwordChanged: {
      title: 'Your password changed',
      body: 'The password of your account {{what}}. If this was not you, reset it and sign out your other devices.',
    },
    twoFactorEnabled: {
      title: 'Two-factor authentication is on',
      body: 'Signing in now asks for a code from your authenticator app. Keep your recovery codes safe.',
    },
    twoFactorDisabled: {
      title: 'Two-factor authentication was turned off',
      body: 'Signing in no longer asks for a code from an authenticator app. If this was not you, turn it back on and sign out your other devices.',
    },
    oauthUnlinked: {
      title: '{{provider}} was disconnected',
      body: 'Your {{provider}} account can no longer sign in to your account.',
    },
  },
} as const
