import type { TokenVerifier } from '@kit/auth'
import type { ModuleHost } from '@kit/runtime'
import { create__Name__Module } from './__name__.module'
import type { __Name__Config } from './config'

export type __Name__Host = ModuleHost<{ __name__: __Name__Config }> & {
  modules: { identity: { verifier: TokenVerifier } }
}

/** Builds the module from what the host app provides. */
export const install__Name__ = (host: __Name__Host) =>
  create__Name__Module({
    database: host.database,
    clock: host.clock,
    ids: host.ids,
    verifier: host.modules.identity.verifier,
    config: host.config.__name__,
  })
