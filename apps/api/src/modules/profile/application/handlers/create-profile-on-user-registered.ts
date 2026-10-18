import type { Clock } from '@kit/core'
import { IdentityEvents, type UserRegisteredPayload } from '#/modules/identity/contracts'
import type { Envelope, InboxGuard, IntegrationEventHandler } from '#/shared/messaging'
import { Profile } from '../../domain/profile'
import type { ProfileRepository } from '../../domain/profile-repository'

export class CreateProfileOnUserRegistered implements IntegrationEventHandler {
  readonly name = 'profile.create-on-user-registered'
  readonly eventType = IdentityEvents.UserRegistered

  constructor(
    private profiles: ProfileRepository,
    private inbox: InboxGuard,
    private clock: Clock,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const payload = message.payload as unknown as UserRegisteredPayload
    await this.inbox.transactional(message.id, this.name, async () => {
      // The payload already carries all the data (email) — no need to call back into identity.
      await this.profiles.createIfAbsent(
        Profile.createDefault({
          userId: payload.userId,
          email: payload.email,
          now: new Date(payload.registeredAt ?? this.clock.now()),
        }),
      )
    })
  }
}
