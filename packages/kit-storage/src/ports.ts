export interface ObjectStat {
  size: number
  contentType: string
}

export interface ObjectStorage {
  presignPut(key: string, opts: { contentType: string; expiresInSeconds: number }): string
  presignGet(key: string, expiresInSeconds: number): string
  stat(key: string): Promise<ObjectStat | null>
  /** The object's bytes, or `null` when it does not exist. */
  read(key: string): Promise<Uint8Array | null>
  /** Creates or overwrites the object. */
  write(key: string, data: Uint8Array, contentType: string): Promise<void>
  delete(key: string): Promise<void>
  /** Deletes every object whose key starts with `prefix`; returns how many. Idempotent: nothing to delete is fine. */
  deletePrefix(prefix: string): Promise<number>
}
