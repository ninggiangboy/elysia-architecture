import { NotFoundError } from '#/shared/application/errors'
import type { Clock, OutboxWriter, UnitOfWork } from '#/shared/application/ports'
import type { PasskeyRepository } from '../../domain/repositories'
import { passkeyRemoved } from '../security-events'
import type { StepUpPolicy } from '../step-up-policy'
import { type PasskeyView, toPasskeyView } from './passkey-registration'

export class ListPasskeys {
  constructor(private passkeys: PasskeyRepository) {}

  async execute(query: { userId: string }): Promise<PasskeyView[]> {
    return (await this.passkeys.listByUser(query.userId)).map(toPasskeyView)
  }
}

/** Removing a way to sign in needs a recent confirmation, or a thief could strip the owner's own passkeys. */
export class RemovePasskey {
  constructor(
    private passkeys: PasskeyRepository,
    private stepUp: StepUpPolicy,
    private outbox: OutboxWriter,
    private uow: UnitOfWork,
    private clock: Clock,
  ) {}

  async execute(cmd: {
    userId: string
    passkeyId: string
    authTime: number | undefined
  }): Promise<void> {
    this.stepUp.assertFresh(cmd.authTime)
    await this.uow.run(async () => {
      const passkey = await this.passkeys.findByUserAndId(cmd.userId, cmd.passkeyId)
      if (!passkey || !(await this.passkeys.remove(cmd.userId, cmd.passkeyId))) {
        throw new NotFoundError('passkey_not_found', 'Passkey not found')
      }
      await this.outbox.add([
        passkeyRemoved(
          { userId: cmd.userId, passkeyId: passkey.id, name: passkey.name },
          this.clock.now(),
        ),
      ])
    })
  }
}
