import type { PushSubscription } from './push-subscription'

export interface PushSubscriptionRepository {
  /**
   * Inserts, or — when the endpoint already exists — takes it over for this user with the new keys.
   * A browser profile is one endpoint: if another account signs in on it, pushes must follow the new account.
   */
  upsert(subscription: PushSubscription): Promise<void>
  listByUser(userId: string): Promise<PushSubscription[]>
  /** Scoped by `userId`, so one user can never remove another's subscription. */
  deleteByEndpoint(userId: string, endpoint: string): Promise<void>
  /** The login session ended: its browser must stop receiving this user's notifications. */
  deleteBySession(userId: string, sessionId: string): Promise<void>
  /** Called when the push service says the subscription is gone (404/410). */
  deleteById(id: string): Promise<void>
  /** Keeps only the `keep` newest subscriptions of the user. */
  pruneOldest(userId: string, keep: number): Promise<void>
}
