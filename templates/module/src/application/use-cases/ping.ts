import type { Clock } from '@kit/core'
import { Reply } from '../../domain/reply'

export class Ping {
  constructor(
    private clock: Clock,
    private reply: string,
  ) {}

  execute(input: { userId: string }) {
    return {
      module: '__name__',
      reply: Reply.of(this.reply).text,
      userId: input.userId,
      at: this.clock.now().toISOString(),
    }
  }
}
