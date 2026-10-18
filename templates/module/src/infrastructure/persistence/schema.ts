import { inboxTable, outboxTable } from '@kit/messaging'
import { pgSchema } from 'drizzle-orm/pg-core'

/** The module's tables live in a Postgres schema of their own; add the aggregates' tables here. */
export const __name__Schema = pgSchema('__name__')

export const outbox = outboxTable(__name__Schema)
export const inbox = inboxTable(__name__Schema)
