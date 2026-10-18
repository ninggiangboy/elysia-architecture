import type { Catalog } from '@kit/i18n'

/** The notifications feature's messages in Vietnamese (merged with every other feature's in `src/i18n`). */
export const vi = {
  notifications: {
    title: 'Thông báo',
    newCount: 'Thông báo, {{count}} mới',
    unread: '{{count}} chưa đọc',
    markAll: 'Đánh dấu tất cả đã đọc',
    settings: 'Cài đặt thông báo',
    loading: 'Đang tải thông báo',
    caughtUp: 'Bạn đã xem hết rồi',
    empty: 'Bạn chưa có thông báo nào.',
    unreadPrefix: 'Chưa đọc: ',
    markRead: 'Đánh dấu đã đọc',
    loadOlder: 'Tải thông báo cũ hơn',
    settingsTitle: 'Cài đặt thông báo',
    settingsDescription:
      'Chọn cách bạn nhận tin về hoạt động tài khoản. Bản thân các thông báo nằm trong menu hình chuông.',
    push: {
      onTitle: 'Thông báo trình duyệt đang bật',
      onText: 'Trình duyệt này hiện thông báo hệ thống khi có sự kiện, kể cả khi ứng dụng đã đóng.',
      offTitle: 'Thông báo trình duyệt đang tắt',
      offText: 'Nhận thông báo hệ thống trên trình duyệt này, kể cả khi ứng dụng đã đóng.',
      deniedTitle: 'Thông báo trình duyệt đang bị chặn',
      deniedText: 'Hãy cho phép trong cài đặt trang web của trình duyệt để nhận cảnh báo tại đây.',
      unsupported: 'Trình duyệt này không thể hiện thông báo từ ứng dụng.',
      turnOff: 'Tắt',
      turnOn: 'Bật',
    },
    templates: {
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
      topUpSucceeded: {
        title: 'Đã nhận khoản nạp tiền của bạn',
        body: 'Đã nạp {{amount}} vào ví của bạn.',
      },
    },
    live: {
      signedOut: 'Thiết bị này đã bị đăng xuất từ một thiết bị khác',
      exportReady: 'Dữ liệu của bạn đã sẵn sàng',
      deleted: 'Tài khoản của bạn đã bị xóa',
      fallback: 'Thông báo mới',
    },
  },
} as const satisfies Catalog
