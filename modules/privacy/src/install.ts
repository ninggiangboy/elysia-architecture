import type { StepUpPolicy, TokenVerifier } from '@kit/auth'
import type { ModuleHost } from '@kit/runtime'
import type { IdentityApi } from '@mod/identity/contracts'
import type { PrivacyConfig } from './config'
import { createPrivacyModule } from './privacy.module'

export type PrivacyHost = ModuleHost<{ privacy: PrivacyConfig }> & {
  modules: { identity: { api: IdentityApi; verifier: TokenVerifier; stepUp: StepUpPolicy } }
  /**
   * Who takes part in each job, by name: what the other modules declare (`AppModule.privacy`). A module that becomes a
   * service stays in these lists and keeps answering with the same two events.
   */
  participants: { exports: readonly string[]; erases: readonly string[] }
}

/** Builds the module from what the host app provides. Install it after every module that takes part in its jobs. */
export const installPrivacy = (host: PrivacyHost) =>
  createPrivacyModule({
    database: host.database,
    clock: host.clock,
    ids: host.ids,
    storage: host.storage,
    log: host.logger,
    identity: host.modules.identity.api,
    verifier: host.modules.identity.verifier,
    stepUp: host.modules.identity.stepUp,
    config: host.config.privacy,
    participants: host.participants,
  })
