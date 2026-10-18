import type { Catalog } from '@kit/i18n'

/** The account feature's messages in Vietnamese (merged with every other feature's in `src/i18n`). */
export const vi = {
  email: {
    current: 'Email hiện tại',
    new: 'Email mới',
    newPlaceholder: 'moi@example.com',
    validFor: 'Liên kết có hiệu lực trong 30 phút.',
    send: 'Gửi liên kết xác nhận',
    sent: 'Đã gửi liên kết xác nhận đến {{email}}',
  },
  sessions: {
    thisDevice: 'Thiết bị này',
    activeNow: 'Đang hoạt động',
    active: 'Hoạt động {{when}}',
    signedIn: 'Đăng nhập {{when}}',
    signOut: 'Đăng xuất',
    signedOut: 'Đã đăng xuất thiết bị',
    signedOutOthers_other: 'Đã đăng xuất {{count}} thiết bị khác',
    othersSignedIn_other: '{{count}} thiết bị khác đang đăng nhập.',
    onlyThis: 'Chỉ có thiết bị này đang đăng nhập.',
    signOutOthers: 'Đăng xuất tất cả thiết bị khác',
  },
  security: {
    loading: 'Đang tải cài đặt bảo mật',
    passkeysTitle: 'Passkey',
    passkeysDescription:
      'Đăng nhập bằng vân tay, khuôn mặt hoặc khóa màn hình. Passkey không thể bị lừa đảo và không rời khỏi thiết bị của bạn trừ khi bạn đồng bộ chúng.',
    accountsTitle: 'Tài khoản đã kết nối',
    accountsDescription:
      'Đăng nhập bằng Google hoặc GitHub. Chúng tôi chỉ khớp tài khoản theo email mà nhà cung cấp đã xác minh.',
  },
  passkeys: {
    list: 'Passkey',
    none: 'Chưa có passkey nào. Passkey cho phép bạn đăng nhập bằng vân tay, khuôn mặt hoặc khóa màn hình — không cần liên kết email.',
    synced: 'Đã đồng bộ',
    added: 'Thêm {{date}}',
    usedAt: 'dùng {{when}}',
    neverUsed: 'chưa dùng',
    supported: 'Thêm hoặc xóa passkey sẽ yêu cầu bạn xác nhận là chính mình.',
    unsupported: 'Trình duyệt này không hỗ trợ passkey.',
    add: 'Thêm passkey',
    addedToast: 'Đã thêm passkey "{{name}}"',
    removedToast: 'Đã xóa passkey',
    removeTitle: 'Xóa passkey này?',
    removeBody:
      'Bạn sẽ không thể đăng nhập bằng <b>{{name}}</b> nữa. Bạn vẫn đăng nhập được bằng liên kết email. Hãy xóa nó khỏi danh sách passkey trên thiết bị nếu không muốn thấy nó được gợi ý.',
    alreadyRegistered: 'Thiết bị này đã có passkey cho tài khoản của bạn.',
    dismissed: 'Hộp thoại passkey đã bị đóng hoặc hết thời gian.',
  },
  accounts: {
    list: 'Tài khoản đã kết nối',
    connected: 'Đã kết nối',
    notConnected: 'Chưa kết nối',
    connect: 'Kết nối',
    disconnect: 'Ngắt kết nối',
    disconnected: 'Đã ngắt kết nối {{provider}}',
  },
} as const satisfies Catalog
