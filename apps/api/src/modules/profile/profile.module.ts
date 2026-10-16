import type { IdentityApi } from '#/modules/identity/contracts'
import type {
  Clock,
  IdGenerator,
  IntegrationEventHandler,
  Log,
  ObjectStorage,
} from '#/shared/application/ports'
import type { TokenVerifier } from '#/shared/http/auth.plugin'
import type { Database } from '#/shared/infrastructure/db/database'
import { DrizzleInboxGuard } from '#/shared/infrastructure/outbox/drizzle-inbox-guard'
import { DrizzleOutboxWriter } from '#/shared/infrastructure/outbox/drizzle-outbox-writer'
import type { OutboxSource } from '#/shared/infrastructure/outbox/outbox-relay'
import { CreateProfileOnUserRegistered } from './application/handlers/create-profile-on-user-registered'
import { DeleteOldAvatar } from './application/handlers/delete-old-avatar'
import { GenerateAvatarThumbnails } from './application/handlers/generate-avatar-thumbnails'
import { ProfileLoader } from './application/profile-loader'
import { GetMe } from './application/use-cases/get-me'
import { RequestAvatarUpload } from './application/use-cases/request-avatar-upload'
import { SetAvatar } from './application/use-cases/set-avatar'
import { UpdateProfile } from './application/use-cases/update-profile'
import { DrizzleProfileRepository } from './infrastructure/persistence/drizzle-profile-repository'
import { inbox, outbox } from './infrastructure/persistence/schema'
import { SharpImageResizer } from './infrastructure/sharp-image-resizer'
import { profileRoutes } from './presentation/routes'

export interface ProfileModuleDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  storage: ObjectStorage
  log: Log
  /** Depends only on identity's CONTRACT, not on its internal implementation. */
  identity: IdentityApi
  verifier: TokenVerifier
}

export interface ProfileModule {
  name: 'profile'
  routes: ReturnType<typeof profileRoutes>
  handlers: IntegrationEventHandler[]
  outbox: OutboxSource
}

export function createProfileModule(deps: ProfileModuleDeps): ProfileModule {
  const { database, clock, ids, storage, log, identity, verifier } = deps

  const profiles = new DrizzleProfileRepository(database)
  const outboxWriter = new DrizzleOutboxWriter(database, outbox, () => ids.next())
  const inboxGuard = new DrizzleInboxGuard(database, inbox)
  const loader = new ProfileLoader(identity, profiles, clock)

  return {
    name: 'profile',
    routes: profileRoutes({
      verifier,
      useCases: {
        getMe: new GetMe(loader, storage),
        updateProfile: new UpdateProfile(loader, profiles, storage, clock),
        requestAvatarUpload: new RequestAvatarUpload(storage, ids),
        setAvatar: new SetAvatar(loader, profiles, storage, outboxWriter, database, clock),
      },
    }),
    handlers: [
      new CreateProfileOnUserRegistered(profiles, inboxGuard, clock),
      new DeleteOldAvatar(storage, inboxGuard),
      new GenerateAvatarThumbnails(storage, new SharpImageResizer(), inboxGuard, log),
    ],
    outbox: { name: 'profile', table: outbox },
  }
}
