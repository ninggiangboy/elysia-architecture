import type { Locale } from '@app/shared-types/locales'
import type { Clock, UnitOfWork } from '@kit/core'
import { ConflictError, ValidationError } from '@kit/core'
import { Email } from '../../domain/email'
import type { MagicLink } from '../../domain/magic-link'
import { MAGIC_LINK_CODE_MAX_ATTEMPTS } from '../../domain/magic-link'
import type { MagicLinkRepository, UserRepository } from '../../domain/repositories'
import type { AccountRegistrar } from '../account-registrar'
import type { AuthOutcome } from '../auth-outcome'
import type { TokenService } from '../ports'
import type { SessionMeta } from '../session-issuer'
import type { SignInCompleter } from '../sign-in-completer'
import type { SignInGuard } from '../sign-in-guard'
import { emailCodeHash } from './request-magic-link'

/** Both the link and the code it came with end here: a consumed `MagicLink` becomes a session, a second step or a sign-up. */
export class VerifyMagicLink {
  constructor(
    private magicLinks: MagicLinkRepository,
    private users: UserRepository,
    private completer: SignInCompleter,
    private registrar: AccountRegistrar,
    private guard: SignInGuard,
    private tokens: TokenService,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  /** The link in the mail. */
  verifyToken(cmd: { token: string; meta: SessionMeta; locale?: Locale }): Promise<AuthOutcome> {
    const hash = this.tokens.hashOpaqueToken(cmd.token)
    return this.run(cmd, 'magic_link', (now) => this.magicLinks.consume(hash, now))
  }

  /** The 6 digits in the same mail, typed on whichever device the person is on. */
  async verifyCode(cmd: {
    email: string
    code: string
    meta: SessionMeta
    locale?: Locale
  }): Promise<AuthOutcome> {
    const email = Email.create(cmd.email)
    const ip = cmd.meta.ip ?? 'unknown'
    await this.guard.assertAllowed(email.value, ip)
    const code = cmd.code.replace(/\s/g, '')
    try {
      return await this.run(cmd, 'email_code', (now) =>
        this.magicLinks.consumeByCode(
          email,
          emailCodeHash(this.tokens, email, code),
          now,
          MAGIC_LINK_CODE_MAX_ATTEMPTS,
        ),
      )
    } catch (err) {
      // Outside the transaction, so the count survives; the per-link attempts already stopped the guessing of one code.
      if (err instanceof ValidationError)
        await this.guard.recordFailure(email.value, ip, 'email_code')
      throw err
    }
  }

  private async run(
    cmd: { meta: SessionMeta; locale?: Locale },
    method: 'magic_link' | 'email_code',
    consume: (now: Date) => Promise<MagicLink | null>,
  ): Promise<AuthOutcome> {
    try {
      return await this.attempt(cmd, method, consume)
    } catch (err) {
      // Two links for the same not-yet-registered email verified concurrently → one loses on unique(email).
      // The transaction rolled back (the link is returned), so retrying once will see the user that was just created.
      if (err instanceof ConflictError && err.code === 'email_taken') {
        return this.attempt(cmd, method, consume)
      }
      throw err
    }
  }

  private async attempt(
    cmd: { meta: SessionMeta; locale?: Locale },
    method: 'magic_link' | 'email_code',
    consume: (now: Date) => Promise<MagicLink | null>,
  ): Promise<AuthOutcome> {
    const now = this.clock.now()
    const outcome = await this.uow.run(async (): Promise<AuthOutcome | null> => {
      const link = await consume(now)
      if (!link) return null
      const user = await this.users.findByEmail(link.email)
      if (user) return this.completer.complete({ user, method, meta: cmd.meta })
      return this.registrar.onProvenEmail({
        email: link.email,
        method,
        locale: cmd.locale,
        meta: cmd.meta,
      })
    })
    if (!outcome) {
      throw new ValidationError(
        method === 'email_code' ? 'invalid_email_code' : 'invalid_magic_link',
        method === 'email_code'
          ? 'This code is wrong or has expired'
          : 'This link is invalid or has expired',
      )
    }
    return outcome
  }
}
