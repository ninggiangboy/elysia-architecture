import type { Catalog } from '@kit/i18n'

/** What identity says to people through the notification module (mail and in-app/push), in Vietnamese. Keys must not contain `_` except plural suffixes; the notification module merges every installed integration's catalog. */
export const vi = {
  common: {
    unknownDevice: 'một thiết bị không xác định',
    deviceOn: '{{browser}} trên {{os}}',
    passwordChange: {
      set: 'đã được đặt',
      changed: 'đã được thay đổi',
      removed: 'đã được gỡ',
      reset: 'đã được đặt lại',
    },
    someone: 'Một người',
  },
  mail: {
    magicLink: {
      subject: 'Liên kết đăng nhập của bạn',
      title: 'Đăng nhập',
      body: 'Đăng nhập bằng liên kết bên dưới, hoặc nhập mã {{code}} ở trang đăng nhập (tiện khi bạn đọc email trên thiết bị khác). Cả hai hết hạn sau {{expires}} và chỉ dùng được một lần. Nếu bạn không yêu cầu, hãy bỏ qua email này.',
      action: 'Đăng nhập',
    },
    stepUpCode: {
      subject: 'Mã xác nhận của bạn: {{code}}',
      title: 'Xác nhận là bạn',
      body: 'Mã xác nhận của bạn là {{code}}. Mã hết hạn sau {{expires}}. Nếu bạn không yêu cầu, có thể ai đó đang dùng tài khoản của bạn: bạn có thể bỏ qua email này, nhưng nên đăng xuất các thiết bị khác.',
    },
    signupVerification: {
      subject: 'Xác nhận email của bạn: {{code}}',
      title: 'Xác nhận email của bạn',
      body: 'Dùng liên kết bên dưới để hoàn tất tạo tài khoản, hoặc nhập mã {{code}} ở trang đăng ký. Cả hai hết hạn sau {{expires}}. Nếu bạn không đăng ký, hãy bỏ qua email này.',
      action: 'Xác nhận email',
    },
    accountExists: {
      subject: 'Bạn đã có tài khoản',
      title: 'Bạn đã có tài khoản',
      body: 'Có người vừa thử tạo tài khoản bằng {{email}}, địa chỉ này đã có tài khoản. Nếu là bạn, hãy đăng nhập (hoặc đặt lại mật khẩu ở trang đăng nhập). Nếu không, không có gì xảy ra và bạn có thể bỏ qua email này.',
      action: 'Đăng nhập',
    },
    passwordReset: {
      subject: 'Đặt lại mật khẩu',
      title: 'Đặt lại mật khẩu',
      body: 'Dùng liên kết bên dưới để chọn mật khẩu mới. Liên kết hết hạn sau {{expires}}, chỉ dùng một lần và sẽ đăng xuất bạn khỏi mọi thiết bị. Nếu bạn không yêu cầu, hãy bỏ qua email này.',
      action: 'Chọn mật khẩu mới',
    },
    passwordChanged: {
      subject: 'Mật khẩu của bạn đã thay đổi',
      title: 'Mật khẩu đã thay đổi',
      body: 'Mật khẩu của tài khoản bạn {{what}}. Nếu không phải bạn, hãy đặt lại ngay và liên hệ hỗ trợ.',
    },
    invitation: {
      subject: 'Bạn được mời',
      title: 'Bạn được mời',
      body: '{{inviter}} đã mời {{email}} tham gia. Đăng nhập bằng địa chỉ này để tạo tài khoản.',
      action: 'Bắt đầu',
    },
    welcome: {
      subject: 'Chào mừng bạn!',
      title: 'Chào mừng bạn!',
      body: 'Tài khoản {{email}} của bạn đã sẵn sàng.',
      action: 'Mở ứng dụng',
    },
    confirmEmailChange: {
      subject: 'Xác nhận địa chỉ email mới',
      title: 'Xác nhận email mới',
      body: 'Dùng liên kết bên dưới để xác nhận bạn muốn dùng địa chỉ này. Liên kết hết hạn sau {{expires}}.',
      action: 'Xác nhận email',
    },
    emailChanged: {
      subject: 'Email tài khoản của bạn đã thay đổi',
      title: 'Email đã thay đổi',
      body: 'Email của tài khoản {{oldEmail}} đã được đổi thành {{newEmail}}. Nếu không phải bạn, hãy liên hệ hỗ trợ ngay.',
    },
  },
  inApp: {
    welcome: {
      title: 'Chào mừng bạn',
      body: 'Tài khoản của bạn đã sẵn sàng. Hãy thêm tên hiển thị và ảnh đại diện để cá nhân hóa nó.',
    },
    emailChanged: {
      title: 'Địa chỉ email của bạn đã thay đổi',
      body: 'Email tài khoản của bạn hiện là {{email}}.',
    },
    suspiciousSession: {
      title: 'Một thiết bị đã bị đăng xuất để bảo vệ bạn',
      body: 'Chúng tôi thấy một mã đăng nhập bị dùng lại, có thể là do bị đánh cắp, nên đã đăng xuất thiết bị đó. Hãy xem lại các thiết bị đang đăng nhập.',
    },
    newSignIn: {
      title: 'Đăng nhập mới vào tài khoản của bạn',
      body: '{{device}}{{ip}} vừa đăng nhập. Nếu không phải bạn, hãy đăng xuất thiết bị đó.',
    },
    passkeyAdded: {
      title: 'Đã thêm một passkey',
      body: '"{{name}}" giờ có thể đăng nhập vào tài khoản của bạn. Nếu không phải bạn, hãy xóa nó và đăng xuất các thiết bị khác.',
    },
    passkeyRemoved: {
      title: 'Đã xóa một passkey',
      body: '"{{name}}" không còn đăng nhập được vào tài khoản của bạn.',
    },
    oauthLinked: {
      title: 'Đã kết nối {{provider}}',
      body: 'Tài khoản {{provider}} của bạn giờ có thể đăng nhập vào tài khoản này. Nếu không phải bạn, hãy ngắt kết nối và đăng xuất các thiết bị khác.',
    },
    passwordChanged: {
      title: 'Mật khẩu của bạn đã thay đổi',
      body: 'Mật khẩu của tài khoản bạn {{what}}. Nếu không phải bạn, hãy đặt lại và đăng xuất các thiết bị khác.',
    },
    twoFactorEnabled: {
      title: 'Đã bật xác thực hai lớp',
      body: 'Từ giờ đăng nhập sẽ yêu cầu mã từ ứng dụng xác thực. Hãy giữ kỹ các mã khôi phục.',
    },
    twoFactorDisabled: {
      title: 'Đã tắt xác thực hai lớp',
      body: 'Đăng nhập không còn yêu cầu mã từ ứng dụng xác thực. Nếu không phải bạn, hãy bật lại và đăng xuất các thiết bị khác.',
    },
    oauthUnlinked: {
      title: 'Đã ngắt kết nối {{provider}}',
      body: 'Tài khoản {{provider}} của bạn không còn đăng nhập được vào tài khoản này.',
    },
  },
} as const satisfies Catalog
