import { beforeEach, describe, expect, test } from 'bun:test'
import { sha256Hex } from '#/shared/auth'
import { ConflictError, UnauthorizedError, ValidationError } from '#/shared/core'
import { FakeClock, InMemoryOutbox, PassthroughUnitOfWork, SequentialIds } from '#/shared/testing'
import { IdentityEvents } from '../contracts/events'
import type { Email } from '../domain/email'
import type { MagicLink } from '../domain/magic-link'
import { type DeviceSession, RefreshToken } from '../domain/refresh-token'
import type {
  MagicLinkRepository,
  RefreshTokenRepository,
  UserRepository,
} from '../domain/repositories'
import type { User } from '../domain/user'
import type { TokenService } from './ports'
import { SessionIssuer } from './session-issuer'
import { Logout } from './use-cases/logout'
import { ListSessions, RevokeOtherSessions, RevokeSession } from './use-cases/manage-sessions'
import { RefreshSession } from './use-cases/refresh-session'
import { RequestMagicLink } from './use-cases/request-magic-link'
import { VerifyMagicLink } from './use-cases/verify-magic-link'

class MemUsers implements UserRepository {
  rows = new Map<string, User>()
  async findById(id: string) {
    return this.rows.get(id) ?? null
  }
  async findByEmail(email: Email) {
    return [...this.rows.values()].find((u) => u.email.equals(email)) ?? null
  }
  async existsByEmail(email: Email) {
    return (await this.findByEmail(email)) !== null
  }
  async save(user: User) {
    const clash = [...this.rows.values()].find(
      (u) => u.id !== user.id && u.email.equals(user.email),
    )
    if (clash) throw new ConflictError('email_taken')
    user.version += 1
    this.rows.set(user.id, user)
  }
}

class MemMagicLinks implements MagicLinkRepository {
  links: (MagicLink & { used?: boolean })[] = []
  async add(link: MagicLink) {
    this.links.push(link)
  }
  async consume(hash: string, now: Date) {
    const link = this.links.find((l) => l.tokenHash === hash && !l.used && l.expiresAt > now)
    if (!link) return null
    link.used = true
    return link
  }
}

class MemRefreshTokens implements RefreshTokenRepository {
  rows: { token: RefreshToken; revokedAt: Date | null; replacedById: string | null }[] = []
  async add(token: RefreshToken) {
    this.rows.push({ token, revokedAt: null, replacedById: null })
  }
  private view(r: (typeof this.rows)[number]) {
    const t = r.token
    return new RefreshToken(
      t.id,
      t.userId,
      t.familyId,
      t.tokenHash,
      t.expiresAt,
      t.createdAt,
      r.revokedAt,
      r.replacedById,
      null,
      null,
    )
  }
  async findByHash(hash: string) {
    const r = this.rows.find((x) => x.token.tokenHash === hash)
    return r ? this.view(r) : null
  }
  async consume(hash: string, replacedById: string | null, now: Date) {
    const r = this.rows.find(
      (x) => x.token.tokenHash === hash && !x.revokedAt && x.token.expiresAt > now,
    )
    if (!r) return null
    r.revokedAt = now
    r.replacedById = replacedById
    return this.view(r)
  }
  private live(userId: string, now: Date) {
    return this.rows.filter(
      (r) => r.token.userId === userId && !r.revokedAt && r.token.expiresAt > now,
    )
  }
  async listActiveSessions(userId: string, now: Date) {
    const live = this.live(userId, now).sort(
      (a, b) => b.token.createdAt.getTime() - a.token.createdAt.getTime(),
    )
    return live.map<DeviceSession>((r) => ({
      id: r.token.familyId,
      userAgent: null,
      ip: null,
      startedAt: this.rows.find((x) => x.token.familyId === r.token.familyId)!.token.createdAt,
      lastActiveAt: r.token.createdAt,
    }))
  }
  async revokeUserSession(userId: string, familyId: string, now: Date) {
    const rows = this.live(userId, now).filter((r) => r.token.familyId === familyId)
    for (const r of rows) r.revokedAt = now
    return rows.length > 0
  }
  async revokeOtherSessions(userId: string, exceptFamilyId: string, now: Date) {
    const rows = this.live(userId, now).filter((r) => r.token.familyId !== exceptFamilyId)
    for (const r of rows) r.revokedAt = now
    return [...new Set(rows.map((r) => r.token.familyId))]
  }
  active(familyId: string) {
    return this.rows.filter((r) => r.token.familyId === familyId && !r.revokedAt).length
  }
}

let seq = 0
const tokens: TokenService = {
  newOpaqueToken: () => {
    const token = `tok-${++seq}`
    return { token, hash: sha256Hex(token) }
  },
  hashOpaqueToken: sha256Hex,
  keyedHash: (input) => sha256Hex(`test-secret:${input}`),
  newNumericCode: () => '123456',
  signAccessToken: async ({ userId, sessionId }) => ({
    token: `jwt:${userId}:${sessionId}`,
    expiresInSeconds: 900,
  }),
}

describe('identity use cases', () => {
  let users: MemUsers
  let links: MemMagicLinks
  let refresh: MemRefreshTokens
  let outbox: InMemoryOutbox
  let clock: FakeClock
  let ids: SequentialIds
  let allow: boolean
  const meta = { ip: '1.1.1.1', userAgent: 'test' }

  const build = () => {
    const uow = new PassthroughUnitOfWork()
    const sessions = new SessionIssuer(refresh, tokens, ids, clock, 3600)
    return {
      request: new RequestMagicLink(
        links,
        {
          check: async () =>
            allow ? { allowed: true as const } : { allowed: false as const, retryAfterMs: 60_000 },
        },
        tokens,
        outbox,
        uow,
        ids,
        clock,
      ),
      verify: new VerifyMagicLink(links, users, sessions, tokens, outbox, uow, ids, clock),
      refresh: new RefreshSession(refresh, users, sessions, tokens, outbox, uow, ids, clock),
      list: new ListSessions(refresh, clock),
      revoke: new RevokeSession(refresh, outbox, uow, clock),
      revokeOthers: new RevokeOtherSessions(refresh, outbox, uow, clock),
      logout: new Logout(refresh, outbox, uow, clock),
    }
  }

  beforeEach(() => {
    users = new MemUsers()
    links = new MemMagicLinks()
    refresh = new MemRefreshTokens()
    outbox = new InMemoryOutbox()
    clock = new FakeClock()
    ids = new SequentialIds()
    allow = true
  })

  test('RequestMagicLink stores only the hash and puts the raw token in the event', async () => {
    await build().request.execute({ email: 'A@B.co', ip: '1.1.1.1' })
    expect(links.links).toHaveLength(1)
    expect(outbox.types()).toEqual([IdentityEvents.MagicLinkRequested])
    const raw = outbox.events[0]?.payload.token as string
    expect(links.links[0]?.tokenHash).toBe(sha256Hex(raw))
    expect(links.links[0]?.tokenHash).not.toBe(raw)
  })

  test('RequestMagicLink is refused when throttled and writes nothing', async () => {
    allow = false
    await expect(build().request.execute({ email: 'a@b.co', ip: '1.1.1.1' })).rejects.toMatchObject(
      {
        code: 'magic_link_rate_limited',
      },
    )
    expect(links.links).toHaveLength(0)
    expect(outbox.events).toHaveLength(0)
  })

  test('VerifyMagicLink registers a new user once, then logs the same user in', async () => {
    const uc = build()
    await uc.request.execute({ email: 'a@b.co', ip: '1.1.1.1' })
    const first = await uc.verify.execute({
      token: outbox.events[0]?.payload.token as string,
      meta,
    })
    expect(first.user.email).toBe('a@b.co')
    expect(outbox.types()).toContain(IdentityEvents.UserRegistered)

    await uc.request.execute({ email: 'a@b.co', ip: '1.1.1.1' })
    const second = await uc.verify.execute({
      token: outbox.events.at(-1)?.payload.token as string,
      meta,
    })
    expect(second.user.id).toBe(first.user.id)
    expect(outbox.types().filter((t) => t === IdentityEvents.UserRegistered)).toHaveLength(1)
  })

  test('VerifyMagicLink rejects unknown, reused and expired links', async () => {
    const uc = build()
    await expect(uc.verify.execute({ token: 'nope', meta })).rejects.toBeInstanceOf(ValidationError)
    await uc.request.execute({ email: 'a@b.co', ip: '1.1.1.1' })
    const token = outbox.events[0]?.payload.token as string
    await uc.verify.execute({ token, meta })
    await expect(uc.verify.execute({ token, meta })).rejects.toMatchObject({
      code: 'invalid_magic_link',
    })

    await uc.request.execute({ email: 'c@d.co', ip: '1.1.1.1' })
    const late = outbox.events.at(-1)?.payload.token as string
    clock.advance(16 * 60_000)
    await expect(uc.verify.execute({ token: late, meta })).rejects.toMatchObject({
      code: 'invalid_magic_link',
    })
  })

  describe('RefreshSession', () => {
    const login = async () => {
      const uc = build()
      await uc.request.execute({ email: 'a@b.co', ip: '1.1.1.1' })
      const session = await uc.verify.execute({
        token: outbox.events[0]?.payload.token as string,
        meta,
      })
      return { uc, session }
    }

    test('rotates within the same family and invalidates the previous token', async () => {
      const { uc, session } = await login()
      const next = await uc.refresh.execute({ refreshToken: session.session.refreshToken, meta })
      expect(next.session.refreshToken).not.toBe(session.session.refreshToken)
      const family = refresh.rows[0]!.token.familyId
      expect(refresh.rows.every((r) => r.token.familyId === family)).toBe(true)
      expect(refresh.active(family)).toBe(1)
    })

    test('reuse of a rotated token just after rotation is refused but keeps the session alive', async () => {
      const { uc, session } = await login()
      const next = await uc.refresh.execute({ refreshToken: session.session.refreshToken, meta })
      clock.advance(2_000)
      // A distinct code, so the route keeps the cookie the other tab just received.
      await expect(
        uc.refresh.execute({ refreshToken: session.session.refreshToken, meta }),
      ).rejects.toMatchObject({ code: 'refresh_token_rotated' })
      await uc.refresh.execute({ refreshToken: next.session.refreshToken, meta }) // still usable
    })

    test('reuse of a rotated token long after rotation is treated as theft: whole family revoked', async () => {
      const { uc, session } = await login()
      const next = await uc.refresh.execute({ refreshToken: session.session.refreshToken, meta })
      clock.advance(60_000)
      await expect(
        uc.refresh.execute({ refreshToken: session.session.refreshToken, meta }),
      ).rejects.toMatchObject({ code: 'invalid_refresh_token' })
      await expect(
        uc.refresh.execute({ refreshToken: next.session.refreshToken, meta }),
      ).rejects.toBeInstanceOf(UnauthorizedError)
      expect(refresh.active(refresh.rows[0]!.token.familyId)).toBe(0)
    })

    test('expired refresh tokens are refused', async () => {
      const { uc, session } = await login()
      clock.advance(3601 * 1000)
      await expect(
        uc.refresh.execute({ refreshToken: session.session.refreshToken, meta }),
      ).rejects.toBeInstanceOf(UnauthorizedError)
    })
  })
  describe('device sessions', () => {
    const signIn = async (uc: ReturnType<typeof build>, email: string) => {
      await uc.request.execute({ email, ip: '1.1.1.1' })
      return uc.verify.execute({ token: outbox.events.at(-1)?.payload.token as string, meta })
    }
    const familyOf = (result: Awaited<ReturnType<typeof signIn>>) =>
      refresh.rows.find((r) => r.token.tokenHash === sha256Hex(result.session.refreshToken))!.token
        .familyId

    test('lists only the caller’s live sessions and flags the current one', async () => {
      const uc = build()
      const phone = await signIn(uc, 'a@b.co')
      clock.advance(1000)
      const laptop = await signIn(uc, 'a@b.co')
      await signIn(uc, 'other@b.co')

      const list = await uc.list.execute({
        userId: phone.user.id,
        currentSessionId: familyOf(laptop),
      })
      expect(list.map((s) => s.id)).toEqual([familyOf(laptop), familyOf(phone)]) // most recent first
      expect(list.map((s) => s.current)).toEqual([true, false])
    })

    test('revoking a session kills its refresh token and removes it from the list', async () => {
      const uc = build()
      const phone = await signIn(uc, 'a@b.co')
      const laptop = await signIn(uc, 'a@b.co')

      await uc.revoke.execute({ userId: phone.user.id, sessionId: familyOf(phone) })
      await expect(
        uc.refresh.execute({ refreshToken: phone.session.refreshToken, meta }),
      ).rejects.toBeInstanceOf(UnauthorizedError)
      await uc.refresh.execute({ refreshToken: laptop.session.refreshToken, meta }) // untouched

      const list = await uc.list.execute({ userId: phone.user.id, currentSessionId: 'x' })
      expect(list.map((s) => s.id)).toEqual([familyOf(laptop)])
    })

    test('a user cannot revoke someone else’s session, nor the same session twice', async () => {
      const uc = build()
      const mine = await signIn(uc, 'a@b.co')
      const theirs = await signIn(uc, 'other@b.co')

      await expect(
        uc.revoke.execute({ userId: mine.user.id, sessionId: familyOf(theirs) }),
      ).rejects.toMatchObject({ code: 'session_not_found' })
      expect(refresh.active(familyOf(theirs))).toBe(1)

      await uc.revoke.execute({ userId: mine.user.id, sessionId: familyOf(mine) })
      await expect(
        uc.revoke.execute({ userId: mine.user.id, sessionId: familyOf(mine) }),
      ).rejects.toMatchObject({ code: 'session_not_found' })
    })

    test('emits session_started on sign-in and session_revoked on every way a session ends', async () => {
      const uc = build()
      const first = await signIn(uc, 'a@b.co')
      const second = await signIn(uc, 'a@b.co')
      const third = await signIn(uc, 'a@b.co')
      const started = outbox.events.filter((e) => e.type === IdentityEvents.SessionStarted)
      expect(started.map((e) => e.payload.sessionId)).toEqual([
        familyOf(first),
        familyOf(second),
        familyOf(third),
      ])
      expect(started[0]?.payload).toMatchObject({
        userId: first.user.id,
        ip: '1.1.1.1',
        userAgent: 'test',
        newUser: true,
      })
      expect(started.slice(1).map((e) => e.payload.newUser)).toEqual([false, false])

      const revoked = () =>
        outbox.events
          .filter((e) => e.type === IdentityEvents.SessionRevoked)
          .map((e) => [e.payload.sessionId, e.payload.reason])

      await uc.revoke.execute({ userId: first.user.id, sessionId: familyOf(first) })
      await uc.logout.execute({ userId: first.user.id, sessionId: familyOf(second) })
      await uc.logout.execute({ userId: first.user.id, sessionId: familyOf(second) }) // already gone: no event
      expect(revoked()).toEqual([
        [familyOf(first), 'revoked_by_user'],
        [familyOf(second), 'logout'],
      ])

      const fourth = await signIn(uc, 'a@b.co')
      await uc.revokeOthers.execute({ userId: first.user.id, currentSessionId: familyOf(fourth) })
      expect(revoked().slice(2)).toEqual([[familyOf(third), 'revoked_by_user']])
    })

    test('token reuse (theft) revokes the session and says so', async () => {
      const uc = build()
      const session = await signIn(uc, 'a@b.co')
      await uc.refresh.execute({ refreshToken: session.session.refreshToken, meta })
      clock.advance(60_000)
      await expect(
        uc.refresh.execute({ refreshToken: session.session.refreshToken, meta }),
      ).rejects.toMatchObject({ code: 'invalid_refresh_token' })
      const revoked = outbox.events.filter((e) => e.type === IdentityEvents.SessionRevoked)
      expect(revoked.map((e) => e.payload)).toMatchObject([
        { sessionId: familyOf(session), reason: 'token_reuse' },
      ])
    })

    test('sign out everywhere else keeps only the current session', async () => {
      const uc = build()
      const a = await signIn(uc, 'a@b.co')
      await signIn(uc, 'a@b.co')
      await signIn(uc, 'a@b.co')
      const other = await signIn(uc, 'other@b.co')

      const out = await uc.revokeOthers.execute({
        userId: a.user.id,
        currentSessionId: familyOf(a),
      })
      expect(out.revoked).toBe(2)
      const list = await uc.list.execute({ userId: a.user.id, currentSessionId: familyOf(a) })
      expect(list.map((s) => s.id)).toEqual([familyOf(a)])
      expect(refresh.active(familyOf(other))).toBe(1)
    })
  })
})
