import type { IdentityApi } from '#/modules/identity/contracts'
import type {
  Clock,
  IdGenerator,
  IntegrationEventHandler,
  ObjectStorage,
} from '#/shared/application/ports'
import type { TokenVerifier } from '#/shared/http/auth.plugin'
import type { ModuleDatabase } from '#/shared/infrastructure/db/module-database'
import { DrizzleInboxGuard } from '#/shared/infrastructure/outbox/drizzle-inbox-guard'
import { DrizzleOutboxWriter } from '#/shared/infrastructure/outbox/drizzle-outbox-writer'
import type { OutboxSource } from '#/shared/infrastructure/outbox/outbox-relay'
import { CreateProfileOnUserRegistered } from './application/handlers/create-profile-on-user-registered'
import { DeleteOldAvatar } from './application/handlers/delete-old-avatar'
import { ProfileLoader } from './application/profile-loader'
import { GetMe } from './application/use-cases/get-me'
import { RequestAvatarUpload } from './application/use-cases/request-avatar-upload'
import { SetAvatar } from './application/use-cases/set-avatar'
import { UpdateProfile } from './application/use-cases/update-profile'
import { DrizzleProfileRepository } from './infrastructure/persistence/drizzle-profile-repository'
import { inbox, outbox } from './infrastructure/persistence/schema'
import { profileRoutes } from './presentation/routes'

export interface ProfileModuleDeps {
  mod: ModuleDatabase
  clock: Clock
  ids: IdGenerator
  storage: ObjectStorage
  /** Chỉ phụ thuộc vào HỢP ĐỒNG của identity, không biết cài đặt bên trong. */
  identity: IdentityApi
  verifier: TokenVerifier
}

export interface ProfileModule {
  name: 'profile'
  mod: ModuleDatabase
  routes: ReturnType<typeof profileRoutes>
  handlers: IntegrationEventHandler[]
  outbox: OutboxSource
}

export function createProfileModule(deps: ProfileModuleDeps): ProfileModule {
  const { mod, clock, ids, storage, identity, verifier } = deps

  const profiles = new DrizzleProfileRepository(mod)
  const outboxWriter = new DrizzleOutboxWriter(mod, outbox, () => ids.next())
  const inboxGuard = new DrizzleInboxGuard(mod, inbox)
  const loader = new ProfileLoader(identity, profiles, clock)

  return {
    name: 'profile',
    mod,
    routes: profileRoutes({
      verifier,
      useCases: {
        getMe: new GetMe(loader, storage),
        updateProfile: new UpdateProfile(loader, profiles, storage, clock),
        requestAvatarUpload: new RequestAvatarUpload(storage, ids),
        setAvatar: new SetAvatar(loader, profiles, storage, outboxWriter, mod, clock),
      },
    }),
    handlers: [
      new CreateProfileOnUserRegistered(profiles, inboxGuard, clock),
      new DeleteOldAvatar(storage, inboxGuard),
    ],
    outbox: { name: 'profile', mod, table: outbox },
  }
}
