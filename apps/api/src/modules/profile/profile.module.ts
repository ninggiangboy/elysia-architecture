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
import type { AppModule } from '#/shared/module/app-module'
import { privacyParticipation } from '#/shared/privacy-participant'
import { CreateProfileOnUserRegistered } from './application/handlers/create-profile-on-user-registered'
import { DeleteOldAvatar } from './application/handlers/delete-old-avatar'
import { DeleteOldCover } from './application/handlers/delete-old-cover'
import { GenerateAvatarThumbnails } from './application/handlers/generate-avatar-thumbnails'
import { ProfileDataExporter } from './application/profile-data-exporter'
import { ProfileLoader } from './application/profile-loader'
import { ProfileApiImpl } from './application/queries/profile-api-impl'
import { GetMe } from './application/use-cases/get-me'
import { RequestAvatarUpload } from './application/use-cases/request-avatar-upload'
import { RequestCoverUpload } from './application/use-cases/request-cover-upload'
import { SetAvatar } from './application/use-cases/set-avatar'
import { SetCover } from './application/use-cases/set-cover'
import { UpdateProfile } from './application/use-cases/update-profile'
import { ProfileEvents } from './contracts/events'
import type { ProfileApi } from './contracts/profile-api'
import { DrizzleProfileDataEraser } from './infrastructure/persistence/drizzle-data-eraser'
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

export interface ProfileModule extends AppModule<'profile', ReturnType<typeof profileRoutes>> {
  routes: ReturnType<typeof profileRoutes>
  handlers: IntegrationEventHandler[]
  outbox: OutboxSource
  api: ProfileApi
}

export function createProfileModule(deps: ProfileModuleDeps): ProfileModule {
  const { database, clock, ids, storage, log, identity, verifier } = deps

  const profiles = new DrizzleProfileRepository(database)
  const outboxWriter = new DrizzleOutboxWriter(database, outbox, () => ids.next())
  const inboxGuard = new DrizzleInboxGuard(database, inbox)
  const loader = new ProfileLoader(identity, profiles, clock)
  const participation = privacyParticipation({
    module: 'profile',
    storage,
    outbox: outboxWriter,
    inbox: inboxGuard,
    clock,
    export: { exporter: new ProfileDataExporter(profiles), answerType: ProfileEvents.DataExported },
    erase: {
      eraser: new DrizzleProfileDataEraser(database, storage),
      answerType: ProfileEvents.UserDataErased,
    },
  })

  return {
    name: 'profile',
    docs: [{ name: 'profile', description: 'Profile and avatar of the current user' }],
    routes: profileRoutes({
      verifier,
      useCases: {
        getMe: new GetMe(loader, storage),
        updateProfile: new UpdateProfile(loader, profiles, storage, clock),
        requestAvatarUpload: new RequestAvatarUpload(storage, ids),
        setAvatar: new SetAvatar(loader, profiles, storage, outboxWriter, database, clock),
        requestCoverUpload: new RequestCoverUpload(storage, ids),
        setCover: new SetCover(loader, profiles, storage, outboxWriter, database, clock),
      },
    }),
    handlers: [
      new CreateProfileOnUserRegistered(profiles, inboxGuard, clock),
      new DeleteOldAvatar(storage, inboxGuard),
      new DeleteOldCover(storage, inboxGuard),
      new GenerateAvatarThumbnails(storage, new SharpImageResizer(), inboxGuard, log),
      ...participation.handlers,
    ],
    privacy: participation.privacy,
    outbox: { name: 'profile', table: outbox },
    api: new ProfileApiImpl(profiles),
  }
}
