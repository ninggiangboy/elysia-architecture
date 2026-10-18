import { AggregateRoot, DomainError } from '@kit/core'
import { IdentityEvents } from '../contracts/events'

export const MAX_PASSKEYS_PER_USER = 10
const MAX_PASSKEY_NAME_LENGTH = 60

export type PasskeyDeviceType = 'singleDevice' | 'multiDevice'

/** A WebAuthn credential that signs the user in (and confirms sensitive actions). */
export class Passkey extends AggregateRoot {
  private constructor(
    id: string,
    version: number,
    readonly userId: string,
    /** base64url, as the browser reports it (`id` / `rawId`). */
    readonly credentialId: string,
    readonly publicKey: Uint8Array,
    private _counter: number,
    readonly transports: string[],
    readonly deviceType: PasskeyDeviceType,
    private _backedUp: boolean,
    readonly name: string,
    readonly createdAt: Date,
    private _lastUsedAt: Date | null,
  ) {
    super(id, version)
  }

  /** Signature counter. Synced passkeys always report 0, so 0 means "not supported", not "unused". */
  get counter() {
    return this._counter
  }
  get backedUp() {
    return this._backedUp
  }
  get lastUsedAt() {
    return this._lastUsedAt
  }

  static normalizeName(raw: string | undefined, fallback = 'Passkey'): string {
    return (raw ?? '').trim().slice(0, MAX_PASSKEY_NAME_LENGTH) || fallback
  }

  static register(params: {
    id: string
    userId: string
    credentialId: string
    publicKey: Uint8Array
    counter: number
    transports: string[]
    deviceType: PasskeyDeviceType
    backedUp: boolean
    name: string
    now: Date
  }): Passkey {
    const passkey = new Passkey(
      params.id,
      0,
      params.userId,
      params.credentialId,
      params.publicKey,
      params.counter,
      params.transports,
      params.deviceType,
      params.backedUp,
      Passkey.normalizeName(params.name),
      params.now,
      null,
    )
    passkey.record(
      IdentityEvents.PasskeyAdded,
      {
        userId: params.userId,
        passkeyId: params.id,
        name: passkey.name,
        addedAt: params.now.toISOString(),
      },
      params.now,
    )
    return passkey
  }

  static restore(params: {
    id: string
    version: number
    userId: string
    credentialId: string
    publicKey: Uint8Array
    counter: number
    transports: string[]
    deviceType: PasskeyDeviceType
    backedUp: boolean
    name: string
    createdAt: Date
    lastUsedAt: Date | null
  }): Passkey {
    return new Passkey(
      params.id,
      params.version,
      params.userId,
      params.credentialId,
      params.publicKey,
      params.counter,
      params.transports,
      params.deviceType,
      params.backedUp,
      params.name,
      params.createdAt,
      params.lastUsedAt,
    )
  }

  /**
   * Records a successful assertion. A counter that does not move forward means a cloned authenticator — but only when the
   * authenticator counts at all (either value non-zero).
   */
  recordUse(newCounter: number, backedUp: boolean, now: Date): void {
    if ((newCounter > 0 || this._counter > 0) && newCounter <= this._counter) {
      throw new DomainError(
        'passkey_counter_regressed',
        'This passkey cannot be trusted any more',
        'unauthorized',
      )
    }
    this._counter = newCounter
    this._backedUp = backedUp
    this._lastUsedAt = now
  }
}
