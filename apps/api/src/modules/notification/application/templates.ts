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
       <p style="color:#666;font-size:13px">Hoặc mở liên kết: <br>${escapeHtml(action.url)}</p>`
    : ''
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto"><h2>${escapeHtml(title)}</h2><p>${body}</p>${button}</div>`
}

export function magicLinkMail(params: { url: string; expiresInMinutes: number }): MailContent {
  return {
    subject: 'Liên kết đăng nhập của bạn',
    text: `Bấm vào liên kết sau để đăng nhập (hết hạn sau ${params.expiresInMinutes} phút):\n${params.url}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
    html: layout(
      'Đăng nhập',
      `Bấm nút bên dưới để đăng nhập. Liên kết hết hạn sau ${params.expiresInMinutes} phút và chỉ dùng được một lần. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
      { label: 'Đăng nhập', url: params.url },
    ),
  }
}

export function welcomeMail(params: { email: string; appUrl: string }): MailContent {
  return {
    subject: 'Chào mừng bạn!',
    text: `Tài khoản ${params.email} đã sẵn sàng. Truy cập: ${params.appUrl}`,
    html: layout('Chào mừng bạn!', `Tài khoản <b>${escapeHtml(params.email)}</b> đã sẵn sàng.`, {
      label: 'Mở ứng dụng',
      url: params.appUrl,
    }),
  }
}

export function confirmEmailChangeMail(params: {
  url: string
  expiresInMinutes: number
}): MailContent {
  return {
    subject: 'Xác nhận địa chỉ email mới',
    text: `Bấm vào liên kết để xác nhận email mới (hết hạn sau ${params.expiresInMinutes} phút):\n${params.url}`,
    html: layout(
      'Xác nhận email mới',
      `Bấm nút bên dưới để xác nhận bạn muốn dùng địa chỉ này. Liên kết hết hạn sau ${params.expiresInMinutes} phút.`,
      { label: 'Xác nhận email', url: params.url },
    ),
  }
}

export function emailChangedNoticeMail(params: {
  oldEmail: string
  newEmail: string
}): MailContent {
  return {
    subject: 'Email tài khoản của bạn đã được thay đổi',
    text: `Email của tài khoản ${params.oldEmail} đã đổi thành ${params.newEmail}. Nếu không phải bạn, hãy liên hệ hỗ trợ ngay.`,
    html: layout(
      'Email đã được thay đổi',
      `Email của tài khoản <b>${escapeHtml(params.oldEmail)}</b> đã đổi thành <b>${escapeHtml(params.newEmail)}</b>. Nếu không phải bạn, hãy liên hệ hỗ trợ ngay.`,
    ),
  }
}
