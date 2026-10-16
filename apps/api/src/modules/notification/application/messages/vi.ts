import type { Catalog } from '@app/shared-types'

/** Vietnamese has no plural forms, so one `_other` per plural key is all it needs. */
export const vi = {
  common: {
    minutes_other: '{{count}} phút',
    openLink: 'Hoặc mở liên kết:',
    unknownDevice: 'một thiết bị không xác định',
    deviceOn: '{{browser}} trên {{os}}',
  },
  mail: {
    magicLink: {
      subject: 'Liên kết đăng nhập của bạn',
      title: 'Đăng nhập',
      body: 'Đăng nhập bằng liên kết bên dưới. Liên kết hết hạn sau {{expires}} và chỉ dùng được một lần. Nếu bạn không yêu cầu, hãy bỏ qua email này.',
      action: 'Đăng nhập',
    },
    stepUpCode: {
      subject: 'Mã xác nhận của bạn: {{code}}',
      title: 'Xác nhận là bạn',
      body: 'Mã xác nhận của bạn là {{code}}. Mã hết hạn sau {{expires}}. Nếu bạn không yêu cầu, có thể ai đó đang dùng tài khoản của bạn: bạn có thể bỏ qua email này, nhưng nên đăng xuất các thiết bị khác.',
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
    dataExportReady: {
      subject: 'Dữ liệu của bạn đã sẵn sàng để tải',
      title: 'Dữ liệu của bạn đã sẵn sàng để tải',
      body: 'Bản sao dữ liệu của bạn đã sẵn sàng. Liên kết dùng được đến hết {{date}}. Tệp chứa dữ liệu cá nhân: hãy cất ở nơi an toàn và không chia sẻ liên kết. Nếu bạn không yêu cầu, có thể ai đó đang dùng tài khoản của bạn.',
      action: 'Tải xuống',
    },
    deletionScheduled: {
      subject: 'Tài khoản của bạn đã được lên lịch xóa',
      title: 'Tài khoản sắp bị xóa',
      body: 'Tài khoản của bạn sẽ bị xóa vĩnh viễn vào {{date}}. Đến lúc đó bạn vẫn có thể đổi ý. Nếu không phải bạn yêu cầu, hãy hủy việc xóa và đăng xuất các thiết bị khác.',
      action: 'Hủy việc xóa',
    },
    deletionCancelled: {
      subject: 'Đã hủy xóa tài khoản',
      title: 'Đã hủy xóa tài khoản',
      body: 'Việc xóa tài khoản của bạn đã được hủy. Không có dữ liệu nào bị xóa. Nếu không phải bạn, hãy kiểm tra các thiết bị đang đăng nhập.',
    },
    accountDeleted: {
      subject: 'Tài khoản của bạn đã bị xóa',
      title: 'Tài khoản đã bị xóa',
      body: 'Tài khoản {{email}} và dữ liệu của nó đã bị xóa. Đây là thư cuối cùng chúng tôi gửi cho bạn.',
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
    oauthUnlinked: {
      title: 'Đã ngắt kết nối {{provider}}',
      body: 'Tài khoản {{provider}} của bạn không còn đăng nhập được vào tài khoản này.',
    },
    dataExportReady: {
      title: 'Dữ liệu của bạn đã sẵn sàng để tải',
      body: 'Bản sao dữ liệu của bạn có thể tải xuống đến hết {{date}}. Chúng tôi cũng đã gửi liên kết qua email.',
    },
    dataExportFailed: {
      title: 'Không thể chuẩn bị dữ liệu của bạn',
      body: 'Đã xảy ra lỗi khi thu thập dữ liệu của bạn. Vui lòng thử lại.',
    },
    deletionScheduled: {
      title: 'Tài khoản của bạn đã được lên lịch xóa',
      body: 'Tài khoản sẽ bị xóa vào {{date}}. Nếu không phải bạn, hãy hủy ngay và đăng xuất các thiết bị khác.',
    },
    deletionCancelled: {
      title: 'Đã hủy xóa tài khoản',
      body: 'Tài khoản của bạn sẽ không bị xóa. Nếu không phải bạn, hãy kiểm tra các thiết bị đang đăng nhập.',
    },
  },
} satisfies Catalog
