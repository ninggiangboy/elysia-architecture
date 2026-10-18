import type { ModuleHost } from '@kit/runtime'
import type { OAuthGateway, PasswordHasher, WebAuthnService } from './application/ports'
import type { IdentityConfig } from './config'
import { createIdentityModule } from './identity.module'

export type IdentityHost = ModuleHost<{ identity: IdentityConfig }> & {
  /** Replacements for the real adapters (tests: a software authenticator, a fake OAuth provider). */
  overrides?: { webauthn?: WebAuthnService; oauth?: OAuthGateway; hasher?: PasswordHasher }
}

/** Builds the module from what the host app provides. */
export const installIdentity = (host: IdentityHost) =>
  createIdentityModule({
    database: host.database,
    config: host.config.identity,
    clock: host.clock,
    ids: host.ids,
    storage: host.storage,
    webauthn: host.overrides?.webauthn,
    oauth: host.overrides?.oauth,
    hasher: host.overrides?.hasher,
  })
