import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ProviderIcon, providerName } from '@/features/auth/provider-icons'
import { oauthProvidersQuery } from '@/features/auth/queries'
import { isStepUpCancelled } from '@/features/auth/step-up'
import { errorMessage } from '@/lib/api'
import { connectedAccountsQuery, disconnectAccount, startConnect } from './queries'

/** Google / GitHub accounts that can sign in to this account. Renders nothing when the server has no providers. */
export function ConnectedAccounts() {
  const queryClient = useQueryClient()
  const { data: providers } = useSuspenseQuery(oauthProvidersQuery)
  const { data: accounts } = useSuspenseQuery(connectedAccountsQuery)

  const connect = useMutation({
    mutationFn: startConnect,
    // Leaves the app: the provider sends the browser back to /auth/oauth/callback, which finishes the job.
    onSuccess: (url) => window.location.assign(url),
    onError: (err) => {
      if (!isStepUpCancelled(err)) toast.error(errorMessage(err))
    },
  })
  const disconnect = useMutation({
    mutationFn: disconnectAccount,
    onSuccess: (_, provider) => {
      toast.success(`${providerName(provider)} disconnected`)
      void queryClient.invalidateQueries({ queryKey: connectedAccountsQuery.queryKey })
    },
    onError: (err) => {
      if (!isStepUpCancelled(err)) toast.error(errorMessage(err))
    },
  })

  if (providers.length === 0) return null

  return (
    <Card>
      <ul className="divide-y divide-border" aria-label="Connected accounts">
        {providers.map((provider) => {
          const account = accounts.find((a) => a.provider === provider)
          return (
            <li
              key={provider}
              className="flex items-center gap-3 px-5 py-4 sm:px-6"
              data-testid={`provider-${provider}`}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/50">
                <ProviderIcon provider={provider} className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{providerName(provider)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {account ? (account.email ?? 'Connected') : 'Not connected'}
                </p>
              </div>
              {account ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={disconnect.isPending && disconnect.variables === provider}
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate(provider)}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  loading={connect.isPending && connect.variables === provider}
                  disabled={connect.isPending}
                  onClick={() => connect.mutate(provider)}
                >
                  Connect
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
