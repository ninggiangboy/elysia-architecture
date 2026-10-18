import type { TokenVerifier } from '@kit/auth'
import type { ModuleHost } from '@kit/runtime'
import type { RealtimeConfig } from './config'
import type { RealtimeIntegration } from './contracts'
import { createRealtimeModule } from './realtime.module'

export type RealtimeHost = ModuleHost<{ realtime: RealtimeConfig }> & {
  modules: { identity: { verifier: TokenVerifier } }
  /** What reaches the open tabs: one integration per producer. Leave one out and its events simply stop being pushed. */
  integrations: readonly RealtimeIntegration[]
}

/** Builds the module from what the host app provides. */
export const installRealtime = (host: RealtimeHost) =>
  createRealtimeModule({
    database: host.database,
    clock: host.clock,
    log: host.logger,
    verifier: host.modules.identity.verifier,
    config: host.config.realtime,
    integrations: host.integrations,
  })
