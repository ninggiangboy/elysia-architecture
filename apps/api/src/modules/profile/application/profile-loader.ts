import type { AccountDto, IdentityApi } from '#/modules/identity/contracts'
import { NotFoundError } from '#/shared/application/errors'
import type { Clock } from '#/shared/application/ports'
import { Profile } from '../domain/profile'
import type { ProfileRepository } from '../domain/profile-repository'

/**
 * Lấy account (qua contract của identity) và profile. Chưa có profile (event welcome chưa kịp xử lý)
 * thì trả bản mặc định chưa persist (version 0) — hệ thống chịu được eventual consistency.
 */
export class ProfileLoader {
  constructor(
    private identity: IdentityApi,
    private profiles: ProfileRepository,
    private clock: Clock,
  ) {}

  async load(userId: string): Promise<{ account: AccountDto; profile: Profile }> {
    const [account, existing] = await Promise.all([
      this.identity.getAccount(userId),
      this.profiles.findByUserId(userId),
    ])
    if (!account) throw new NotFoundError('user_not_found', 'User not found')
    const profile =
      existing ?? Profile.createDefault({ userId, email: account.email, now: this.clock.now() })
    return { account, profile }
  }
}
