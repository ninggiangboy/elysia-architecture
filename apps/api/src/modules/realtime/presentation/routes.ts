import { Elysia, t } from 'elysia'
import { authPlugin, type TokenVerifier } from '#/shared/http/auth.plugin'
import { errorResponse, validationError } from '#/shared/http/openapi'
import type {
  RealtimeConnection,
  RealtimeGateway,
  RealtimeMessage,
  RealtimeRegistration,
} from '../application/ports'
import type { SendTestEvent } from '../application/use-cases/send-test-event'

export interface RealtimeRouteDeps {
  verifier: TokenVerifier
  gateway: RealtimeGateway
  useCases: { sendTestEvent: SendTestEvent }
}

/** Keeps proxies (nginx `proxy_read_timeout` = 60s by default) from closing an idle SSE stream. */
const SSE_HEARTBEAT_MS = 20_000
export const realtimeRoutes = ({ verifier, gateway, useCases: uc }: RealtimeRouteDeps) => {
  const encoder = new TextEncoder()

  return new Elysia({ prefix: '/realtime', tags: ['realtime'] })
    .use(authPlugin(verifier))
    .get(
      '/events',
      ({ auth, request, server }) => {
        // Bun closes sockets idle for 10s by default; this stream is idle by nature.
        server?.timeout(request, 0)

        let heartbeat: ReturnType<typeof setInterval> | undefined
        let unregister: (() => void) | undefined
        let controller!: ReadableStreamDefaultController<Uint8Array>
        let closed = false

        const write = (chunk: string) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(chunk))
          } catch {
            dispose()
          }
        }
        const dispose = () => {
          if (closed) return
          closed = true
          clearInterval(heartbeat)
          unregister?.()
          try {
            controller.close()
          } catch {
            // already closed by the client
          }
        }
        const connection: RealtimeConnection = {
          id: crypto.randomUUID(),
          userId: auth.userId,
          sessionId: auth.sessionId,
          send: (m: RealtimeMessage) =>
            write(`${m.id ? `id: ${m.id}\n` : ''}event: ${m.type}\ndata: ${JSON.stringify(m)}\n\n`),
          close: dispose,
        }

        const stream = new ReadableStream<Uint8Array>({
          async start(c) {
            controller = c
            let registration: RealtimeRegistration
            try {
              registration = await gateway.register(
                connection,
                request.headers.get('last-event-id') ?? undefined,
              )
            } catch (err) {
              dispose()
              throw err
            }
            unregister = registration.unregister
            if (closed) return unregister()
            request.signal.addEventListener('abort', dispose)
            heartbeat = setInterval(() => write(': ping\n\n'), SSE_HEARTBEAT_MS)
            write(
              `retry: 3000\nevent: ready\ndata: ${JSON.stringify({ sessionId: auth.sessionId, resumed: registration.resumed, cursor: registration.cursor })}\n\n`,
            )
            // After `ready`, so the client knows whether what follows is a replay of what it missed.
            registration.start()
          },
          cancel: dispose,
        })
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            // Tell nginx not to buffer the stream.
            'x-accel-buffering': 'no',
          },
        })
      },
      {
        auth: true,
        detail: {
          summary: 'Server-Sent Events stream',
          description:
            'Live events for the signed-in user (`ready`, `session.revoked`, `notification.created`, `notification.read`, `notification.seen`, `realtime.test`). ' +
            '`EventSource` cannot send an `Authorization` header, so consume it with `fetch` and read the body stream. ' +
            'Each `data:` is a JSON `{ id, type, data, at }`, and the SSE `id:` is that same id. ' +
            'Only events that opt in (`session.revoked`) carry an `id` and are replayable; the others are "something changed, refetch" and are not stored. ' +
            '`ready` carries a `cursor`: keep the newest of it and the event ids, and send it as `Last-Event-ID` when reconnecting. ' +
            'If it is still in the buffer, `ready.resumed` is `true` and the replayable events you missed follow it; otherwise `false` (cursor too old, or too many missed): resync those from the API.',
        },
      },
    )
    .post(
      '/test',
      async ({ auth, body, set }) => {
        await uc.sendTestEvent.execute({
          userId: auth.userId,
          sessionId: auth.sessionId,
          message: body.message,
          replay: body.replay,
        })
        set.status = 202
        return { status: 'sent' as const }
      },
      {
        auth: true,
        body: t.Object({
          message: t.String({ minLength: 1, maxLength: 200 }),
          replay: t.Optional(
            t.Boolean({ description: 'Store the event so a reconnecting client replays it' }),
          ),
        }),
        detail: {
          summary: 'Send a test event',
          description:
            'Pushes a `realtime.test` event to every open SSE connection of the caller, on every API instance.',
        },
        response: {
          202: t.Object({ status: t.Literal('sent') }, { description: 'Event published' }),
          400: validationError(),
          401: errorResponse(401, 'missing_token', 'invalid_token'),
        },
      },
    )
}
