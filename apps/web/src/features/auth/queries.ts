import { http, unwrap } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import { applySession, clearSession } from '@/lib/session'

export const requestMagicLink = async (email: string) =>
  unwrap(await http.api.auth['magic-link'].post({ email }))

export async function verifyMagicLink(token: string) {
  const data = unwrap(await http.api.auth['magic-link'].verify.post({ token }))
  applySession(data)
  return data
}

export async function logout() {
  try {
    await http.api.auth.logout.post()
  } finally {
    clearSession()
    queryClient.clear()
  }
}
