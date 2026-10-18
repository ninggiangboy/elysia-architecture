import type { TokenVerifier } from '@kit/auth'
import type { ModuleHost } from '@kit/runtime'
import type { IdentityApi } from '@mod/identity/contracts'
import { createProfileModule } from './profile.module'

export type ProfileHost = ModuleHost & {
  modules: { identity: { api: IdentityApi; verifier: TokenVerifier } }
}

/** Builds the module from what the host app provides. */
export const installProfile = (host: ProfileHost) =>
  createProfileModule({
    database: host.database,
    clock: host.clock,
    ids: host.ids,
    storage: host.storage,
    log: host.logger,
    identity: host.modules.identity.api,
    verifier: host.modules.identity.verifier,
  })
