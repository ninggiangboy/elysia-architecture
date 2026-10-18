import { AggregateRoot } from '@kit/core'
import { ProfileEvents } from '../contracts/events'
import { Bio, DisplayName } from './value-objects'

function chosenName(raw: string | undefined): DisplayName | null {
  if (!raw) return null
  try {
    return DisplayName.create(raw)
  } catch {
    return null
  }
}

export class Profile extends AggregateRoot {
  private constructor(
    userId: string,
    version: number,
    private _displayName: DisplayName,
    private _bio: Bio | null,
    private _avatarKey: string | null,
    private _coverKey: string | null,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {
    super(userId, version)
  }

  get userId(): string {
    return this.id
  }
  get displayName(): string {
    return this._displayName.value
  }
  get bio(): string | null {
    return this._bio?.value ?? null
  }
  get avatarKey(): string | null {
    return this._avatarKey
  }
  get coverKey(): string | null {
    return this._coverKey
  }
  get updatedAt(): Date {
    return this._updatedAt
  }

  /** A name the person chose at sign-up wins when it is acceptable; otherwise one is made from the email. */
  static createDefault(params: {
    userId: string
    email: string
    displayName?: string
    now: Date
  }): Profile {
    return new Profile(
      params.userId,
      0,
      chosenName(params.displayName) ?? DisplayName.fromEmail(params.email),
      null,
      null,
      null,
      params.now,
      params.now,
    )
  }

  static restore(params: {
    userId: string
    version: number
    displayName: string
    bio: string | null
    avatarKey: string | null
    coverKey: string | null
    createdAt: Date
    updatedAt: Date
  }): Profile {
    return new Profile(
      params.userId,
      params.version,
      DisplayName.create(params.displayName),
      params.bio ? Bio.create(params.bio) : null,
      params.avatarKey,
      params.coverKey,
      params.createdAt,
      params.updatedAt,
    )
  }

  /** `bio: null | ''` clears the bio; `undefined` leaves it unchanged. */
  update(changes: { displayName?: string; bio?: string | null }, now: Date): void {
    if (changes.displayName !== undefined)
      this._displayName = DisplayName.create(changes.displayName)
    if (changes.bio !== undefined) this._bio = changes.bio === null ? null : Bio.create(changes.bio)
    this._updatedAt = now
  }

  changeAvatar(newKey: string, now: Date): void {
    const oldKey = this._avatarKey
    this._avatarKey = newKey
    this._updatedAt = now
    this.record(
      ProfileEvents.AvatarChanged,
      { userId: this.id, oldKey, newKey, changedAt: now.toISOString() },
      now,
    )
  }

  changeCover(newKey: string, now: Date): void {
    const oldKey = this._coverKey
    this._coverKey = newKey
    this._updatedAt = now
    this.record(
      ProfileEvents.CoverChanged,
      { userId: this.id, oldKey, newKey, changedAt: now.toISOString() },
      now,
    )
  }
}
