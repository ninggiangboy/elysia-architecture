import type {
  Clock,
  InboxGuard,
  IntegrationEventHandler,
  ObjectStorage,
  OutboxWriter,
} from '#/shared/application/ports'
import {
  type DataEraser,
  type DataExporter,
  EraseUserDataHandler,
  ExportUserDataHandler,
} from './handlers'
import {
  type AccountErasureRequestedPayload,
  type DataExportRequestedPayload,
  PrivacyProtocol,
} from './protocol'

/** Which of privacy's two jobs a module takes part in. The container derives the participant lists from this. */
export interface PrivacyParticipation {
  /** Answers `privacy.data_export_requested` with its part of the archive. */
  exports: boolean
  /** Answers `privacy.account_erasure_requested` once its data is gone. */
  erases: boolean
}

export interface PrivacyParticipationOptions {
  /** The name privacy lists the module under; also the prefix of the handler names. */
  module: string
  storage: ObjectStorage
  /** The module's own outbox and inbox: the answer is written to the one, the request is deduplicated by the other. */
  outbox: OutboxWriter
  inbox: InboxGuard
  clock: Clock
  /** Omit for a module that holds nothing worth exporting. `answerType` is the module's `data_exported` event. */
  export?: { exporter: DataExporter; answerType: string }
  /** Omit for a module that keeps nothing about the user. `answerType` is the module's `user_data_erased` event. */
  erase?: { eraser: DataEraser; answerType: string }
}

/**
 * The two handlers a participant module registers, plus the flags the container reads. The handler names
 * (`<module>.export-user-data`, `<module>.erase-user-data`) are inbox keys: keep them.
 */
export function privacyParticipation(options: PrivacyParticipationOptions): {
  handlers: IntegrationEventHandler[]
  privacy: PrivacyParticipation
} {
  const { module, storage, outbox, inbox, clock } = options
  const handlers: IntegrationEventHandler[] = []
  if (options.export)
    handlers.push(
      new ExportUserDataHandler<DataExportRequestedPayload>(
        {
          name: `${module}.export-user-data`,
          module,
          requestType: PrivacyProtocol.DataExportRequested,
          answerType: options.export.answerType,
        },
        options.export.exporter,
        storage,
        outbox,
        inbox,
        clock,
      ),
    )
  if (options.erase)
    handlers.push(
      new EraseUserDataHandler<AccountErasureRequestedPayload>(
        {
          name: `${module}.erase-user-data`,
          module,
          requestType: PrivacyProtocol.AccountErasureRequested,
          answerType: options.erase.answerType,
        },
        options.erase.eraser,
        outbox,
        inbox,
        clock,
      ),
    )
  return { handlers, privacy: { exports: !!options.export, erases: !!options.erase } }
}
