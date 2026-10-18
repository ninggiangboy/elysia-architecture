import { DomainError } from '#/shared/core'

import type { NotificationKind } from '../contracts'

export type { NotificationKind }

export const MAX_TITLE_LENGTH = 200
export const MAX_BODY_LENGTH = 1000

export class InvalidNotificationError extends DomainError {
  constructor(message: string) {
    super('invalid_notification', message, 'validation')
  }
}

export interface NotificationProps {
  id: string
  userId: string
  kind: NotificationKind
  /**
   * Which message the client writes from `data` in the reader's language (e.g. `passkeyAdded`). `null` = a custom
   * notification: `title` and `body` are its text. A templated one stores them as empty strings.
   */
  template: string | null
  title: string
  body: string
  /** Free-form, JSON-serializable context for the client (e.g. a deep link). Not interpreted by the server. */
  data: Record<string, unknown>
  createdAt: Date
  /** Last time this made news: `createdAt`, bumped when a repeat is folded into it. */
  notifiedAt: Date
  readAt: Date | null
  /** Events sharing a key (per user) fold into one unread notification while it is still unread. `null` = never folded. */
  groupKey: string | null
  /** How many events this notification stands for (1 unless folded). */
  count: number
}

/** A message addressed to ONE user. Immutable once created; the only change is being marked read. */
export class Notification {
  private constructor(readonly props: NotificationProps) {}

  static create(
    input: Omit<NotificationProps, 'readAt' | 'notifiedAt' | 'groupKey' | 'count' | 'template'> & {
      template?: string | null
      groupKey?: string | null
    },
  ): Notification {
    const title = input.title.trim()
    const body = input.body.trim()
    if ((!title && !input.template) || title.length > MAX_TITLE_LENGTH)
      throw new InvalidNotificationError(`Title must be 1-${MAX_TITLE_LENGTH} characters`)
    if (body.length > MAX_BODY_LENGTH)
      throw new InvalidNotificationError(`Body must be at most ${MAX_BODY_LENGTH} characters`)
    return new Notification({
      ...input,
      template: input.template ?? null,
      title,
      body,
      notifiedAt: input.createdAt,
      readAt: null,
      groupKey: input.groupKey ?? null,
      count: 1,
    })
  }

  static restore(props: NotificationProps): Notification {
    return new Notification(props)
  }

  get id() {
    return this.props.id
  }
  get userId() {
    return this.props.userId
  }
}
