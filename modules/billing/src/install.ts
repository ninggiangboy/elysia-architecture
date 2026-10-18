import type { TokenVerifier } from '@kit/auth'
import type { ModuleHost } from '@kit/runtime'
import type { IdentityApi } from '@mod/identity/contracts'
import type { ProfileApi } from '@mod/profile/contracts'
import type { PaymentGateway } from './application/ports'
import { createBillingModule } from './billing.module'
import type { BillingConfig } from './config'
import { StripePaymentGateway } from './infrastructure/stripe-payment-gateway'

export type BillingHost = ModuleHost<{ billing: BillingConfig }> & {
  modules: {
    identity: { api: IdentityApi; verifier: TokenVerifier }
    profile: { api: ProfileApi }
  }
  /** Replaces Stripe (tests: a fake provider). Needs the STRIPE_* variables in the config to take effect. */
  overrides?: { paymentGateway?: PaymentGateway }
}

/** Builds the module from what the host app provides. Top-ups are off unless the three Stripe values are set. */
export function installBilling(host: BillingHost) {
  const { STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET } = host.config.billing
  const payments =
    STRIPE_SECRET_KEY && STRIPE_PUBLISHABLE_KEY && STRIPE_WEBHOOK_SECRET
      ? {
          publishableKey: STRIPE_PUBLISHABLE_KEY,
          gateway:
            host.overrides?.paymentGateway ??
            new StripePaymentGateway(STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET),
        }
      : undefined
  return createBillingModule({
    database: host.database,
    clock: host.clock,
    ids: host.ids,
    log: host.logger,
    storage: host.storage,
    verifier: host.modules.identity.verifier,
    identity: host.modules.identity.api,
    profile: host.modules.profile.api,
    config: host.config.billing,
    payments,
  })
}
