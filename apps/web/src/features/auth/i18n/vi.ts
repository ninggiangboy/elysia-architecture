import type { Catalog } from '@kit/i18n'

/** The auth feature's messages in Vietnamese (merged with every other feature's in `src/i18n`). */
export const vi = {
  login: {
    title: 'Đăng nhập',
    intro: 'Nhập email của bạn, chúng tôi sẽ gửi liên kết đăng nhập — không cần mật khẩu.',
    email: 'Email',
    emailPlaceholder: 'ban@example.com',
    send: 'Gửi liên kết đăng nhập',
    or: 'hoặc',
    passkey: 'Đăng nhập bằng passkey',
    continueWith: 'Tiếp tục với {{provider}}',
    newHere: 'Lần đầu đến đây? Cùng liên kết này sẽ tạo tài khoản cho bạn.',
    sentTitle: 'Kiểm tra hộp thư của bạn',
    sent: 'Chúng tôi đã gửi liên kết đăng nhập đến <b>{{email}}</b>. Liên kết có hiệu lực trong 15 phút.',
    differentEmail: 'Dùng email khác',
    resend: 'Gửi lại liên kết',
  },
  callback: {
    invalidLink: 'Liên kết không hợp lệ.',
    couldNotSignIn: 'Không thể đăng nhập',
    requestNewLink: 'Yêu cầu liên kết mới',
    signingIn: 'Đang đăng nhập…',
    verifying: 'Đang xác minh liên kết đăng nhập của bạn.',
    backToSignIn: 'Về trang đăng nhập',
    finishing: 'Đang hoàn tất với nhà cung cấp tài khoản của bạn.',
    cancelled: 'Việc đăng nhập đã bị hủy hoặc từ chối.',
    connected: 'Đã kết nối {{provider}}',
  },
  confirmEmail: {
    confirming: 'Đang xác nhận…',
    updating: 'Đang cập nhật email tài khoản của bạn.',
    failed: 'Không thể xác nhận',
    changedTitle: 'Đã đổi email',
    changed: 'Email tài khoản của bạn hiện là <b>{{email}}</b>.',
  },
  stepUp: {
    title: 'Xác nhận là bạn',
    intro: 'Thay đổi này ảnh hưởng đến cách bạn đăng nhập, nên chúng tôi cần kiểm tra đúng là bạn.',
    passkey: 'Dùng passkey',
    emailCode: 'Gửi mã qua email',
    sentCode: 'Chúng tôi đã gửi mã 6 chữ số qua email cho bạn. Mã có hiệu lực trong 10 phút.',
    code: 'Mã xác nhận',
    sendNew: 'Gửi mã mới',
    confirm: 'Xác nhận',
  },
} as const satisfies Catalog
