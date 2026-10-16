import { queryOptions } from '@tanstack/react-query'
import { withStepUp } from '@/features/auth/step-up'
import { http, unwrap } from '@/lib/api'

const fetchExports = async () => unwrap(await http.api.privacy.exports.get()).items

export type DataExport = Awaited<ReturnType<typeof fetchExports>>[number]

export const exportsQuery = queryOptions({
  queryKey: ['privacy', 'exports'],
  queryFn: fetchExports,
})

const fetchDeletion = async () => unwrap(await http.api.privacy.deletion.get()).deletion

export type AccountDeletion = NonNullable<Awaited<ReturnType<typeof fetchDeletion>>>

export const deletionQuery = queryOptions({
  queryKey: ['privacy', 'deletion'],
  queryFn: fetchDeletion,
})

// The archive is everything we know about the person, and deleting is final: both want a recent confirmation first.
export const requestExport = () =>
  withStepUp(async () => unwrap(await http.api.privacy.exports.post()))

export const exportDownloadUrl = (id: string) =>
  withStepUp(async () => unwrap(await http.api.privacy.exports({ id }).download.get()).url)

export const scheduleDeletion = () =>
  withStepUp(async () => unwrap(await http.api.privacy.deletion.post()))

export const cancelDeletion = async () => unwrap(await http.api.privacy.deletion.delete())
