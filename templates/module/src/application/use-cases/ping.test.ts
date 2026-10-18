import { describe, expect, test } from 'bun:test'
import { FakeClock } from '@kit/testing'
import { Ping } from './ping'

describe('Ping', () => {
  test('answers with the configured reply, who asked and when', () => {
    const clock = new FakeClock()
    expect(new Ping(clock, 'pong').execute({ userId: 'u1' })).toEqual({
      module: '__name__',
      reply: 'pong',
      userId: 'u1',
      at: clock.now().toISOString(),
    })
  })
})
