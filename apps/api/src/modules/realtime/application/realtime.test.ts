import { describe, expect, test } from 'bun:test'
import type { Envelope } from '#/shared/messaging/envelope'
import { FakeClock } from '#/shared/testing/fakes'
import { MAX_PUSH_AGE_MS, RealtimePushHandler } from './handlers/realtime-push-handler'
import type { RealtimeEvent, RealtimeGateway } from './ports'

class RecordingGateway implements RealtimeGateway {
  published: { target: { userId: string; closeSessionId?: string }; event: RealtimeEvent }[] = []
  fail = false
  async publish(target: { userId: string; closeSessionId?: string }, event: RealtimeEvent) {
    if (this.fail) throw new Error('notify failed')
    this.published.push({ target, event })
  }
  async register() {
    return { resumed: false, cursor: '0', start() {}, unregister() {} }
  }
}

const envelope = (occurredAt: Date): Envelope => ({
  id: 'm1',
  type: 'x.y.v1',
  source: 'identity',
  aggregateId: 'u1',
  occurredAt: occurredAt.toISOString(),
  payload: { userId: 'u1', sessionId: 's1' },
  headers: {},
})

describe('RealtimePushHandler', () => {
  const setup = () => {
    const clock = new FakeClock()
    const gateway = new RecordingGateway()
    const handler = new RealtimePushHandler<{ userId: string; sessionId: string }>(
      'test',
      'x.y.v1',
      (p) => ({
        userId: p.userId,
        closeSessionId: p.sessionId,
        event: { type: 'thing.happened', data: { sessionId: p.sessionId } },
      }),
      gateway,
      clock,
    )
    return { clock, gateway, handler }
  }

  test('maps the event to a push for the user', async () => {
    const { clock, gateway, handler } = setup()
    await handler.handle(envelope(clock.now()))
    expect(gateway.published).toEqual([
      {
        target: { userId: 'u1', closeSessionId: 's1' },
        event: { type: 'thing.happened', data: { sessionId: 's1' } },
      },
    ])
  })

  test('skips stale events instead of announcing old news', async () => {
    const { clock, gateway, handler } = setup()
    const old = clock.now()
    clock.advance(MAX_PUSH_AGE_MS + 1)
    await handler.handle(envelope(old))
    expect(gateway.published).toEqual([])
  })

  test('a failing publish is rethrown so the relay retries', async () => {
    const { clock, gateway, handler } = setup()
    gateway.fail = true
    await expect(handler.handle(envelope(clock.now()))).rejects.toThrow('notify failed')
  })
})
