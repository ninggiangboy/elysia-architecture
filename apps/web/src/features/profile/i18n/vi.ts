import type { Catalog } from '@kit/i18n'

/** The profile feature's messages in Vietnamese (merged with every other feature's in `src/i18n`). */
export const vi = {
  profile: {
    loading: 'Đang tải hồ sơ',
    loadFailed: 'Không thể tải hồ sơ của bạn',
    personalTitle: 'Thông tin cá nhân',
    personalDescription:
      'Tên hiển thị và đôi dòng giới thiệu, hiển thị với những người bạn tương tác.',
    emailTitle: 'Địa chỉ email',
    emailDescription:
      'Chúng tôi gửi liên kết xác nhận đến địa chỉ mới. Email chỉ đổi sau khi bạn mở liên kết đó.',
    devicesTitle: 'Thiết bị đang đăng nhập',
    devicesDescription:
      'Các thiết bị có thể truy cập tài khoản của bạn. Thiết bị bị đăng xuất sẽ ngừng làm mới phiên và có thể còn hoạt động thêm tối đa 15 phút.',
    picture: 'Ảnh đại diện',
    pictureOf: 'Ảnh đại diện của {{name}}',
    changePicture: 'Đổi ảnh đại diện',
    pictureUpdated: 'Đã cập nhật ảnh đại diện',
    cover: 'Ảnh bìa',
    coverAlt: 'Ảnh bìa',
    changeCover: 'Đổi ảnh bìa',
    coverUpdated: 'Đã cập nhật ảnh bìa',
    uploadFailed: 'Tải ảnh lên thất bại, vui lòng thử lại',
    displayName: 'Tên hiển thị',
    bio: 'Giới thiệu',
    bioPlaceholder: 'Vài câu về bản thân bạn',
    unsaved: 'Bạn có thay đổi chưa lưu.',
    upToDate: 'Đã cập nhật.',
    discard: 'Bỏ thay đổi',
    save: 'Lưu thay đổi',
    saved: 'Đã lưu thay đổi',
    conflictTitle: 'Hồ sơ của bạn đã được thay đổi ở nơi khác trong lúc bạn đang chỉnh sửa.',
    conflictField: '{{field}} hiện tại',
    conflictEmpty: 'trống',
    conflictHelp:
      'Tải phiên bản mới nhất và bỏ chỉnh sửa của bạn, hoặc giữ chỉnh sửa và ghi đè lên.',
    loadLatest: 'Tải bản mới nhất',
    overwrite: 'Ghi đè bằng bản của tôi',
  },
  crop: {
    area: 'Vùng cắt ảnh. Kéo hoặc dùng phím mũi tên để di chuyển ảnh, phím cộng và trừ để thu phóng.',
    zoom: 'Thu phóng',
    help: 'Kéo để đổi vị trí. Cuộn hoặc dùng thanh trượt để thu phóng.',
    save: 'Lưu',
    unreadable: 'Không thể đọc ảnh này',
    unprocessable: 'Không thể xử lý ảnh này',
    badType: 'Ảnh phải là JPEG, PNG hoặc WebP',
    tooLarge: 'Ảnh tối đa {{mb}} MB',
  },
} as const satisfies Catalog
