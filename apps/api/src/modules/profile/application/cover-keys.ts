/**
 * Covers live in their own sub-folder of the user's folder, so a cover key can never be passed off as an avatar
 * (or the other way round) — each has its own "delete the old file" handler and one must not delete the other's file.
 */
export const coverKeyPrefix = (userId: string) => `${userId}/cover/`

export const isCoverKey = (userId: string, key: string) => key.startsWith(coverKeyPrefix(userId))
