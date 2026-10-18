import type { Catalog } from '@kit/i18n'

/** What privacy says to people through the notification module (mail and in-app/push), in Vietnamese. Keys must not contain `_` except plural suffixes; the notification module merges every installed integration's catalog. */
export const vi = {
  mail: {
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
} as const satisfies Catalog
