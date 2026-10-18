import type { RealtimeGateway } from '../ports'

/** Pushes a `realtime.test` event to all of the caller's open connections — to check SSE end to end. */
export class SendTestEvent {
  constructor(private gateway: RealtimeGateway) {}

  async execute(cmd: {
    userId: string
    sessionId: string
    message: string
    replay?: boolean
  }): Promise<void> {
    await this.gateway.publish(
      { userId: cmd.userId },
      {
        type: 'realtime.test',
        data: { message: cmd.message, fromSessionId: cmd.sessionId },
        replay: cmd.replay,
      },
    )
  }
}
