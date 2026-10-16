import { AggregateRoot } from '#/shared/domain/aggregate-root'
import { ProfileEvents } from '../contracts/events'
import { Bio, DisplayName } from './value-objects'

export class Profile extends AggregateRoot {
  private constructor(
    userId: string,
    version: number,
    private _displayName: DisplayName,
    private _bio: Bio | null,
    private _avatarKey: string | null,
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
  get updatedAt(): Date {
    return this._updatedAt
  }

  static createDefault(params: { userId: string; email: string; now: Date }): Profile {
    return new Profile(
      params.userId,
      0,
      DisplayName.fromEmail(params.email),
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
    createdAt: Date
    updatedAt: Date
  }): Profile {
    return new Profile(
      params.userId,
      params.version,
      DisplayName.create(params.displayName),
      params.bio ? Bio.create(params.bio) : null,
      params.avatarKey,
      params.createdAt,
      params.updatedAt,
    )
  }

  /** `bio: null | ''` xoá bio; `undefined` giữ nguyên. */
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
}
