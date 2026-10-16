export interface MailContent {
  subject: string
  text: string
  html: string
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )

function layout(title: string, body: string, action?: { label: string; url: string }): string {
  const button = action
    ? `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a></p>
       <p style="color:#666;font-size:13px">Or open the link: <br>${escapeHtml(action.url)}</p>`
    : ''
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto"><h2>${escapeHtml(title)}</h2><p>${body}</p>${button}</div>`
}

export function magicLinkMail(params: { url: string; expiresInMinutes: number }): MailContent {
  return {
    subject: 'Your sign-in link',
    text: `Click the link below to sign in (expires in ${params.expiresInMinutes} minutes):\n${params.url}\n\nIf you did not request this, you can ignore this email.`,
    html: layout(
      'Sign in',
      `Click the button below to sign in. The link expires in ${params.expiresInMinutes} minutes and can only be used once. If you did not request this, you can ignore this email.`,
      { label: 'Sign in', url: params.url },
    ),
  }
}

export function stepUpCodeMail(params: { code: string; expiresInMinutes: number }): MailContent {
  return {
    subject: `Your confirmation code: ${params.code}`,
    text: `Your confirmation code is ${params.code}. It expires in ${params.expiresInMinutes} minutes.\n\nIf you did not ask for it, someone may be using your account: you can ignore this email, but consider signing out your other devices.`,
    html: layout(
      'Confirm it is you',
      `Your confirmation code is <b style="font-size:24px;letter-spacing:4px">${escapeHtml(params.code)}</b><br>It expires in ${params.expiresInMinutes} minutes. If you did not ask for it, someone may be using your account: you can ignore this email, but consider signing out your other devices.`,
    ),
  }
}

export function welcomeMail(params: { email: string; appUrl: string }): MailContent {
  return {
    subject: 'Welcome!',
    text: `Your account ${params.email} is ready. Visit: ${params.appUrl}`,
    html: layout('Welcome!', `Your account <b>${escapeHtml(params.email)}</b> is ready.`, {
      label: 'Open the app',
      url: params.appUrl,
    }),
  }
}

export function confirmEmailChangeMail(params: {
  url: string
  expiresInMinutes: number
}): MailContent {
  return {
    subject: 'Confirm your new email address',
    text: `Click the link to confirm your new email (expires in ${params.expiresInMinutes} minutes):\n${params.url}`,
    html: layout(
      'Confirm new email',
      `Click the button below to confirm you want to use this address. The link expires in ${params.expiresInMinutes} minutes.`,
      { label: 'Confirm email', url: params.url },
    ),
  }
}

export function emailChangedNoticeMail(params: {
  oldEmail: string
  newEmail: string
}): MailContent {
  return {
    subject: 'Your account email was changed',
    text: `The email of account ${params.oldEmail} was changed to ${params.newEmail}. If this wasn't you, contact support right away.`,
    html: layout(
      'Email changed',
      `The email of account <b>${escapeHtml(params.oldEmail)}</b> was changed to <b>${escapeHtml(params.newEmail)}</b>. If this wasn't you, contact support right away.`,
    ),
  }
}

const day = (iso: string) => `${new Date(iso).toISOString().slice(0, 10)} (UTC)`

export function dataExportReadyMail(params: { url: string; expiresAt: string }): MailContent {
  return {
    subject: 'Your data export is ready',
    text: `Your copy is ready. Download it before ${day(params.expiresAt)}:\n${params.url}\n\nThe file contains personal data: keep it somewhere safe and do not share the link. If you did not ask for it, someone may be using your account.`,
    html: layout(
      'Your data export is ready',
      `Your copy is ready. The link works until ${escapeHtml(day(params.expiresAt))}. The file contains personal data: keep it somewhere safe and do not share the link. If you did not ask for it, someone may be using your account.`,
      { label: 'Download', url: params.url },
    ),
  }
}

export function accountDeletionScheduledMail(params: {
  scheduledFor: string
  cancelUrl: string
}): MailContent {
  return {
    subject: 'Your account is scheduled for deletion',
    text: `Your account will be permanently erased on ${day(params.scheduledFor)}. Until then you can change your mind:\n${params.cancelUrl}\n\nIf you did not ask for this, cancel it and sign out your other devices.`,
    html: layout(
      'Account scheduled for deletion',
      `Your account will be permanently erased on <b>${escapeHtml(day(params.scheduledFor))}</b>. Until then you can change your mind. If you did not ask for this, cancel it and sign out your other devices.`,
      { label: 'Cancel the deletion', url: params.cancelUrl },
    ),
  }
}

export function accountDeletionCancelledMail(): MailContent {
  return {
    subject: 'Account deletion cancelled',
    text: 'The deletion of your account was cancelled. Nothing was erased. If this was not you, review your signed-in devices.',
    html: layout(
      'Deletion cancelled',
      'The deletion of your account was cancelled. Nothing was erased. If this was not you, review your signed-in devices.',
    ),
  }
}

export function accountDeletedMail(params: { email: string }): MailContent {
  return {
    subject: 'Your account has been deleted',
    text: `The account ${params.email} and its data have been erased. This is the last message we will send you.`,
    html: layout(
      'Account deleted',
      `The account <b>${escapeHtml(params.email)}</b> and its data have been erased. This is the last message we will send you.`,
    ),
  }
}
