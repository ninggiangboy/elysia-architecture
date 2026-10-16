import { describe, expect, test } from 'bun:test'
import { DomainError } from '#/shared/domain/errors'
import { AccountDeletion } from './account-deletion'
import { DataExport } from './data-export'

const T0 = new Date('2026-01-01T00:00:00Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const MINUTE = 60_000
const DAY = 86_400_000

const aPart = (module: string) => ({ module, key: `parts/${module}.json`, size: 10, files: [] })

describe('DataExport', () => {
  const request = () => DataExport.request({ id: 'e1', userId: 'u1', modules: ['a', 'b'], now: T0 })

  test('starts collecting, with every module still owed', () => {
    const e = request()
    expect(e.status).toBe('collecting')
    expect(e.progress()).toEqual({ done: 0, total: 2 })
    expect(e.pendingModules()).toEqual(['a', 'b'])
  })

  test('records each part once; repeats, strangers and late parts change nothing', () => {
    const e = request()
    expect(e.recordPart(aPart('a'), at(1))).toBe('recorded')
    expect(e.recordPart(aPart('a'), at(2))).toBe('duplicate')
    expect(e.recordPart(aPart('zzz'), at(3))).toBe('ignored')
    expect(e.progress()).toEqual({ done: 1, total: 2 })
    expect(e.isCollected()).toBe(false)

    e.recordPart(aPart('b'), at(4))
    expect(e.isCollected()).toBe(true)
    e.beginAssembly(at(5))
    // Once assembling, a part that shows up late is not part of the archive any more.
    expect(e.recordPart(aPart('a'), at(6))).toBe('ignored')
  })

  test('can not be assembled before every part is in', () => {
    const e = request()
    e.recordPart(aPart('a'), at(1))
    expect(() => e.beginAssembly(at(2))).toThrow(DomainError)
  })

  test('collecting → assembling → ready → expired', () => {
    const e = request()
    e.recordPart(aPart('a'), at(1))
    e.recordPart(aPart('b'), at(2))
    e.beginAssembly(at(3))
    e.markReady({ key: 'k', size: 99 }, at(DAY), at(4))
    expect(e.status).toBe('ready')
    expect(e.isDownloadable(at(5))).toBe(true)
    expect(e.isDownloadable(at(DAY))).toBe(false)
    e.expire(at(DAY))
    expect(e.status).toBe('expired')
    expect(e.isDownloadable(at(5))).toBe(false)
  })

  test('only an export in progress can fail, and only a ready one can expire', () => {
    const e = request()
    expect(() => e.expire(at(1))).toThrow(DomainError)
    e.fail('boom', at(2))
    expect(e.props.failureReason).toBe('boom')
    expect(() => e.fail('again', at(3))).toThrow(DomainError)
  })

  test('is stalled only while in progress and quiet for long enough; nudging restarts the quiet period', () => {
    const e = request()
    expect(e.isStalled(at(9 * MINUTE), 10 * MINUTE)).toBe(false)
    expect(e.isStalled(at(10 * MINUTE), 10 * MINUTE)).toBe(true)
    e.nudged(at(10 * MINUTE))
    expect(e.props.nudges).toBe(1)
    expect(e.isStalled(at(15 * MINUTE), 10 * MINUTE)).toBe(false)
    e.fail('x', at(16 * MINUTE))
    expect(e.isStalled(at(60 * MINUTE), 10 * MINUTE)).toBe(false)
  })
})

describe('AccountDeletion', () => {
  const schedule = () =>
    AccountDeletion.schedule({
      id: 'd1',
      userId: 'u1',
      email: 'a@x.co',
      locale: 'en',
      now: T0,
      gracePeriodMs: 14 * DAY,
    })

  test('waits out the grace period, then is due', () => {
    const d = schedule()
    expect(d.status).toBe('scheduled')
    expect(d.props.scheduledFor).toEqual(at(14 * DAY))
    expect(d.isDue(at(14 * DAY - 1))).toBe(false)
    expect(d.isDue(at(14 * DAY))).toBe(true)
  })

  test('can be cancelled during the grace period only', () => {
    const d = schedule()
    d.cancel(at(1))
    expect(d.status).toBe('cancelled')
    expect(() => d.cancel(at(2))).toThrow(DomainError)

    const running = schedule()
    running.start(['a'], at(14 * DAY))
    expect(() => running.cancel(at(14 * DAY + 1))).toThrow(/already started/)
  })

  test('starts one step per module and completes when all confirmed — in any order, any number of times', () => {
    const d = schedule()
    d.start(['a', 'b', 'c'], at(14 * DAY))
    expect(d.status).toBe('running')
    expect(d.pendingModules()).toEqual(['a', 'b', 'c'])

    expect(d.confirm('c', at(1))).toBe('recorded')
    expect(d.confirm('c', at(2))).toBe('duplicate')
    expect(d.confirm('nobody', at(3))).toBe('ignored')
    expect(d.isErased()).toBe(false)
    expect(() => d.complete(at(4))).toThrow(DomainError)

    d.confirm('a', at(5))
    d.confirm('b', at(6))
    expect(d.isErased()).toBe(true)
    d.complete(at(7))
    expect(d.status).toBe('completed')
    // The address was only kept to say goodbye.
    expect(d.email).toBeNull()
  })

  test('a deletion that never started ignores confirmations', () => {
    const d = schedule()
    expect(d.confirm('a', at(1))).toBe('ignored')
  })

  test('stalls when re-sending did not help, still takes late confirmations, and can be resumed', () => {
    const d = schedule()
    d.start(['a', 'b'], at(14 * DAY))
    d.nudged(at(14 * DAY + 1))
    d.stall(at(14 * DAY + 2))
    expect(d.status).toBe('stalled')
    expect(d.isStalled(at(40 * DAY), MINUTE)).toBe(false)

    d.resume(at(14 * DAY + 3))
    expect(d.status).toBe('running')
    expect(d.props.nudges).toBe(0)
    d.stall(at(14 * DAY + 4))

    d.confirm('a', at(14 * DAY + 5))
    d.confirm('b', at(14 * DAY + 6))
    d.complete(at(14 * DAY + 7))
    expect(d.status).toBe('completed')
  })
})
