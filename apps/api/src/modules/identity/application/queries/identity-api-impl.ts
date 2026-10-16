import type { AccountDto, IdentityApi } from '../../contracts/identity-api'
import type { UserRepository } from '../../domain/repositories'

/** Implementation of the IdentityApi contract (in-process). */
export class IdentityApiImpl implements IdentityApi {
  constructor(private users: UserRepository) {}

  async getAccount(userId: string): Promise<AccountDto | null> {
    const user = await this.users.findById(userId)
    if (!user) return null
    return { id: user.id, email: user.email.value, createdAt: user.createdAt.toISOString() }
  }
}
