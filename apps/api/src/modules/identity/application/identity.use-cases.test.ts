import { beforeEach, describe, expect, test } from 'bun:test'
import { ConflictError, UnauthorizedError, ValidationError } from '#/shared/application/errors'
import { sha256Hex } from '#/shared/infrastructure/crypto'
import {
  FakeClock,
  InMemoryOutbox,
  PassthroughUnitOfWork,
  SequentialIds,
} from '#/shared/testing/fakes'
import { IdentityEvents } from '../contracts/events'
import type { Email } from '../domain/email'
import type { MagicLink } from '../domain/magic-link'
import { RefreshToken } from '../domain/refresh-token'
import type {
  MagicLinkRepository,
  RefreshTokenRepository,
  UserRepository,
} from '../domain/repositories'
import type { User } from '../domain/user'
import type { TokenService } from './ports'
import { SessionIssuer } from './session-issuer'
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
  async revokeFamily(familyId: string, now: Date) {
    for (const r of this.rows) if (r.token.familyId === familyId && !r.revokedAt) r.revokedAt = now
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
        { isAllowed: async () => allow },
        tokens,
        outbox,
        uow,
        ids,
        clock,
      ),
      verify: new VerifyMagicLink(links, users, sessions, tokens, outbox, uow, ids, clock),
      refresh: new RefreshSession(refresh, users, sessions, tokens, uow, ids, clock),
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
      await expect(
        uc.refresh.execute({ refreshToken: session.session.refreshToken, meta }),
      ).rejects.toBeInstanceOf(UnauthorizedError)
      await uc.refresh.execute({ refreshToken: next.session.refreshToken, meta }) // vẫn dùng được
    })

    test('reuse of a rotated token long after rotation is treated as theft: whole family revoked', async () => {
      const { uc, session } = await login()
      const next = await uc.refresh.execute({ refreshToken: session.session.refreshToken, meta })
      clock.advance(60_000)
      await expect(
        uc.refresh.execute({ refreshToken: session.session.refreshToken, meta }),
      ).rejects.toBeInstanceOf(UnauthorizedError)
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
})
