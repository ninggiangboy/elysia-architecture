import type { IdentityApi } from '#/modules/identity/contracts'
import type { ProfileApi } from '#/modules/profile/contracts'
import type { Log } from '#/shared/core'
import type { BuyerDirectory } from '../application/ports'

/** Reads the buyer's email from identity and name from profile, through their contracts. A failure costs the field, not the top-up. */
export class ModuleBuyerDirectory implements BuyerDirectory {
  constructor(
    private identity: IdentityApi,
    private profile: ProfileApi,
    private log: Log,
  ) {}

  async lookup(userId: string): Promise<{ name: string | null; email: string | null }> {
    const [account, name] = await Promise.allSettled([
      this.identity.getAccount(userId),
      this.profile.getDisplayName(userId),
    ])
    for (const result of [account, name])
      if (result.status === 'rejected')
        this.log.warn(
          { err: result.reason, userId },
          'could not read a buyer detail for a document',
        )
    return {
      name: name.status === 'fulfilled' ? name.value : null,
      email: account.status === 'fulfilled' ? (account.value?.email ?? null) : null,
    }
  }
}
