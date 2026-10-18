import type { Locale } from '@app/shared-types/locales'
import type { Clock } from '#/shared/core'
import { NotFoundError } from '#/shared/core'
import type { UserRepository } from '../../domain/repositories'

/** The language the account is addressed in (mail, notifications). A preference: no event, no step-up. */
export class ChangeLocale {
  constructor(
    private users: UserRepository,
    private clock: Clock,
  ) {}

  async execute(cmd: { userId: string; locale: Locale }): Promise<void> {
    const user = await this.users.findById(cmd.userId)
    if (!user) throw new NotFoundError('user_not_found', 'User not found')
    if (user.locale === cmd.locale) return
    user.changeLocale(cmd.locale, this.clock.now())
    await this.users.save(user)
  }
}
