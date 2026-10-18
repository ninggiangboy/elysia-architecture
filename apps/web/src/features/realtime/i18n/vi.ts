import type { Catalog } from '@kit/i18n'

/** The realtime feature's messages in Vietnamese (merged with every other feature's in `src/i18n`). */
export const vi = {
  realtime: {
    title: 'Thời gian thực',
    description:
      'Luồng Server-Sent Events trực tiếp được phân phối qua Postgres — không cần Redis, chạy được với bao nhiêu bản sao API cũng được.',
    sendTitle: 'Gửi một sự kiện thử',
    sendDescription: 'Nó sẽ hiện trong nhật ký sự kiện sau giây lát.',
    message: 'Nội dung thử',
    send: 'Gửi',
    sendLabel: 'Gửi sự kiện thử',
    howTitle: 'Nó đi như thế nào',
    stepApi: 'API',
    stepApiText: 'Sự kiện thử của bạn được ghi vào outbox.',
    stepPostgres: 'Postgres',
    stepPostgresText: 'Relay phát nó bằng LISTEN/NOTIFY.',
    stepReplicas: 'Mọi bản sao',
    stepReplicasText: 'Mỗi phiên bản API đẩy nó đến các luồng đang giữ.',
    tip: 'Mẹo: đăng nhập trên thiết bị thứ hai, rồi đăng xuất nó từ trang Hồ sơ để xem các sự kiện phiên đến.',
    log: 'Nhật ký sự kiện',
    logDescription: 'Luồng một chiều qua HTTP (fetch + header Authorization). Tự kết nối lại.',
    clear: 'Xóa nhật ký',
    disconnect: 'Ngắt kết nối',
    connect: 'Kết nối',
    noEvents: 'Chưa có sự kiện nào. Hãy gửi một sự kiện thử để thấy nó ở đây.',
    status: {
      open: 'đang mở',
      connecting: 'đang kết nối',
      reconnecting: 'đang kết nối lại',
      closed: 'đã đóng',
    },
  },
} as const satisfies Catalog
