import type {
  Clock,
  InboxGuard,
  IntegrationEventHandler,
  ObjectStorage,
  OutboxWriter,
} from '#/shared/application/ports'
import type { Envelope } from '#/shared/messaging/envelope'

/**
 * Building blocks for a module that takes part in the `privacy` module's two jobs (data export, account erasure).
 * The conversation is all events — the module never imports `privacy` — so the same handlers keep working when the
 * module becomes its own service: it only needs to consume the two request events and emit the two answers.
 *
 *   privacy.data_export_requested.v1   ─►  ExportUserDataHandler ─►  <module>.data_exported.v1
 *   privacy.account_erasure_requested.v1 ─► EraseUserDataHandler ─►  <module>.user_data_erased.v1
 *
 * The event names and payloads are the protocol (`protocol.ts`); `privacyParticipation` wires both handlers for a module.
 */

/** A file the module wants shipped in the archive next to its JSON (e.g. the avatar). */
export interface ExportedFile {
  /** Where it goes in the archive, below `files/`. */
  path: string
  /** Where it is now, in the bucket. */
  key: string
}

export interface ExportedPart {
  /** The module's data about the user — JSON-serializable, readable by a person. */
  data: unknown
  files?: ExportedFile[]
}

export interface DataExporter {
  /** Everything the module holds about the user. Read-only. */
  collect(userId: string): Promise<ExportedPart>
}

export interface DataEraser {
  /** Removes everything the module holds about the user. MUST be idempotent: it runs again when the job is nudged. */
  erase(userId: string): Promise<void>
}

export interface ExportRequest {
  exportId: string
  userId: string
  /** Bucket prefix the module writes its part under (`<prefix><module>.json`). */
  uploadPrefix: string
  /** Modules still owed (a re-sent request); empty or absent = everyone. */
  modules?: string[]
}

export interface ErasureRequest {
  deletionId: string
  userId: string
  /** Modules still owed (a re-sent request); empty or absent = everyone. */
  modules?: string[]
}

const owed = (modules: string[] | undefined, module: string) =>
  !modules || modules.length === 0 || modules.includes(module)

export interface ParticipantOptions {
  /** Handler name = consumer group = inbox key. */
  name: string
  /** The module's name, as the coordinator lists it among the participants. */
  module: string
  /** The privacy event this handler reacts to. */
  requestType: string
  /** Event type the module answers with (`<module>.data_exported.v1` / `<module>.user_data_erased.v1`). */
  answerType: string
}

abstract class ParticipantHandler<TRequest extends { userId: string; modules?: string[] }>
  implements IntegrationEventHandler
{
  readonly name: string
  readonly eventType: string

  constructor(
    protected options: ParticipantOptions,
    protected outbox: OutboxWriter,
    protected inbox: InboxGuard,
    protected clock: Clock,
  ) {
    this.name = options.name
    this.eventType = options.requestType
  }

  /** The request, or `null` when this module is not among those still owed (a re-sent request names only them). */
  protected requestFor(message: Envelope): TRequest | null {
    const request = message.payload as unknown as TRequest
    return owed(request.modules, this.options.module) ? request : null
  }

  abstract handle(message: Envelope): Promise<void>
}

/** `privacy.data_export_requested` → collect the module's data → write it to the bucket → say where it is. */
export class ExportUserDataHandler<
  TRequest extends ExportRequest,
> extends ParticipantHandler<TRequest> {
  constructor(
    options: ParticipantOptions,
    private exporter: DataExporter,
    private storage: ObjectStorage,
    outbox: OutboxWriter,
    inbox: InboxGuard,
    clock: Clock,
  ) {
    super(options, outbox, inbox, clock)
  }

  async handle(message: Envelope): Promise<void> {
    const request = this.requestFor(message)
    if (!request) return
    const { module, answerType } = this.options

    const part = await this.exporter.collect(request.userId)
    const bytes = new TextEncoder().encode(JSON.stringify(part.data, null, 2))
    const key = `${request.uploadPrefix}${module}.json`
    // Idempotent: a retry overwrites the same object. Written before the answer, so an answer always points at a file.
    await this.storage.write(key, bytes, 'application/json')

    const now = this.clock.now()
    await this.inbox.transactional(message.id, this.name, async () => {
      await this.outbox.add([
        {
          type: answerType,
          aggregateId: request.userId,
          payload: {
            exportId: request.exportId,
            userId: request.userId,
            module,
            key,
            size: bytes.byteLength,
            files: part.files ?? [],
            exportedAt: now.toISOString(),
          },
          occurredAt: now,
        },
      ])
    })
  }
}

/**
 * `privacy.account_erasure_requested` → erase the module's data → confirm.
 * Erasing and confirming commit together, so a confirmation is never sent for data that is still there, and a crash
 * in between only means the request is processed again (erasing twice is harmless).
 */
export class EraseUserDataHandler<
  TRequest extends ErasureRequest,
> extends ParticipantHandler<TRequest> {
  constructor(
    options: ParticipantOptions,
    private eraser: DataEraser,
    outbox: OutboxWriter,
    inbox: InboxGuard,
    clock: Clock,
  ) {
    super(options, outbox, inbox, clock)
  }

  async handle(message: Envelope): Promise<void> {
    const request = this.requestFor(message)
    if (!request) return
    const { module, answerType } = this.options

    const now = this.clock.now()
    await this.inbox.transactional(message.id, this.name, async () => {
      await this.eraser.erase(request.userId)
      await this.outbox.add([
        {
          type: answerType,
          aggregateId: request.userId,
          payload: {
            deletionId: request.deletionId,
            userId: request.userId,
            module,
            erasedAt: now.toISOString(),
          },
          occurredAt: now,
        },
      ])
    })
  }
}
