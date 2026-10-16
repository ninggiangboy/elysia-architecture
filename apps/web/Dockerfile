# Build context = monorepo root:  docker build -f apps/web/Dockerfile .
FROM oven/bun:1 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --filter @app/web build

FROM nginx:alpine
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
# /config.json is served by nginx → change runtime config by mounting this file, no rebuild needed.
EXPOSE 80
