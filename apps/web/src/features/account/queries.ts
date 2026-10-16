import { queryOptions } from '@tanstack/react-query'
import { http, unwrap } from '@/lib/api'

export const requestEmailChange = async (newEmail: string) =>
  unwrap(await http.api.account['email-change'].post({ newEmail }))

export const confirmEmailChange = async (token: string) =>
  unwrap(await http.api.account['email-change'].confirm.post({ token }))

export const sessionsQuery = queryOptions({
  queryKey: ['sessions'],
  queryFn: async () => unwrap(await http.api.account.sessions.get()).sessions,
})

export const revokeSession = async (id: string) =>
  unwrap(await http.api.account.sessions({ id }).delete())

export const revokeOtherSessions = async () => unwrap(await http.api.account.sessions.delete())
