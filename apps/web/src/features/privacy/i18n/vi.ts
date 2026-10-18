import type { Catalog } from '@kit/i18n'

/** The privacy feature's messages in Vietnamese (merged with every other feature's in `src/i18n`). */
export const vi = {
  privacy: {
    title: 'Quyền riêng tư',
    description: 'Mang một bản sao dữ liệu của bạn đi, hoặc xóa chúng.',
    loading: 'Đang tải cài đặt quyền riêng tư',
    exportTitle: 'Xuất dữ liệu của bạn',
    exportDescription:
      'Chúng tôi gom những gì mỗi phần của dịch vụ lưu về bạn vào một tệp và gửi liên kết qua email. Liên kết dùng được trong một tuần.',
    deleteTitle: 'Xóa tài khoản',
    deleteDescription: 'Xóa tài khoản của bạn và toàn bộ dữ liệu khỏi mọi phần của dịch vụ.',
    export: {
      list: 'Các lần xuất dữ liệu',
      none: 'Bạn chưa yêu cầu xuất dữ liệu.',
      requested: 'Yêu cầu {{date}}',
      progress: 'Tiến độ xuất dữ liệu',
      collecting: 'Đang thu thập',
      assembling: 'Đang đóng gói',
      ready: 'Sẵn sàng',
      failed: 'Thất bại',
      expired: 'Đã hết hạn',
      readySummary: 'Tải được đến {{date}}',
      readySummarySized: '{{size}} · tải được đến {{date}}',
      failedSummary: 'Đã xảy ra lỗi. Bạn có thể yêu cầu lại.',
      expiredSummary: 'Không còn tải xuống được nữa.',
      parts: 'Đã thu thập {{done}}/{{total}} phần',
      download: 'Tải xuống',
      footer:
        'Một tệp zip chứa những gì mỗi phần của dịch vụ lưu về bạn. Yêu cầu và tải về đều cần bạn xác nhận là chính mình.',
      request: 'Yêu cầu xuất dữ liệu',
      requestedToast:
        'Đang chuẩn bị dữ liệu của bạn. Chúng tôi sẽ gửi liên kết qua email khi xong.',
    },
    deletion: {
      running: 'Tài khoản của bạn đang bị xóa',
      progress: 'Tiến độ xóa',
      runningParts:
        'Đã xóa {{done}}/{{total}} phần. Không thể hủy nữa; bạn sẽ bị đăng xuất khi hoàn tất.',
      scheduled: 'Tài khoản của bạn sẽ bị xóa vào {{date}}',
      scheduledText: 'Đến lúc đó mọi thứ vẫn hoạt động bình thường, và bạn có thể đổi ý.',
      explain:
        'Xóa tài khoản sẽ xóa hồ sơ, tệp, thông báo và các cách đăng nhập của bạn. Chúng tôi chờ một thời gian trước khi bắt đầu, để bạn vẫn có thể đổi ý.',
      cancelNoConfirm: 'Hủy việc xóa không cần xác nhận.',
      needsConfirm: 'Yêu cầu bạn xác nhận là chính mình.',
      cancel: 'Hủy việc xóa',
      cancelled: 'Tài khoản của bạn sẽ không bị xóa',
      delete: 'Xóa tài khoản của tôi',
      dialogTitle: 'Xóa tài khoản của bạn?',
      dialogBody:
        'Tài khoản và mọi thứ trong đó sẽ bị xóa vĩnh viễn khi hết thời gian chờ. Chúng tôi sẽ gửi email cho bạn ngay, và bạn có thể hủy từ trang này cho đến lúc đó. Muốn có bản sao trước? Hãy yêu cầu xuất dữ liệu ở trên.',
      keep: 'Giữ tài khoản',
    },
  },
} as const satisfies Catalog
