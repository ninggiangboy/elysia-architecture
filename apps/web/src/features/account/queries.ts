import { http, unwrap } from '@/lib/api'

export const requestEmailChange = async (newEmail: string) =>
  unwrap(await http.api.account['email-change'].post({ newEmail }))

export const confirmEmailChange = async (token: string) =>
  unwrap(await http.api.account['email-change'].confirm.post({ token }))
