# Kiến trúc

## Bức tranh tổng thể

```
        ┌────────────── apps/web (React) ──────────────┐
        │  Eden Treaty client (type suy ra từ App)     │
        └───────────────┬──────────────────────────────┘
                        │ /api  (cùng origin: Vite proxy / nginx)
┌───────────────────────▼───────────────────────────────────────────────┐
│ apps/api  (stateless · N instance)                                    │
│                                                                       │
│  presentation ─► application ─► domain          (mỗi module)          │
│                       │  ▲                                            │
│                  ports│  │adapters (infrastructure)                   │
│                       ▼  │                                            │
│   identity ── contracts ──► profile ── contracts ──► (identity)       │
│      │ outbox                  │ outbox ▲ inbox                       │
│      ▼                         ▼        │                             │
│  schema identity          schema profile        schema notification   │
│                                                    ▲ inbox            │
│          OutboxRelay ──► MessagePublisher ─────────┘                  │
│                          (InProcessMessageBus)                        │
└───────────────────────────────────────────────────────────────────────┘
        Postgres · SeaweedFS(S3) · SMTP(Mailpit)
```

## Layer và luật phụ thuộc

Mỗi module có 4 lớp; mũi tên là "được phép import":

```
presentation ─► application ─► domain
infrastructure ─► application, domain      (cài đặt port)
```

| Lớp | Chứa | Không được biết |
| --- | --- | --- |
| `domain` | Aggregate, value object, domain event, interface repository | Mọi thứ khác, kể cả framework |
| `application` | Use case, port (interface), handler của integration event | `infrastructure`, `presentation`, Elysia, Drizzle |
| `infrastructure` | Repository Drizzle, JWT, S3, SMTP, outbox | `presentation` |
| `presentation` | Route Elysia, validate input, map lỗi → HTTP | — |
| `contracts` | Event type, DTO, interface mà module khác được dùng | Mọi thứ trong module |

Các luật này được **kiểm tự động**: `bun run check:arch` (`apps/api/.dependency-cruiser.cjs`) —
domain thuần, application không import infrastructure, module A chỉ import `modules/B/contracts`, `shared` không biết module nào,
và chỉ composition root (`app.ts`, `main.ts`, `bootstrap/`) biết adapter cụ thể.

`bootstrap/container.ts` là composition root: nơi duy nhất nối module với adapter. Không dùng DI container, wiring tay để dễ đọc.

Import nội bộ của api dùng alias `#/*` → `src/*` qua `paths` trong tsconfig (Bun và tsc đều đọc được; web ánh xạ `#/*` về `../api/src/*` để suy type từ backend).

## Nguyên tắc distributed-ready

Mục tiêu: chạy N instance, và tách bất kỳ module nào thành service riêng mà **không viết lại domain/application**.

1. **Stateless.** Không giữ state trong RAM giữa các request. Auth bằng JWT, rate limit trong DB, file đi thẳng lên S3 bằng presigned URL. Không cần sticky session.
2. **Module = service tương lai.**
   - Mỗi module một Postgres schema (`identity`, `profile`, `notification`), migration riêng, outbox/inbox riêng.
   - Không FK, JOIN hay transaction xuyên module. `profile.profiles.user_id` chỉ giữ giá trị id của user.
   - Mỗi module tự đọc connection string (`IDENTITY_DATABASE_URL`, …; mặc định `DATABASE_URL`) và có pool + `UnitOfWork` riêng (`ModuleDatabase`). Tách DB chỉ là đổi env.
3. **Giao tiếp chỉ qua `contracts/`.**
   - Đồng bộ: interface như `IdentityApi.getAccount` với DTO thuần (ISO string, không entity). Hôm nay là gọi hàm in-process; mai thay bằng HTTP client cùng interface. Caller phải chịu được lỗi/timeout và không gọi trong transaction.
   - Bất đồng bộ: integration event có version (`identity.user_registered.v1`). Chỉ **thêm** field; thay đổi phá vỡ thì ra `.v2` và phát song song.
4. **At-least-once + idempotent.** Outbox đảm bảo "ghi DB và phát event" nguyên tử; phía nhận dùng inbox `(message_id, handler)` để mỗi handler chỉ có hiệu lực một lần.
   Không giả định thứ tự giữa các event. Payload mang đủ dữ liệu (ví dụ email) để handler không gọi ngược lại module phát.
5. **Transport thay được.** Relay đẩy qua port `MessagePublisher`. Hiện là `InProcessMessageBus`; thay bằng NATS/Kafka/RabbitMQ mà không đổi handler (mỗi `(module, handler.name)` là một consumer group).
6. **Đúng khi nhiều instance.**
   - Outbox claim bằng `FOR UPDATE SKIP LOCKED` + lease, instance nào cũng chạy relay được mà không trùng message.
   - Optimistic locking bằng cột `version` (409 `version_conflict`).
   - "Consume" token (magic link, refresh, đổi email) là một `UPDATE … WHERE chưa dùng AND còn hạn RETURNING` nguyên tử.
   - Job chỉ nên chạy một nơi (dọn outbox) lấy `pg_try_advisory_xact_lock`.
7. **Process roles.** `APP_ROLES=api,relay` (mặc định). Tách worker: chạy cùng image với `APP_ROLES=relay`.
8. **Token verify ở mọi nơi.** Access token ES256 có `kid`; public key ở `/api/.well-known/jwks.json`. Service khác verify không cần secret chung, và xoay khoá được.
9. **Quan sát được.** `x-request-id`/`x-correlation-id` nằm trong AsyncLocalStorage, gắn vào mọi dòng log (pino JSON) và ghi vào `headers` của outbox message, nên log của handler bất đồng bộ nối được về request gốc.
10. **Vận hành.** Cấu hình chỉ qua env; `/health/live` và `/health/ready` (ping DB từng module); graceful shutdown (dừng nhận request → dừng relay → đóng pool); migration là job riêng; `DB_PREPARE=false` để chạy sau PgBouncer.

## Luồng tiêu biểu

**Đăng nhập bằng magic link**

```
POST /auth/magic-link ──► RequestMagicLink
   throttle (đếm trong DB) → MagicLink.issue → [tx: insert magic_links + outbox] → 202
OutboxRelay ──► bus ──► notification.send-magic-link ──► SMTP
POST /auth/magic-link/verify ──► VerifyMagicLink
   [tx: consume nguyên tử → tìm/tạo User (+ event user_registered) → refresh token mới] → access JWT + cookie
user_registered ──► profile.create-on-user-registered (inbox, cùng tx)   ┐ hai consumer độc lập
                └─► notification.send-welcome (gửi mail → ghi inbox)      ┘
```

**Phiên đăng nhập**: access JWT 15 phút (stateless) + refresh token opaque trong cookie httpOnly `Path=/api/auth`.
Mỗi lần refresh xoay token trong cùng "family"; dùng lại token đã xoay ngoài cửa sổ 10 giây bị coi là bị đánh cắp và thu hồi cả family.
Hai tab refresh đồng thời (trong 10 giây) chỉ bị từ chối, không mất phiên.

**Avatar**: `POST upload-url` cấp presigned PUT (5 phút) → trình duyệt PUT thẳng lên SeaweedFS → `PUT /me/avatar {key}` kiểm key thuộc user, `stat` size/type
(presigned PUT không ép được, nên file sai bị xoá) → phát `profile.avatar_changed.v1` → handler xoá file cũ.

## Gửi mail và rate limit

Mail đi qua outbox nên không bao giờ làm chậm hay làm hỏng request. Phần "gửi sao cho nhà cung cấp không từ chối" gồm bốn lớp:

```
OutboxRelay ─► MailEventHandler ─► ThrottledMailer ─► Mailer thật (SMTP / SES…)
   ▲                │  hết hạn → bỏ          │ acquire()/penalize()
   │                │  permanent → bỏ+log    ▼
   └── hoãn đúng giờ ◄── RetryLaterError ── PostgresSendRateLimiter (token bucket + quota ngày)
```

1. **Giới hạn chủ động** (`ThrottledMailer` + `PostgresSendRateLimiter`): token bucket `MAIL_RATE_PER_SECOND` (burst `MAIL_BURST`) và quota ngày `MAIL_DAILY_QUOTA`.
   Trạng thái nằm trong Postgres, mỗi lần xin phép là một upsert nguyên tử nên N instance cùng chia một giới hạn. Hết quota thì lỗi kèm đúng thời gian cần chờ, và không đụng tới nhà cung cấp.
2. **Thích ứng**: nếu nhà cung cấp vẫn báo quá tải (SES `454 Throttling failure`, Gmail `550 5.4.5`…), bucket bị "ghi nợ" (`penalize`) nên mọi instance cùng lùi lại, không đập tiếp.
3. **Relay hiểu "thử lại sau"** (`RetryLaterError`): hoãn message tới đúng thời điểm gợi ý (+ jitter ≤10%), **hoàn lại** lần thử vừa tính nên một đợt rate limit dài không đẩy mail vào dead. Chỉ bỏ cuộc khi message già hơn `OUTBOX_DEFER_BUDGET_HOURS` (mặc định 24 giờ).
   Lỗi thường (mất kết nối, sai credentials 535…) vẫn theo backoff mũ và tối đa 10 lần.
4. **Mail vô nghĩa thì không gửi**: link magic link/đổi email có `expiresAt`; nếu mail bị hoãn quá hạn thì bỏ qua thay vì gửi một link đã chết. Lỗi vĩnh viễn của một địa chỉ (550/554) chỉ bỏ mail đó và log `error`, không đưa cả event vào dead hay chặn consumer khác.

Vận hành dead-letter: `bun run --filter @app/api outbox:list` và `outbox:requeue [-- --id <uuid> | --type <event>]`.
Requeue an toàn vì inbox chặn handler đã xong, không gửi trùng.

### Dùng Amazon SES

- **Cách nhanh, không cần code**: SES có SMTP interface. Đặt `SMTP_HOST=email-smtp.<region>.amazonaws.com`, `SMTP_PORT=587`, `SMTP_REQUIRE_TLS=true`, `SMTP_USER`/`SMTP_PASSWORD` (SMTP credentials của SES), `MAIL_FROM` là địa chỉ đã verify.
  Đặt `MAIL_RATE_PER_SECOND` bằng *maximum send rate* và `MAIL_DAILY_QUOTA` bằng *24-hour sending quota* của tài khoản (sandbox: 1/giây, 200/ngày). Lỗi `454` được nhận diện là rate limit; `554 Message rejected` (vd. chưa verify địa chỉ nhận trong sandbox) là permanent.
- **Dùng SES API (AWS SDK)** khi cần configuration set, tag hay bounce tracking: viết `SesMailer implements Mailer`, map `ThrottlingException`/`Maximum sending rate exceeded`/`Daily message quota exceeded` → `MailRateLimitedError`, và `MessageRejected`/`MailFromDomainNotVerified` → `MailPermanentError`; truyền vào `createContainer(config, logger, { mailer })`. Bucket, hoãn, hết hạn, dead-letter giữ nguyên.
- Bounce/complaint của SES đến qua SNS: nên thêm một endpoint/handler ghi lại địa chỉ bounce và chặn gửi lại (suppression list) — chưa có trong dự án.

## Đánh đổi có chủ đích

- **Logout không thu hồi access token ngay**: tối đa 15 phút còn hiệu lực. Muốn tức thì cần denylist có store nhanh (Redis) — dự án chủ động không dùng Redis.
- **Rate limit magic link trong Postgres** (3/email, 10/IP mỗi 15 phút): đúng khi nhiều instance, nhưng có thể vượt vài request khi race. Đủ để chống spam; cần chặt hơn thì thay adapter của port `MagicLinkThrottle`.
- **`x-forwarded-for` chỉ đáng tin sau reverse proxy do mình kiểm soát** (nginx trong compose đã set). Không expose API trực tiếp ra Internet mà vẫn tin header này.
- **Giới hạn gửi mail dùng một bucket chung cho mọi loại mail**: mail quan trọng (magic link) có thể phải xếp sau mail chào mừng khi quá tải. Nếu cần ưu tiên, tách bucket theo loại (tham số `key`) hoặc sắp xếp ưu tiên khi claim.
- **Token thô của magic link nằm trong outbox** tới khi bị dọn (message đã publish bị xoá sau 7 ngày). Nếu cần chặt hơn: mã hoá payload hoặc xoá payload ngay sau khi publish.
- **Gọi chéo module đồng bộ (`IdentityApi`)** làm `GET /me` phụ thuộc identity. Khi tách service cần timeout + fallback; hiện `GET /me` chỉ chịu được việc *thiếu profile*, không chịu được identity ngừng.
- **Pool DB theo module**: 3 module × `DB_POOL_MAX` kết nối khi cùng trỏ một DB. Chỉnh `DB_POOL_MAX` hoặc dùng PgBouncer.

## Checklist: tách một module thành service

Ví dụ tách `notification` (đơn giản nhất) hoặc `profile`:

1. **Dữ liệu**: tạo database riêng, đặt `<MODULE>_DATABASE_URL`, chạy `db:migrate` cho module đó (migration đã tách sẵn theo module). Không có FK xuyên module nên không phải cắt gì.
2. **Transport**: viết `MessagePublisher` + consumer cho broker thật (NATS/Kafka/…): relay của module phát publish lên broker; service mới subscribe theo `(module, handler.name)`. Handler giữ nguyên vì đã idempotent.
3. **Gọi đồng bộ**: với contract mà module khác đang gọi (ví dụ `IdentityApi`), viết `HttpIdentityApi implements IdentityApi` và đổi wiring trong composition root. Thêm timeout, retry, circuit breaker.
4. **Auth**: service mới verify JWT bằng JWKS của identity (`createRemoteJWKSet`) thay vì `AccessTokenVerifier` in-process.
5. **Triển khai**: dùng lại image, đặt `APP_ROLES` phù hợp (`api`, `relay`) và chỉ mount route/handler của module đó trong composition root mới.
6. **Kiểm**: `check:arch` phải vẫn sạch (module không import nội bộ module khác), chạy lại e2e qua mạng.
