import { queryOptions } from '@tanstack/react-query'
import { http, unwrap } from '@/lib/api'

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async () => unwrap(await http.api.me.get()),
})

export const updateProfile = async (
  changes: { displayName?: string; bio?: string | null },
  version: number,
) => unwrap(await http.api.me.profile.patch(changes, { headers: { 'if-match': String(version) } }))

export const requestAvatarUpload = async (file: File) =>
  unwrap(
    await http.api.me.avatar['upload-url'].post({
      contentType: file.type,
      contentLength: file.size,
    }),
  )

export const setAvatar = async (key: string) => unwrap(await http.api.me.avatar.put({ key }))
