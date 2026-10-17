import { describe, expect, test } from 'bun:test'
import { InMemoryInbox, SimulatedCrash } from './fakes'

describe('InMemoryInbox', () => {
  test('runs a side effect once per (message, handler)', async () => {
    const inbox = new InMemoryInbox()
    let runs = 0
    await inbox.afterSideEffect('m1', 'h', async () => void runs++)
    await inbox.afterSideEffect('m1', 'h', async () => void runs++)
    await inbox.afterSideEffect('m1', 'other', async () => void runs++)
    expect(runs).toBe(2)
  })

  test('a side effect that throws is not recorded, so the redelivery runs it again', async () => {
    const inbox = new InMemoryInbox()
    let runs = 0
    const flaky = async () => {
      if (++runs === 1) throw new Error('boom')
    }
    await expect(inbox.afterSideEffect('m1', 'h', flaky)).rejects.toThrow('boom')
    await inbox.afterSideEffect('m1', 'h', flaky)
    expect(runs).toBe(2)
  })

  test('a crash between the side effect and the inbox write makes the redelivery repeat the side effect', async () => {
    const inbox = new InMemoryInbox()
    let runs = 0
    inbox.crashAfterNextSideEffect()
    await expect(inbox.afterSideEffect('m1', 'h', async () => void runs++)).rejects.toBeInstanceOf(
      SimulatedCrash,
    )
    expect(runs).toBe(1)

    // At-least-once: the effect happened but was never recorded, so it happens again, and then it sticks.
    await inbox.afterSideEffect('m1', 'h', async () => void runs++)
    await inbox.afterSideEffect('m1', 'h', async () => void runs++)
    expect(runs).toBe(2)
  })

  test('the crash is armed for one call only', async () => {
    const inbox = new InMemoryInbox()
    inbox.crashAfterNextSideEffect()
    await expect(inbox.afterSideEffect('m1', 'h', async () => {})).rejects.toBeInstanceOf(
      SimulatedCrash,
    )
    await inbox.afterSideEffect('m2', 'h', async () => {})
  })

  test('transactional leaves no trace when the handler throws', async () => {
    const inbox = new InMemoryInbox()
    let runs = 0
    const flaky = async () => {
      if (++runs === 1) throw new Error('boom')
    }
    await expect(inbox.transactional('m1', 'h', flaky)).rejects.toThrow('boom')
    await inbox.transactional('m1', 'h', flaky)
    await inbox.transactional('m1', 'h', flaky)
    expect(runs).toBe(2)
  })
})
