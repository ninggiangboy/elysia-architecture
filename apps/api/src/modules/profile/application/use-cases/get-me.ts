import type { ObjectStorage } from '#/shared/storage'
import { type MeView, toMeView } from '../me-view'
import type { ProfileLoader } from '../profile-loader'

export class GetMe {
  constructor(
    private loader: ProfileLoader,
    private storage: ObjectStorage,
  ) {}

  async execute(cmd: { userId: string }): Promise<MeView> {
    const { account, profile } = await this.loader.load(cmd.userId)
    return toMeView(account, profile, this.storage)
  }
}
