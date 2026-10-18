import type { IntegrationEventHandler } from '#/shared/application/ports'
import type { Envelope } from '#/shared/messaging/envelope'
import type { ReplayBuffer } from '../ports'

/**
 * The replay buffer holds what was pushed to the user in the last few minutes, notification text included. It expires on
 * its own, but an erased account should not wait for that. Deleting nothing is fine, so no inbox is needed.
 * (Realtime has no outbox, so it cannot confirm to the erasure job — the buffer is ephemeral and pruned anyway.)
 */
export class PurgeUserEvents<TPayload> implements IntegrationEventHandler {
  constructor(
    readonly name: string,
    readonly eventType: string,
    private userId: (payload: TPayload) => string,
    private buffer: ReplayBuffer,
  ) {}

  async handle(message: Envelope): Promise<void> {
    await this.buffer.purgeUser(this.userId(message.payload as unknown as TPayload))
  }
}
