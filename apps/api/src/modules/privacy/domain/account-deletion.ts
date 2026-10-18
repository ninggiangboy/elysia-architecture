import type { Locale } from '@app/shared-types'
import { DomainError } from '#/shared/core'

const conflict = (code: string, message: string) => new DomainError(code, message, 'conflict')

/**
 * scheduled ─► running ◄─► stalled
 *    │            └──────► completed
 *    └──────────────────► cancelled      (only during the grace period)
 */
export type DeletionStatus = 'scheduled' | 'running' | 'stalled' | 'completed' | 'cancelled'

/** One module's share of the erasure. */
interface ErasureStep {
  module: string
  confirmed: boolean
  confirmedAt: Date | null
}

export interface AccountDeletionProps {
  id: string
  userId: string
  /** Kept only to say goodbye; scrubbed as soon as the deletion completes (or is cancelled and later erased). */
  email: string | null
  /** The account's language, so the goodbye mail is written in it after the account is gone. Not personal data: kept. */
  locale: Locale
  status: DeletionStatus
  requestedAt: Date
  /** End of the grace period. */
  scheduledFor: Date
  startedAt: Date | null
  completedAt: Date | null
  cancelledAt: Date | null
  /** Last time anything happened — a module confirmed, the request was re-sent. */
  updatedAt: Date
  nudges: number
  steps: ErasureStep[]
}

export type StepOutcome = 'recorded' | 'duplicate' | 'ignored'

/**
 * The right to be forgotten as a process: a grace period in which the user can change their mind, then an erasure every
 * module confirms on its own. The aggregate is the ledger of that process — `completed` means every listed module said so.
 */
export class AccountDeletion {
  private constructor(readonly props: AccountDeletionProps) {}

  static schedule(input: {
    id: string
    userId: string
    email: string
    locale: Locale
    now: Date
    gracePeriodMs: number
  }): AccountDeletion {
    return new AccountDeletion({
      id: input.id,
      userId: input.userId,
      email: input.email,
      locale: input.locale,
      status: 'scheduled',
      requestedAt: input.now,
      scheduledFor: new Date(input.now.getTime() + input.gracePeriodMs),
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      updatedAt: input.now,
      nudges: 0,
      steps: [],
    })
  }

  static restore(props: AccountDeletionProps): AccountDeletion {
    return new AccountDeletion(props)
  }

  get id() {
    return this.props.id
  }
  get userId() {
    return this.props.userId
  }
  get status() {
    return this.props.status
  }
  get email() {
    return this.props.email
  }
  get locale() {
    return this.props.locale
  }

  progress(): { done: number; total: number } {
    return {
      done: this.props.steps.filter((s) => s.confirmed).length,
      total: this.props.steps.length,
    }
  }

  pendingModules(): string[] {
    return this.props.steps.filter((s) => !s.confirmed).map((s) => s.module)
  }

  isDue(now: Date): boolean {
    return this.props.status === 'scheduled' && this.props.scheduledFor.getTime() <= now.getTime()
  }

  /** The user changed their mind. Possible only while nothing has been erased yet. */
  cancel(now: Date): void {
    if (this.props.status === 'running' || this.props.status === 'stalled')
      throw conflict('deletion_in_progress', 'The erasure has already started')
    if (this.props.status !== 'scheduled')
      throw conflict('no_deletion_scheduled', 'No account deletion is scheduled')
    this.props.status = 'cancelled'
    this.props.cancelledAt = now
    this.props.updatedAt = now
  }

  /** The grace period is over: ask every module in `modules` to erase. */
  start(modules: string[], now: Date): void {
    if (this.props.status !== 'scheduled')
      throw conflict('deletion_not_scheduled', 'The deletion is not waiting to start')
    this.props.status = 'running'
    this.props.startedAt = now
    this.props.updatedAt = now
    this.props.steps = modules.map((module) => ({ module, confirmed: false, confirmedAt: null }))
  }

  /** A module says its data is gone. Late and repeated confirmations are fine; a stalled deletion still accepts them. */
  confirm(module: string, now: Date): StepOutcome {
    const step = this.props.steps.find((s) => s.module === module)
    if (!step || (this.props.status !== 'running' && this.props.status !== 'stalled'))
      return 'ignored'
    if (step.confirmed) return 'duplicate'
    step.confirmed = true
    step.confirmedAt = now
    this.props.updatedAt = now
    return 'recorded'
  }

  isErased(): boolean {
    return this.props.steps.length > 0 && this.props.steps.every((s) => s.confirmed)
  }

  /** Every module confirmed. The e-mail address is not needed any more, so it goes. */
  complete(now: Date): void {
    if (!this.isErased() || (this.props.status !== 'running' && this.props.status !== 'stalled'))
      throw conflict('deletion_not_erased', 'Not every module has confirmed')
    this.props.status = 'completed'
    this.props.completedAt = now
    this.props.updatedAt = now
    this.props.email = null
  }

  /** Quiet for at least `quietMs` while running. */
  isStalled(now: Date, quietMs: number): boolean {
    return (
      this.props.status === 'running' && now.getTime() - this.props.updatedAt.getTime() >= quietMs
    )
  }

  /** The request was re-sent to the modules that had not answered; restarts the quiet period. */
  nudged(now: Date): void {
    this.props.nudges += 1
    this.props.updatedAt = now
  }

  /** Re-sending did not help: wait for a person. Late confirmations still count. */
  stall(now: Date): void {
    if (this.props.status !== 'running')
      throw conflict('deletion_not_running', 'The deletion is not running')
    this.props.status = 'stalled'
    this.props.updatedAt = now
  }

  /** A person fixed the cause: try again from the start of the nudges. */
  resume(now: Date): void {
    if (this.props.status !== 'stalled')
      throw conflict('deletion_not_stalled', 'The deletion is not stalled')
    this.props.status = 'running'
    this.props.nudges = 0
    this.props.updatedAt = now
  }
}
