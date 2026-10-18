import { StepUpPolicy, sha256Hex } from '@kit/auth'
import { ConflictError, VersionConflictError } from '@kit/core'
import { FakeClock, InMemoryOutbox, PassthroughUnitOfWork, SequentialIds } from '@kit/testing'
import type { Email } from '../domain/email'
import type { Invitation } from '../domain/invitation'
import type { MagicLink } from '../domain/magic-link'
import type { OAuthAccount } from '../domain/oauth-account'
import type { PasswordReset } from '../domain/password'
import { type DeviceSession, RefreshToken } from '../domain/refresh-token'
import { RegistrationPolicy } from '../domain/registration-policy'
import type {
  InvitationRepository,
  MagicLinkRepository,
  MfaChallengeRepository,
  OAuthAccountRepository,
  PasskeyRepository,
  PasswordResetRepository,
  RecoveryCodeRepository,
  RefreshTokenRepository,
  SignInFailureRepository,
  SignupRepository,
  ThrottleScope,
  TotpCredentialRepository,
  UserRepository,
  WindowCount,
} from '../domain/repositories'
import type { Signup } from '../domain/signup'
import type { MfaChallenge, TotpCredential } from '../domain/two-factor'
import type { User } from '../domain/user'
import { AccountRegistrar } from './account-registrar'
import { AuthPolicy } from './auth-policy'
import type { PasswordHasher, TokenService } from './ports'
import { SessionIssuer } from './session-issuer'
import { SessionRevocation } from './session-revocation'
import { SessionStarter } from './session-starter'
import { SignInCompleter } from './sign-in-completer'
import { SignInGuard } from './sign-in-guard'
import { SignInMethodGuard } from './sign-in-method-guard'

export class MemUsers implements UserRepository {
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

export class MemMagicLinks implements MagicLinkRepository {
  links: (MagicLink & { used?: boolean; attempts?: number })[] = []
  async add(link: MagicLink) {
    this.links.push(link)
  }
  async consumeByCode(email: Email, codeHash: string, now: Date, maxAttempts: number) {
    const live = this.links.filter(
      (l) =>
        l.email.equals(email) && !l.used && l.expiresAt > now && (l.attempts ?? 0) < maxAttempts,
    )
    const hit = live.find((l) => l.codeHash === codeHash)
    if (hit) {
      hit.used = true
      return hit
    }
    for (const l of live) l.attempts = (l.attempts ?? 0) + 1
    return null
  }
  async consume(hash: string, now: Date) {
    const link = this.links.find((l) => l.tokenHash === hash && !l.used && l.expiresAt > now)
    if (!link) return null
    link.used = true
    return link
  }
}

export class MemRefreshTokens implements RefreshTokenRepository {
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
  async revokeAllSessions(userId: string, now: Date) {
    const rows = this.live(userId, now)
    for (const r of rows) r.revokedAt = now
    return [...new Set(rows.map((r) => r.token.familyId))]
  }
  active(familyId: string) {
    return this.rows.filter((r) => r.token.familyId === familyId && !r.revokedAt).length
  }
}

const within = (rows: { createdAt: Date }[], since: Date): WindowCount => {
  const recent = rows.filter((r) => r.createdAt >= since)
  const oldest = recent.map((r) => r.createdAt.getTime()).sort((x, y) => x - y)[0]
  return { count: recent.length, oldest: oldest === undefined ? null : new Date(oldest) }
}

class MemSignups implements SignupRepository {
  rows: (Signup & { consumed?: boolean; attempts?: number })[] = []
  async add(signup: Signup) {
    this.rows.push({ ...signup })
  }
  async consume(tokenHash: string, now: Date) {
    const row = this.rows.find((r) => r.tokenHash === tokenHash && !r.consumed && r.expiresAt > now)
    if (!row) return null
    row.consumed = true
    return row
  }
  async consumeByCode(email: Email, codeHash: string, now: Date, maxAttempts: number) {
    const live = this.rows.filter(
      (r) =>
        r.email === email.value &&
        !r.consumed &&
        !r.emailProvenAt &&
        r.expiresAt > now &&
        (r.attempts ?? 0) < maxAttempts,
    )
    const hit = live.find((r) => r.codeHash === codeHash)
    if (hit) {
      hit.consumed = true
      return hit
    }
    for (const r of live) r.attempts = (r.attempts ?? 0) + 1
    return null
  }
  async startedSince(scope: ThrottleScope, since: Date) {
    return within(
      this.rows.filter(
        (r) =>
          !r.emailProvenAt &&
          ('email' in scope ? r.email === scope.email : r.requestedIp === scope.ip),
      ),
      since,
    )
  }
}

class MemPasswordResets implements PasswordResetRepository {
  rows: (PasswordReset & { consumed?: boolean })[] = []
  async issue(reset: PasswordReset) {
    for (const r of this.rows) if (r.userId === reset.userId) r.consumed = true
    this.rows.push({ ...reset })
  }
  async consume(tokenHash: string, now: Date) {
    const row = this.rows.find((r) => r.tokenHash === tokenHash && !r.consumed && r.expiresAt > now)
    if (!row) return null
    row.consumed = true
    return row
  }
  async requestedSince(scope: ThrottleScope, since: Date) {
    return within(
      this.rows.filter((r) =>
        'email' in scope ? r.email === scope.email : r.requestedIp === scope.ip,
      ),
      since,
    )
  }
}

class MemFailures implements SignInFailureRepository {
  rows: { email: string; ip: string; createdAt: Date }[] = []
  async record(f: { email: string; ip: string; at: Date }) {
    this.rows.push({ email: f.email, ip: f.ip, createdAt: f.at })
  }
  async since(scope: ThrottleScope, since: Date) {
    return within(
      this.rows.filter((r) => ('email' in scope ? r.email === scope.email : r.ip === scope.ip)),
      since,
    )
  }
}

class MemTotp implements TotpCredentialRepository {
  rows = new Map<string, TotpCredential>()
  async find(userId: string) {
    return this.rows.get(userId) ?? null
  }
  async savePending(credential: TotpCredential) {
    if (this.rows.get(credential.userId)?.confirmed) throw new ConflictError('totp_already_enabled')
    credential.version = 1
    this.rows.set(credential.userId, credential)
  }
  async saveUse(credential: TotpCredential) {
    const stored = this.rows.get(credential.userId)
    if (!stored || stored.version !== credential.version) throw new VersionConflictError()
    credential.version += 1
    this.rows.set(credential.userId, credential)
  }
  async remove(userId: string) {
    return this.rows.delete(userId)
  }
}

class MemRecovery implements RecoveryCodeRepository {
  rows: { userId: string; codeHash: string; used: boolean }[] = []
  async replace(userId: string, hashes: string[]) {
    this.rows = this.rows.filter((r) => r.userId !== userId)
    for (const codeHash of hashes) this.rows.push({ userId, codeHash, used: false })
  }
  async consume(userId: string, codeHash: string) {
    const row = this.rows.find((r) => r.userId === userId && r.codeHash === codeHash && !r.used)
    if (!row) return false
    row.used = true
    return true
  }
  async remaining(userId: string) {
    return this.rows.filter((r) => r.userId === userId && !r.used).length
  }
  async removeAll(userId: string) {
    this.rows = this.rows.filter((r) => r.userId !== userId)
  }
}

class MemChallenges implements MfaChallengeRepository {
  rows: (MfaChallenge & { attempts: number; consumed?: boolean })[] = []
  async add(challenge: MfaChallenge) {
    this.rows.push({ ...challenge, attempts: 0 })
  }
  async findLive(tokenHash: string, now: Date, maxAttempts: number) {
    return (
      this.rows.find(
        (r) =>
          r.tokenHash === tokenHash && !r.consumed && r.expiresAt > now && r.attempts < maxAttempts,
      ) ?? null
    )
  }
  async recordFailure(id: string) {
    const row = this.rows.find((r) => r.id === id)
    if (row) row.attempts += 1
  }
  async consume(id: string) {
    const row = this.rows.find((r) => r.id === id && !r.consumed)
    if (!row) return false
    row.consumed = true
    return true
  }
}

class MemInvitations implements InvitationRepository {
  rows: Invitation[] = []
  async add(invitation: Invitation) {
    this.rows.push({ ...invitation })
  }
  private pending(email: string, now: Date) {
    return this.rows.filter(
      (i) => i.email === email && !i.acceptedAt && !i.revokedAt && i.expiresAt > now,
    )
  }
  async hasPending(email: Email, now: Date) {
    return this.pending(email.value, now).length > 0
  }
  async accept(email: Email, now: Date) {
    for (const i of this.pending(email.value, now)) i.acceptedAt = now
  }
  async listByInviter(userId: string) {
    return this.rows.filter((i) => i.invitedBy === userId)
  }
  async sentSince(userId: string, since: Date) {
    return within(
      this.rows.filter((i) => i.invitedBy === userId),
      since,
    )
  }
  async revoke(userId: string, id: string, now: Date) {
    const row = this.rows.find(
      (i) => i.id === id && i.invitedBy === userId && !i.acceptedAt && !i.revokedAt,
    )
    if (!row) return false
    row.revokedAt = now
    return true
  }
}

class MemOAuthAccounts implements OAuthAccountRepository {
  rows: OAuthAccount[] = []
  async add(account: OAuthAccount) {
    this.rows.push(account)
  }
  async findByProviderUser(provider: string, providerUserId: string) {
    return (
      this.rows.find((a) => a.provider === provider && a.providerUserId === providerUserId) ?? null
    )
  }
  async listByUser(userId: string) {
    return this.rows.filter((a) => a.userId === userId)
  }
  async remove(userId: string, provider: string) {
    const before = this.rows.length
    this.rows = this.rows.filter((a) => !(a.userId === userId && a.provider === provider))
    return this.rows.length < before
  }
}

class MemPasskeys implements Pick<PasskeyRepository, 'listByUser'> {
  rows: { userId: string }[] = []
  async listByUser(userId: string) {
    return this.rows.filter((p) => p.userId === userId) as never
  }
}

/** Fast and transparent: `h:<plain>`. */
export const fakeHasher: PasswordHasher = {
  hash: async (plain) => `h:${plain}`,
  verify: async (plain, hash) => hash === `h:${plain}`,
}

let seq = 0
export const tokens: TokenService = {
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

export interface WorldOptions {
  methods?: ('email' | 'password' | 'passkey')[]
  mode?: 'open' | 'invite' | 'closed'
  domains?: string[]
  terms?: string
  allowedEmails?: string[]
  twoFactor?: boolean
}

/** Every repository in memory, and the services built on them, wired the way the module does. */
export function buildWorld(options: WorldOptions = {}) {
  const w = {
    users: new MemUsers(),
    links: new MemMagicLinks(),
    refresh: new MemRefreshTokens(),
    signups: new MemSignups(),
    resets: new MemPasswordResets(),
    failures: new MemFailures(),
    totp: new MemTotp(),
    recovery: new MemRecovery(),
    challenges: new MemChallenges(),
    invitations: new MemInvitations(),
    oauthAccounts: new MemOAuthAccounts(),
    passkeys: new MemPasskeys(),
    outbox: new InMemoryOutbox(),
    clock: new FakeClock(),
    ids: new SequentialIds(),
    uow: new PassthroughUnitOfWork(),
  }
  const policy = new AuthPolicy(
    new Set(options.methods ?? ['email', 'password', 'passkey']),
    new RegistrationPolicy(
      options.mode ?? 'open',
      options.domains,
      options.terms,
      options.allowedEmails,
    ),
    8,
    options.twoFactor ?? true,
    undefined,
  )
  const sessions = new SessionIssuer(w.refresh, tokens, w.ids, w.clock, 3600)
  const starter = new SessionStarter(sessions, w.outbox, w.clock)
  const completer = new SignInCompleter(
    starter,
    w.totp,
    w.challenges,
    tokens,
    policy,
    w.ids,
    w.clock,
  )
  const registrar = new AccountRegistrar(
    w.users,
    w.oauthAccounts,
    w.invitations,
    w.signups,
    starter,
    policy,
    tokens,
    w.outbox,
    w.ids,
    w.clock,
  )
  const guard = new SignInGuard(w.failures, w.ids, w.clock)
  const methods = new SignInMethodGuard(
    w.users,
    w.passkeys as unknown as PasskeyRepository,
    w.oauthAccounts,
    policy,
  )
  const revocation = new SessionRevocation(w.refresh, w.outbox, w.clock)
  const stepUp = new StepUpPolicy(w.clock, 300)
  return {
    ...w,
    policy,
    sessions,
    starter,
    completer,
    registrar,
    guard,
    methods,
    revocation,
    stepUp,
  }
}
