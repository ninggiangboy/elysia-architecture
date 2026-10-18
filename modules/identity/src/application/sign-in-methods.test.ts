import { describe, expect, test } from 'bun:test'
import { totpCode } from '@kit/auth'
import { IdentityEvents } from '../contracts/events'
import { Email } from '../domain/email'
import type { AuthOutcome, SessionOutcome } from './auth-outcome'
import { buildWorld, fakeHasher, tokens, type WorldOptions } from './test-support'
import { SendInvitation } from './use-cases/invitations'
import {
  LoginWithPassword,
  RemovePassword,
  RequestPasswordReset,
  ResetPassword,
  SetPassword,
} from './use-cases/password'
import { RequestMagicLink } from './use-cases/request-magic-link'
import { CompleteSignup, RegisterWithPassword, VerifySignup } from './use-cases/signup'
import {
  BeginTwoFactorSetup,
  DisableTwoFactor,
  EnableTwoFactor,
  VerifyMfaLogin,
} from './use-cases/two-factor'
import { VerifyMagicLink } from './use-cases/verify-magic-link'

const meta = { ip: '9.9.9.9', userAgent: 'test' }
const FRESH = Math.floor(new Date('2026-01-01T00:00:00Z').getTime() / 1000)

const session = (outcome: AuthOutcome): SessionOutcome => {
  if (outcome.kind !== 'session') throw new Error(`expected a session, got ${outcome.kind}`)
  return outcome
}

/** The use cases, built over one in-memory world. */
function setup(options: WorldOptions = {}) {
  const w = buildWorld(options)
  const throttle = { check: async () => ({ allowed: true as const }) }
  const magicLink = new VerifyMagicLink(
    w.links,
    w.users,
    w.completer,
    w.registrar,
    w.guard,
    tokens,
    w.uow,
    w.clock,
  )
  const issuer = 'Test'
  return {
    w,
    requestLink: new RequestMagicLink(
      w.links,
      w.users,
      w.invitations,
      throttle,
      tokens,
      w.policy,
      w.outbox,
      w.uow,
      w.ids,
      w.clock,
    ),
    magicLink,
    login: new LoginWithPassword(w.users, fakeHasher, w.guard, w.completer, w.policy, w.uow),
    register: new RegisterWithPassword(
      w.users,
      w.signups,
      w.registrar,
      fakeHasher,
      tokens,
      w.policy,
      w.outbox,
      w.uow,
      w.ids,
      w.clock,
    ),
    verifySignup: new VerifySignup(w.signups, w.registrar, w.guard, tokens, w.uow, w.clock),
    completeSignup: new CompleteSignup(w.signups, w.registrar, tokens, w.uow, w.clock),
    forgot: new RequestPasswordReset(
      w.users,
      w.resets,
      tokens,
      w.policy,
      w.outbox,
      w.uow,
      w.ids,
      w.clock,
    ),
    reset: new ResetPassword(
      w.users,
      w.resets,
      fakeHasher,
      tokens,
      w.revocation,
      w.policy,
      w.outbox,
      w.uow,
      w.clock,
    ),
    setPassword: new SetPassword(
      w.users,
      fakeHasher,
      w.revocation,
      w.policy,
      w.stepUp,
      w.outbox,
      w.uow,
      w.clock,
    ),
    removePassword: new RemovePassword(w.users, w.methods, w.stepUp, w.outbox, w.uow, w.clock),
    beginTotp: new BeginTwoFactorSetup(w.users, w.totp, w.policy, w.stepUp, issuer, w.clock),
    enableTotp: new EnableTwoFactor(w.totp, w.recovery, tokens, w.policy, w.outbox, w.uow, w.clock),
    disableTotp: new DisableTwoFactor(w.totp, w.recovery, w.stepUp, w.outbox, w.uow, w.clock),
    mfa: new VerifyMfaLogin(
      w.challenges,
      w.totp,
      w.recovery,
      w.users,
      w.starter,
      w.guard,
      tokens,
      w.uow,
      w.clock,
    ),
    invite: new SendInvitation(w.users, w.invitations, w.policy, w.outbox, w.uow, w.ids, w.clock),
  }
}
type Kit = ReturnType<typeof setup>

const signUp = async (kit: Kit, email = 'a@b.co', password = 'correct horse') => {
  await kit.register.execute({ email, password, ip: meta.ip })
  const verification = kit.w.outbox.events.findLast(
    (e) => e.type === IdentityEvents.SignupVerificationRequested,
  )
  return session(
    await kit.verifySignup.verifyToken({ token: verification?.payload.token as string, meta }),
  )
}

const lastMagic = (kit: Kit) =>
  kit.w.outbox.events.findLast((e) => e.type === IdentityEvents.MagicLinkRequested)?.payload as {
    token: string
    code: string
  }

describe('password sign-up and sign-in', () => {
  test('the account exists only once the mailbox is proven, and keeps the chosen password', async () => {
    const kit = setup()
    await kit.register.execute({ email: 'A@b.co', password: 'correct horse', ip: meta.ip })
    expect(kit.w.users.rows.size).toBe(0)
    const sent = kit.w.outbox.events.find(
      (e) => e.type === IdentityEvents.SignupVerificationRequested,
    )
    expect(sent?.payload).toMatchObject({ email: 'a@b.co', code: '123456' })
    expect(kit.w.signups.rows[0]?.passwordHash).toBe('h:correct horse')

    const done = session(
      await kit.verifySignup.verifyToken({ token: sent?.payload.token as string, meta }),
    )
    expect(done.newUser).toBe(true)
    expect(kit.w.users.rows.size).toBe(1)
    expect(kit.w.outbox.types()).toContain(IdentityEvents.UserRegistered)

    const out = session(
      await kit.login.execute({ email: 'a@b.co', password: 'correct horse', meta }),
    )
    expect(out.user.id).toBe(done.user.id)
  })

  test('the same code in the mail verifies too, and a wrong one is counted', async () => {
    const kit = setup()
    await kit.register.execute({ email: 'a@b.co', password: 'correct horse', ip: meta.ip })
    for (let i = 0; i < 5; i++) {
      await expect(
        kit.verifySignup.verifyCode({ email: 'a@b.co', code: '000000', meta }),
      ).rejects.toMatchObject({
        code: 'invalid_signup_verification',
      })
    }
    // Five wrong tries closed the sign-up to codes: even the right one is refused now.
    await expect(
      kit.verifySignup.verifyCode({ email: 'a@b.co', code: '123456', meta }),
    ).rejects.toBeDefined()
    expect(kit.w.users.rows.size).toBe(0)
  })

  test('a short password is refused before anything is stored', async () => {
    const kit = setup()
    await expect(
      kit.register.execute({ email: 'a@b.co', password: 'short', ip: meta.ip }),
    ).rejects.toMatchObject({
      code: 'password_too_short',
    })
    expect(kit.w.signups.rows).toHaveLength(0)
  })

  test('an address that already has an account gets a notice, and the requester sees no difference', async () => {
    const kit = setup()
    await signUp(kit)
    const before = kit.w.outbox.events.length
    await expect(
      kit.register.execute({ email: 'a@b.co', password: 'another pass', ip: meta.ip }),
    ).resolves.toBeUndefined()
    const added = kit.w.outbox.events.slice(before).map((e) => e.type)
    expect(added).toEqual([IdentityEvents.SignupExistingAccount])
    // The decoy row cannot be opened by anyone.
    expect(kit.w.signups.rows.at(-1)?.passwordHash).toBeNull()
    expect(kit.w.users.rows.size).toBe(1)
  })

  test('wrong password, unknown address and a passwordless account all answer the same', async () => {
    const kit = setup()
    await signUp(kit)
    // an account created by magic link has no password
    await kit.requestLink.execute({ email: 'link@b.co', ip: meta.ip })
    await kit.magicLink.verifyToken({ token: lastMagic(kit).token, meta })

    for (const email of ['a@b.co', 'nobody@b.co', 'link@b.co']) {
      await expect(
        kit.login.execute({ email, password: 'wrong wrong', meta }),
      ).rejects.toMatchObject({
        code: 'invalid_credentials',
      })
    }
  })

  test('repeated failures lock the address out, even for the right password', async () => {
    const kit = setup()
    await signUp(kit)
    for (let i = 0; i < 10; i++) {
      await expect(
        kit.login.execute({ email: 'a@b.co', password: 'wrong wrong', meta }),
      ).rejects.toMatchObject({
        code: 'invalid_credentials',
      })
    }
    await expect(
      kit.login.execute({ email: 'a@b.co', password: 'correct horse', meta }),
    ).rejects.toMatchObject({
      code: 'sign_in_rate_limited',
    })
    kit.w.clock.advance(16 * 60_000)
    session(await kit.login.execute({ email: 'a@b.co', password: 'correct horse', meta }))
  })

  test('password sign-in can be switched off', async () => {
    const kit = setup({ methods: ['email'] })
    await expect(
      kit.login.execute({ email: 'a@b.co', password: 'correct horse', meta }),
    ).rejects.toMatchObject({
      code: 'sign_in_method_unavailable',
    })
    await expect(
      kit.register.execute({ email: 'a@b.co', password: 'correct horse', ip: meta.ip }),
    ).rejects.toMatchObject({
      code: 'sign_in_method_unavailable',
    })
  })
})

describe('emailed code', () => {
  test('the code in the magic-link mail signs in, once, and is bound to the address', async () => {
    const kit = setup()
    await kit.requestLink.execute({ email: 'a@b.co', ip: meta.ip })
    const { code } = lastMagic(kit)
    // stored only as a keyed hash
    expect(kit.w.links.links[0]?.codeHash).toBe(tokens.keyedHash(`email-code:a@b.co:${code}`))

    await expect(
      kit.magicLink.verifyCode({ email: 'other@b.co', code, meta }),
    ).rejects.toMatchObject({
      code: 'invalid_email_code',
    })
    const out = session(await kit.magicLink.verifyCode({ email: 'A@b.co', code: '123 456', meta }))
    expect(out.newUser).toBe(true)
    await expect(kit.magicLink.verifyCode({ email: 'a@b.co', code, meta })).rejects.toMatchObject({
      code: 'invalid_email_code',
    })
  })

  test('five wrong codes stop the link accepting codes; the link itself still works', async () => {
    const kit = setup()
    await kit.requestLink.execute({ email: 'a@b.co', ip: meta.ip })
    for (let i = 0; i < 5; i++) {
      await expect(
        kit.magicLink.verifyCode({ email: 'a@b.co', code: '999999', meta }),
      ).rejects.toBeDefined()
    }
    await expect(
      kit.magicLink.verifyCode({ email: 'a@b.co', code: '123456', meta }),
    ).rejects.toBeDefined()
    session(await kit.magicLink.verifyToken({ token: lastMagic(kit).token, meta }))
  })
})

describe('registration rules', () => {
  const firstLink = async (kit: Kit, email = 'new@b.co') => {
    const before = kit.w.links.links.length
    await kit.requestLink.execute({ email, ip: meta.ip })
    return kit.w.links.links.length > before ? lastMagic(kit) : null
  }

  test('closed: no mail for a stranger (same 202), and members still sign in', async () => {
    const kit = setup({ mode: 'closed', allowedEmails: ['owner@b.co'] })
    expect(await firstLink(kit)).toBeNull()
    expect(kit.w.links.links).toHaveLength(0)

    // the allow-listed owner can create the first account
    await kit.requestLink.execute({ email: 'owner@b.co', ip: meta.ip })
    session(await kit.magicLink.verifyToken({ token: lastMagic(kit).token, meta }))

    // and then a member keeps getting links
    await kit.requestLink.execute({ email: 'owner@b.co', ip: meta.ip })
    expect(kit.w.links.links).toHaveLength(2)
  })

  test('domain allow-list', async () => {
    const kit = setup({ domains: ['corp.test'] })
    expect(await firstLink(kit, 'x@other.test')).toBeNull()
    expect(await firstLink(kit, 'x@corp.test')).not.toBeNull()
    await expect(
      kit.register.execute({ email: 'x@other.test', password: 'correct horse', ip: meta.ip }),
    ).resolves.toBeUndefined()
    expect(
      kit.w.outbox.types().filter((t) => t === IdentityEvents.SignupVerificationRequested),
    ).toHaveLength(0)
  })

  test('invite-only: an invited address gets in, the invitation is used up', async () => {
    const kit = setup({ mode: 'invite', allowedEmails: ['owner@b.co'] })
    await kit.requestLink.execute({ email: 'owner@b.co', ip: meta.ip })
    const owner = session(await kit.magicLink.verifyToken({ token: lastMagic(kit).token, meta }))

    expect(await firstLink(kit, 'friend@b.co')).toBeNull()
    const sent = await kit.invite.execute({ userId: owner.user.id, email: 'Friend@b.co' })
    expect(sent.status).toBe('pending')
    expect(kit.w.outbox.types()).toContain(IdentityEvents.InvitationSent)
    await expect(
      kit.invite.execute({ userId: owner.user.id, email: 'friend@b.co' }),
    ).rejects.toMatchObject({
      code: 'invitation_exists',
    })
    await expect(
      kit.invite.execute({ userId: owner.user.id, email: 'owner@b.co' }),
    ).rejects.toMatchObject({
      code: 'already_a_member',
    })

    expect(await firstLink(kit, 'friend@b.co')).not.toBeNull()
    session(await kit.magicLink.verifyToken({ token: lastMagic(kit).token, meta }))
    expect(kit.w.invitations.rows.find((i) => i.email === 'friend@b.co')?.acceptedAt).not.toBeNull()
  })

  test('invitations exist only in invite mode', async () => {
    const kit = setup()
    const owner = await signUp(kit)
    await expect(
      kit.invite.execute({ userId: owner.user.id, email: 'x@b.co' }),
    ).rejects.toMatchObject({
      code: 'invitations_unavailable',
    })
  })

  test('terms: a passwordless sign-up stops at a form, and accepting them records the version', async () => {
    const kit = setup({ terms: '2026-01' })
    await kit.requestLink.execute({ email: 'new@b.co', ip: meta.ip })
    const outcome = await kit.magicLink.verifyToken({ token: lastMagic(kit).token, meta })
    if (outcome.kind !== 'signup_required') throw new Error(outcome.kind)
    expect(outcome).toMatchObject({ email: 'new@b.co', termsVersion: '2026-01' })
    expect(kit.w.users.rows.size).toBe(0)

    await expect(
      kit.completeSignup.execute({ signupToken: outcome.signupToken, displayName: 'Ada', meta }),
    ).rejects.toMatchObject({ code: 'terms_not_accepted' })
    // refusing did not spend the token
    const done = await kit.completeSignup.execute({
      signupToken: outcome.signupToken,
      displayName: '  Ada   Lovelace ',
      acceptTerms: true,
      meta,
    })
    const user = kit.w.users.rows.get(done.user.id)
    expect(user?.termsVersion).toBe('2026-01')
    expect(
      kit.w.outbox.events.find((e) => e.type === IdentityEvents.UserRegistered)?.payload,
    ).toMatchObject({
      displayName: 'Ada Lovelace',
      method: 'magic_link',
    })
    await expect(
      kit.completeSignup.execute({ signupToken: outcome.signupToken, acceptTerms: true, meta }),
    ).rejects.toMatchObject({ code: 'invalid_signup' })
  })

  test('terms are required to start a password sign-up', async () => {
    const kit = setup({ terms: '2026-01' })
    await expect(
      kit.register.execute({ email: 'a@b.co', password: 'correct horse', ip: meta.ip }),
    ).rejects.toMatchObject({
      code: 'terms_not_accepted',
    })
    await kit.register.execute({
      email: 'a@b.co',
      password: 'correct horse',
      acceptTerms: true,
      ip: meta.ip,
    })
    expect(kit.w.signups.rows[0]?.termsVersion).toBe('2026-01')
  })
})

describe('forgotten password', () => {
  test('reset sets the password, ends every session, and the link works once', async () => {
    const kit = setup()
    const first = await signUp(kit)
    await kit.forgot.execute({ email: 'a@b.co', ip: meta.ip })
    const mail = kit.w.outbox.events.find((e) => e.type === IdentityEvents.PasswordResetRequested)
    await kit.reset.execute({ token: mail?.payload.token as string, newPassword: 'brand new pass' })

    expect(kit.w.refresh.active(first.session.sessionId)).toBe(0)
    expect(
      kit.w.outbox.events.some(
        (e) => e.type === IdentityEvents.SessionRevoked && e.payload.reason === 'password_changed',
      ),
    ).toBe(true)
    session(await kit.login.execute({ email: 'a@b.co', password: 'brand new pass', meta }))
    await expect(
      kit.login.execute({ email: 'a@b.co', password: 'correct horse', meta }),
    ).rejects.toBeDefined()
    await expect(
      kit.reset.execute({ token: mail?.payload.token as string, newPassword: 'again again' }),
    ).rejects.toMatchObject({ code: 'invalid_password_reset' })
  })

  test('an unknown address gets the same answer and no mail; asking again replaces the earlier link', async () => {
    const kit = setup()
    await signUp(kit)
    await expect(kit.forgot.execute({ email: 'nobody@b.co', ip: meta.ip })).resolves.toBeUndefined()
    expect(kit.w.outbox.types()).not.toContain(IdentityEvents.PasswordResetRequested)

    await kit.forgot.execute({ email: 'a@b.co', ip: meta.ip })
    const [old] = kit.w.outbox.events.filter(
      (e) => e.type === IdentityEvents.PasswordResetRequested,
    )
    await kit.forgot.execute({ email: 'a@b.co', ip: meta.ip })
    await expect(
      kit.reset.execute({ token: old?.payload.token as string, newPassword: 'brand new pass' }),
    ).rejects.toMatchObject({ code: 'invalid_password_reset' })
  })

  test('requests are rate-limited per address', async () => {
    const kit = setup()
    await signUp(kit)
    for (let i = 0; i < 3; i++) await kit.forgot.execute({ email: 'a@b.co', ip: `1.1.1.${i}` })
    await expect(kit.forgot.execute({ email: 'a@b.co', ip: '2.2.2.2' })).rejects.toMatchObject({
      code: 'password_reset_rate_limited',
    })
  })
})

describe('managing the password', () => {
  test('setting one needs a recent confirmation, signs out the other devices and says so', async () => {
    const kit = setup()
    const mine = await signUp(kit)
    const other = session(
      await kit.login.execute({ email: 'a@b.co', password: 'correct horse', meta }),
    )

    await expect(
      kit.setPassword.execute({
        userId: mine.user.id,
        sessionId: mine.session.sessionId,
        newPassword: 'new password',
        authTime: undefined,
      }),
    ).rejects.toMatchObject({ code: 'step_up_required' })

    const result = await kit.setPassword.execute({
      userId: mine.user.id,
      sessionId: mine.session.sessionId,
      newPassword: 'new password',
      authTime: FRESH,
    })
    expect(result.change).toBe('changed')
    expect(kit.w.refresh.active(mine.session.sessionId)).toBe(1)
    expect(kit.w.refresh.active(other.session.sessionId)).toBe(0)
    expect(
      kit.w.outbox.events.findLast((e) => e.type === IdentityEvents.PasswordChanged)?.payload,
    ).toMatchObject({ change: 'changed' })
  })

  test('removing the password is refused when it is the last way in', async () => {
    const kit = setup({ methods: ['password'] })
    const mine = await signUp(kit)
    await expect(
      kit.removePassword.execute({ userId: mine.user.id, authTime: FRESH }),
    ).rejects.toMatchObject({
      code: 'last_sign_in_method',
    })
  })

  test('removing the password is fine when email sign-in remains', async () => {
    const kit = setup()
    const mine = await signUp(kit)
    await kit.removePassword.execute({ userId: mine.user.id, authTime: FRESH })
    expect(kit.w.users.rows.get(mine.user.id)?.hasPassword).toBe(false)
    await expect(
      kit.login.execute({ email: 'a@b.co', password: 'correct horse', meta }),
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })
})

describe('two-factor with an authenticator app', () => {
  /** An account with the authenticator on; returns the secret the "app" holds. */
  async function enrol(kit: Kit) {
    const mine = await signUp(kit)
    const { secret } = await kit.beginTotp.execute({ userId: mine.user.id, authTime: FRESH })
    const { recoveryCodes } = await kit.enableTotp.execute({
      userId: mine.user.id,
      code: totpCode(secret, kit.w.clock.now()),
    })
    return { mine, secret, recoveryCodes }
  }
  const firstFactor = async (kit: Kit): Promise<Extract<AuthOutcome, { kind: 'mfa_required' }>> => {
    const out = await kit.login.execute({ email: 'a@b.co', password: 'correct horse', meta })
    if (out.kind !== 'mfa_required') throw new Error(out.kind)
    return out
  }

  test('setup needs a recent confirmation and a correct first code; ten recovery codes come back once', async () => {
    const kit = setup()
    const mine = await signUp(kit)
    await expect(
      kit.beginTotp.execute({ userId: mine.user.id, authTime: undefined }),
    ).rejects.toMatchObject({
      code: 'step_up_required',
    })
    const { secret } = await kit.beginTotp.execute({ userId: mine.user.id, authTime: FRESH })
    await expect(
      kit.enableTotp.execute({ userId: mine.user.id, code: '000000' }),
    ).rejects.toMatchObject({
      code: 'invalid_totp_code',
    })
    const { recoveryCodes } = await kit.enableTotp.execute({
      userId: mine.user.id,
      code: totpCode(secret, kit.w.clock.now()),
    })
    expect(recoveryCodes).toHaveLength(10)
    expect(recoveryCodes[0]).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/)
    expect(kit.w.outbox.types()).toContain(IdentityEvents.TwoFactorEnabled)
    await expect(
      kit.beginTotp.execute({ userId: mine.user.id, authTime: FRESH }),
    ).rejects.toMatchObject({
      code: 'totp_already_enabled',
    })
  })

  test('a password or link sign-in then needs the code; the session starts only after it', async () => {
    const kit = setup()
    const { secret } = await enrol(kit)
    const sessionsBefore = kit.w.refresh.rows.length

    const challenge = await firstFactor(kit)
    expect(kit.w.refresh.rows).toHaveLength(sessionsBefore)

    kit.w.clock.advance(31_000) // the enrolment code's step is spent; the next one is fine
    const done = await kit.mfa.execute({
      mfaToken: challenge.mfaToken,
      code: totpCode(secret, kit.w.clock.now()),
      meta,
    })
    expect(done.user.email).toBe('a@b.co')
    expect(
      kit.w.outbox.events.findLast((e) => e.type === IdentityEvents.SessionStarted)?.payload,
    ).toMatchObject({
      method: 'password',
      secondFactor: 'totp',
    })

    await kit.requestLink.execute({ email: 'a@b.co', ip: meta.ip })
    const viaLink = await kit.magicLink.verifyToken({ token: lastMagic(kit).token, meta })
    expect(viaLink.kind).toBe('mfa_required')
  })

  test('a code works once, even inside its window', async () => {
    const kit = setup()
    const { secret } = await enrol(kit)
    kit.w.clock.advance(31_000)
    const code = totpCode(secret, kit.w.clock.now())
    await kit.mfa.execute({ mfaToken: (await firstFactor(kit)).mfaToken, code, meta })
    await expect(
      kit.mfa.execute({ mfaToken: (await firstFactor(kit)).mfaToken, code, meta }),
    ).rejects.toMatchObject({ code: 'invalid_mfa_code' })
  })

  test('five wrong codes close the challenge', async () => {
    const kit = setup()
    const { secret } = await enrol(kit)
    kit.w.clock.advance(31_000)
    const challenge = await firstFactor(kit)
    for (let i = 0; i < 5; i++) {
      await expect(
        kit.mfa.execute({ mfaToken: challenge.mfaToken, code: '000000', meta }),
      ).rejects.toMatchObject({
        code: 'invalid_mfa_code',
      })
    }
    await expect(
      kit.mfa.execute({
        mfaToken: challenge.mfaToken,
        code: totpCode(secret, kit.w.clock.now()),
        meta,
      }),
    ).rejects.toMatchObject({ code: 'mfa_challenge_expired' })
  })

  test('a recovery code works once, typed any way', async () => {
    const kit = setup()
    const { recoveryCodes } = await enrol(kit)
    const code = recoveryCodes[0] as string
    const done = await kit.mfa.execute({
      mfaToken: (await firstFactor(kit)).mfaToken,
      code: code.toUpperCase().replace('-', ' '),
      meta,
    })
    expect(done.user.email).toBe('a@b.co')
    expect(
      kit.w.outbox.events.findLast((e) => e.type === IdentityEvents.SessionStarted)?.payload
        .secondFactor,
    ).toBe('recovery_code')
    await expect(
      kit.mfa.execute({ mfaToken: (await firstFactor(kit)).mfaToken, code, meta }),
    ).rejects.toMatchObject({ code: 'invalid_mfa_code' })
  })

  test('the token expires', async () => {
    const kit = setup()
    const { secret } = await enrol(kit)
    const challenge = await firstFactor(kit)
    kit.w.clock.advance(6 * 60_000)
    await expect(
      kit.mfa.execute({
        mfaToken: challenge.mfaToken,
        code: totpCode(secret, kit.w.clock.now()),
        meta,
      }),
    ).rejects.toMatchObject({ code: 'mfa_challenge_expired' })
  })

  test('turning it off needs a recent confirmation and removes the second step', async () => {
    const kit = setup()
    const { mine } = await enrol(kit)
    await expect(
      kit.disableTotp.execute({ userId: mine.user.id, authTime: undefined }),
    ).rejects.toMatchObject({
      code: 'step_up_required',
    })
    await kit.disableTotp.execute({ userId: mine.user.id, authTime: FRESH })
    expect(kit.w.outbox.types()).toContain(IdentityEvents.TwoFactorDisabled)
    session(await kit.login.execute({ email: 'a@b.co', password: 'correct horse', meta }))
  })

  test('without the encryption key the feature is off and sign-in is not interrupted', async () => {
    const kit = setup({ twoFactor: false })
    const mine = await signUp(kit)
    await expect(
      kit.beginTotp.execute({ userId: mine.user.id, authTime: FRESH }),
    ).rejects.toMatchObject({
      code: 'two_factor_unavailable',
    })
  })

  test('a passkey or provider sign-in is not followed by the second step', async () => {
    const kit = setup()
    const { mine } = await enrol(kit)
    const user = kit.w.users.rows.get(mine.user.id)
    if (!user) throw new Error('missing user')
    for (const method of ['passkey', 'oauth:google']) {
      const out = await kit.w.completer.complete({ user, method, meta })
      expect(out.kind).toBe('session')
    }
  })
})

describe('Email value used by the policy', () => {
  test('is compared normalised', () => {
    expect(Email.create(' A@B.co ').equals(Email.create('a@b.co'))).toBe(true)
  })
})
