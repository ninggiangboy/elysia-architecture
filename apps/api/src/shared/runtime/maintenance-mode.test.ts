import { describe, expect, test } from 'bun:test'
import { createLogger } from '#/shared/telemetry'
import { MaintenanceMode, type MaintenanceState } from './maintenance-mode'

const state = (active: boolean): MaintenanceState => ({
  active,
  reason: active ? 'deploy' : null,
  since: active ? new Date() : null,
})

function setup() {
  const store = { current: state(false), failing: false }
  const mode = new MaintenanceMode(
    {
      read: async () => {
        if (store.failing) throw new Error('db down')
        return store.current
      },
    },
    createLogger('silent'),
    10,
  )
  return { store, mode }
}

describe('MaintenanceMode', () => {
  test('is off until the flag has been read', () => {
    expect(setup().mode.active).toBe(false)
  })

  test('follows the flag and tells listeners only when it flips', async () => {
    const { store, mode } = setup()
    const seen: boolean[] = []
    mode.onChange((active) => void seen.push(active))

    await mode.refresh()
    store.current = state(true)
    await mode.refresh()
    await mode.refresh()
    expect(mode.active).toBe(true)
    store.current = state(false)
    await mode.refresh()

    expect(seen).toEqual([true, false])
  })

  test('a failed read throws on demand but keeps the last known state when polling', async () => {
    const { store, mode } = setup()
    store.current = state(true)
    await mode.refresh()

    store.failing = true
    await expect(mode.refresh()).rejects.toThrow('db down')
    mode.start()
    await Bun.sleep(40) // a few failed ticks
    mode.stop()
    expect(mode.active).toBe(true)
  })

  test('a listener that throws does not stop the others', async () => {
    const { store, mode } = setup()
    const seen: boolean[] = []
    mode.onChange(() => {
      throw new Error('boom')
    })
    mode.onChange((active) => void seen.push(active))
    store.current = state(true)
    await mode.refresh()
    expect(seen).toEqual([true])
  })

  test('polling picks up a change', async () => {
    const { store, mode } = setup()
    mode.start()
    store.current = state(true)
    await Bun.sleep(50)
    mode.stop()
    expect(mode.active).toBe(true)
  })
})
