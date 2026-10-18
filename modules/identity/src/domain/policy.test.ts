import { describe, expect, test } from 'bun:test'
import { Email } from './email'
import { assertAcceptablePassword } from './password'
import { RegistrationPolicy } from './registration-policy'
import { assertKeepsASignInMethod } from './sign-in-methods'
import {
  looksLikeTotpCode,
  newRecoveryCode,
  normalizeRecoveryCode,
  TotpCredential,
} from './two-factor'
import { User } from './user'

const e = Email.create

describe('RegistrationPolicy', () => {
  const code = (fn: () => void) => {
    try {
      fn()
      return 'ok'
    } catch (err) {
      return (err as { code: string }).code
    }
  }

  test('open lets anyone in; closed nobody but the allow-listed; invite needs an invitation', () => {
    expect(
      code(() =>
        new RegistrationPolicy('open', undefined, undefined).assertMayRegister(e('a@b.co'), false),
      ),
    ).toBe('ok')
    const closed = new RegistrationPolicy('closed', undefined, undefined, ['owner@b.co'])
    expect(code(() => closed.assertMayRegister(e('a@b.co'), true))).toBe('registration_closed')
    expect(code(() => closed.assertMayRegister(e('Owner@b.co'), false))).toBe('ok')
    const invite = new RegistrationPolicy('invite', undefined, undefined)
    expect(code(() => invite.assertMayRegister(e('a@b.co'), false))).toBe(
      'registration_invite_only',
    )
    expect(code(() => invite.assertMayRegister(e('a@b.co'), true))).toBe('ok')
  })

  test('domains apply on top of the mode', () => {
    const p = new RegistrationPolicy('open', ['corp.test'], undefined)
    expect(code(() => p.assertMayRegister(e('a@corp.test'), false))).toBe('ok')
    expect(code(() => p.assertMayRegister(e('a@evil.test'), false))).toBe(
      'registration_domain_not_allowed',
    )
    expect(code(() => p.assertMayRegister(e('a@sub.corp.test'), false))).toBe(
      'registration_domain_not_allowed',
    )
  })

  test('terms are recorded by version, and required only when there are any', () => {
    expect(new RegistrationPolicy('open', undefined, undefined).acceptedTerms(false)).toBeNull()
    const p = new RegistrationPolicy('open', undefined, 'v3')
    expect(p.acceptedTerms(true)).toBe('v3')
    expect(code(() => p.acceptedTerms(false))).toBe('terms_not_accepted')
    expect(code(() => p.acceptedTerms(undefined))).toBe('terms_not_accepted')
  })
})

describe('passwords', () => {
  test('length is the only rule, counted in characters', () => {
    expect(() => assertAcceptablePassword('abcdefgh', 8)).not.toThrow()
    expect(() => assertAcceptablePassword('abcdefg', 8)).toThrow('at least 8')
    expect(() => assertAcceptablePassword('密码密码密码密码', 8)).not.toThrow()
    expect(() => assertAcceptablePassword('x'.repeat(129), 8)).toThrow('at most 128')
    expect(() => assertAcceptablePassword('        ', 8)).toThrow()
  })

  test('the user aggregate says what happened to it', () => {
    const now = new Date()
    const user = User.register({ id: 'u', email: e('a@b.co'), locale: 'en', now })
    user.pullEvents()
    expect(user.hasPassword).toBe(false)
    expect(user.setPassword('h1', now)).toBe('set')
    expect(user.setPassword('h2', now)).toBe('changed')
    expect(user.setPassword('h3', now, true)).toBe('reset')
    user.removePassword(now)
    expect(user.hasPassword).toBe(false)
    expect(() => user.removePassword(now)).toThrow('no password')
    expect(user.pullEvents().map((ev) => ev.payload.change)).toEqual([
      'set',
      'changed',
      'reset',
      'removed',
    ])
  })

  test('the registered event never carries the password', () => {
    const user = User.register({
      id: 'u',
      email: e('a@b.co'),
      locale: 'en',
      now: new Date(),
      passwordHash: 'h',
      method: 'password',
    })
    expect(JSON.stringify(user.pullEvents())).not.toContain('"h"')
    expect(user.hasPassword).toBe(true)
  })
})

describe('never locking an account out', () => {
  test('one way in is enough', () => {
    const none = { emailSignIn: false, password: false, passkeys: 0, oauthAccounts: 0 }
    expect(() => assertKeepsASignInMethod(none)).toThrow('another way')
    for (const one of [
      { emailSignIn: true },
      { password: true },
      { passkeys: 1 },
      { oauthAccounts: 1 },
    ]) {
      expect(() => assertKeepsASignInMethod({ ...none, ...one })).not.toThrow()
    }
  })
})

describe('two-factor domain', () => {
  test('a time step is accepted once and only forward', () => {
    const now = new Date()
    const c = TotpCredential.pending({ userId: 'u', secret: 'S', now })
    c.confirm(100, now)
    expect(() => c.recordUse(100)).toThrow('already used')
    expect(() => c.recordUse(99)).toThrow('already used')
    c.recordUse(101)
    expect(c.lastUsedStep).toBe(101)
    expect(() => c.confirm(102, now)).toThrow('already on')
  })

  test('recovery codes are typed forgivingly and are 10 look-alike-free characters', () => {
    const code = newRecoveryCode((n) => n - 1)
    expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/)
    expect(code).not.toMatch(/[01lio]/)
    expect(normalizeRecoveryCode(' ABCDE FGHJK ')).toBe('abcde-fghjk')
    expect(normalizeRecoveryCode('abcde-fghjk')).toBe('abcde-fghjk')
    expect(looksLikeTotpCode('123 456')).toBe(true)
    expect(looksLikeTotpCode('abcde-fghjk')).toBe(false)
    expect(looksLikeTotpCode('12345')).toBe(false)
  })
})
