import { queryOptions } from '@tanstack/react-query'
import { withStepUp } from '@/features/auth/step-up'
import { http, unwrap } from '@/lib/api'
import { createPasskey } from '@/lib/webauthn'

// Changing the email hands over account recovery, so the server wants a recent confirmation first.
export const requestEmailChange = (newEmail: string) =>
  withStepUp(async () => unwrap(await http.api.account['email-change'].post({ newEmail })))

export const confirmEmailChange = async (token: string) =>
  unwrap(await http.api.account['email-change'].confirm.post({ token }))

const fetchSessions = async () => unwrap(await http.api.account.sessions.get()).sessions

export type Session = Awaited<ReturnType<typeof fetchSessions>>[number]

export const sessionsQuery = queryOptions({
  queryKey: ['sessions'],
  queryFn: fetchSessions,
})

export const revokeSession = async (id: string) =>
  unwrap(await http.api.account.sessions({ id }).delete())

export const revokeOtherSessions = async () => unwrap(await http.api.account.sessions.delete())

const fetchPasskeys = async () => unwrap(await http.api.account.passkeys.get()).passkeys

export type Passkey = Awaited<ReturnType<typeof fetchPasskeys>>[number]

export const passkeysQuery = queryOptions({
  queryKey: ['passkeys'],
  queryFn: fetchPasskeys,
})

/** Asks the browser to create a passkey and stores it. Nothing happens on the server until the browser agrees. */
export const addPasskey = (name: string) =>
  withStepUp(async () => {
    const begin = unwrap(await http.api.account.passkeys.options.post())
    const response = await createPasskey(begin.options)
    return unwrap(
      await http.api.account.passkeys.post({ challengeId: begin.challengeId, response, name }),
    )
  })

export const removePasskey = (id: string) =>
  withStepUp(async () => unwrap(await http.api.account.passkeys({ id }).delete()))

const fetchConnectedAccounts = async () => unwrap(await http.api.account.oauth.get()).accounts

export const connectedAccountsQuery = queryOptions({
  queryKey: ['oauth-accounts'],
  queryFn: fetchConnectedAccounts,
})

/** Where to send the browser to connect a provider; the page that receives it finishes the job. */
export const startConnect = (provider: string) =>
  withStepUp(async () => unwrap(await http.api.account.oauth({ provider }).link.post()).url)

export const disconnectAccount = (provider: string) =>
  withStepUp(async () => unwrap(await http.api.account.oauth({ provider }).delete()))
