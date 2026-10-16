# Elysia Architecture

Monorepo mẫu: **Elysia + Bun + Drizzle + Postgres + SeaweedFS (S3) + Mailpit** với Clean Architecture,
Modular Monolith, DDD-lite và Transactional Outbox — thiết kế để scale ngang và tách service bất cứ lúc nào.
Frontend React (Vite + TanStack Router/Query + Tailwind) dùng client có type suy ra trực tiếp từ backend (Eden Treaty).

```
apps/api            backend (identity · profile · notification)
apps/web            React SPA
packages/shared-types   hằng số dùng chung web ↔ api
docs/architecture.md    kiến trúc, nguyên tắc distributed-ready, checklist tách module
```

## Chạy nhanh

Yêu cầu: Bun ≥ 1.4, Docker.

```bash
bun run setup        # .env + install + sinh khoá JWT + bật Postgres/Mailpit/SeaweedFS + migrate
bun run dev          # api :3000 + web :5173
```

| URL | Là gì |
| --- | --- |
| http://localhost:5173 | Web |
| http://localhost:3000/api/openapi | API docs (OpenAPI) |
| http://localhost:8025 | Mailpit — xem mail magic link, chào mừng, xác nhận email |
| http://localhost:8333 | S3 của SeaweedFS (key `app-access-key` / `app-secret-key`, bucket `avatars`) |
| localhost:5433 | Postgres (`app`/`app`, db `app`) — cổng 5433 để không đụng Postgres có sẵn ở 5432 (đổi bằng `POSTGRES_PORT`) |

Đăng nhập: nhập email bất kỳ ở `/login` → mở Mailpit → bấm liên kết trong mail.

## Use case có sẵn

| Use case | Endpoint (`/api` prefix) |
| --- | --- |
| Đăng nhập bằng magic link | `POST /auth/magic-link`, `POST /auth/magic-link/verify` |
| Refresh phiên (xoay vòng, phát hiện dùng lại) | `POST /auth/refresh` |
| Đăng xuất | `POST /auth/logout` |
| Xem tài khoản + hồ sơ | `GET /me` |
| Cập nhật hồ sơ (optimistic lock qua `If-Match`) | `PATCH /me/profile` |
| Upload avatar (presigned URL lên SeaweedFS) | `POST /me/avatar/upload-url`, `PUT /me/avatar` |
| Mail chào mừng + tạo hồ sơ (qua outbox) | event `identity.user_registered.v1` |
| Đổi email (xác nhận từ hộp thư mới) | `POST /account/email-change`, `POST /account/email-change/confirm` |
| JWKS để service khác verify token | `GET /.well-known/jwks.json` |
| Health | `GET /health/live`, `GET /health/ready` |

## Kiểm thử

```bash
bun run test                 # unit (domain + use case với fake in-memory)
bun run check:arch           # luật ranh giới kiến trúc (dependency-cruiser)
bun run typecheck && bun run lint
bun run test:e2e             # cần infra: API (buildApp thật + Postgres/S3/Mailpit thật) rồi Playwright
```

Thử nhiều instance (2 replica API sau nginx, cả hai đều chạy outbox relay):

```bash
bun run keys:generate        # nếu chưa có khoá
docker compose --profile app up -d --build
open http://localhost:8080
```

## Lệnh thường dùng

| Lệnh | Việc |
| --- | --- |
| `bun run --filter @app/api db:generate` | Sinh migration cho từng module (sau khi sửa `schema.ts`) |
| `bun run --filter @app/api db:migrate` | Chạy migration từng module (mỗi module có bảng lịch sử riêng `drizzle_<module>`) |
| `bun run --filter @app/api outbox:list` / `outbox:requeue` | Xem / đưa lại các event đã vào dead-letter vào hàng đợi |
| `bun run infra:down` | Tắt container (thêm `-v` vào `docker compose down` để xoá dữ liệu) |

Chi tiết kiến trúc và quyết định thiết kế: [docs/architecture.md](docs/architecture.md).
