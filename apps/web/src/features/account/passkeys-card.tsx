import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Fingerprint, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardFooter } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { isStepUpCancelled } from '@/features/auth/step-up'
import { errorMessage } from '@/lib/api'
import { describeDevice } from '@/lib/device'
import { formatDate, formatRelative } from '@/lib/format'
import { browserSupportsWebAuthn, passkeyCancelled, passkeyErrorMessage } from '@/lib/webauthn'
import { addPasskey, type Passkey, passkeysQuery, removePasskey } from './queries'

export function PasskeysCard() {
  const queryClient = useQueryClient()
  const { data: passkeys } = useSuspenseQuery(passkeysQuery)
  const [removing, setRemoving] = useState<Passkey | null>(null)
  const supported = browserSupportsWebAuthn()

  const add = useMutation({
    mutationFn: () => addPasskey(describeDevice(navigator.userAgent)),
    onSuccess: (created) => {
      toast.success(`Passkey "${created.name}" added`)
      void queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey })
    },
    onError: (err) => {
      if (isStepUpCancelled(err) || passkeyCancelled(err)) return
      toast.error(passkeyErrorMessage(err))
    },
  })
  const remove = useMutation({
    mutationFn: removePasskey,
    onSuccess: () => {
      toast.success('Passkey removed')
      setRemoving(null)
      void queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey })
    },
    onError: (err) => {
      setRemoving(null)
      if (!isStepUpCancelled(err)) toast.error(errorMessage(err))
    },
  })

  return (
    <Card>
      {passkeys.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground sm:px-6" data-testid="no-passkeys">
          No passkeys yet. A passkey lets you sign in with your fingerprint, face or screen lock —
          no email link needed.
        </p>
      ) : (
        <ul className="divide-y divide-border" aria-label="Passkeys">
          {passkeys.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 px-5 py-4 sm:px-6"
              data-testid="passkey"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
                <Fingerprint className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="truncate">{p.name}</span>
                  {p.deviceType === 'multiDevice' && <Badge variant="outline">Synced</Badge>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Added {formatDate(p.createdAt)} ·{' '}
                  {p.lastUsedAt ? `used ${formatRelative(p.lastUsedAt)}` : 'never used'}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setRemoving(p)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          {supported
            ? 'Adding or removing one asks you to confirm it is you.'
            : 'This browser does not support passkeys.'}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={!supported}
          loading={add.isPending}
          onClick={() => add.mutate()}
        >
          <Plus aria-hidden /> Add a passkey
        </Button>
      </CardFooter>

      {removing && (
        <Dialog
          title="Remove this passkey?"
          busy={remove.isPending}
          onClose={() => setRemoving(null)}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            You will no longer be able to sign in with <strong>{removing.name}</strong>. You can
            still sign in with an email link. Delete it from your device’s passkey list too if you
            do not want to see it offered.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={remove.isPending}
              onClick={() => setRemoving(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={remove.isPending}
              onClick={() => remove.mutate(removing.id)}
            >
              Remove
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  )
}
