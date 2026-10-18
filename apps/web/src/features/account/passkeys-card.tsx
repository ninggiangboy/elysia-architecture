import { Badge, Button, Card, CardFooter, Dialog } from '@kit/ui'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Fingerprint, Plus } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { isStepUpCancelled } from '@/features/auth/step-up'
import { errorMessage } from '@/lib/api'
import { describeDevice } from '@/lib/device'
import { formatDate, formatRelative } from '@/lib/format'
import { browserSupportsWebAuthn, passkeyCancelled, passkeyErrorMessage } from '@/lib/webauthn'
import { addPasskey, type Passkey, passkeysQuery, removePasskey } from './queries'

export function PasskeysCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: passkeys } = useSuspenseQuery(passkeysQuery)
  const [removing, setRemoving] = useState<Passkey | null>(null)
  const supported = browserSupportsWebAuthn()

  const add = useMutation({
    mutationFn: () => addPasskey(describeDevice(navigator.userAgent)),
    onSuccess: (created) => {
      toast.success(t('passkeys.addedToast', { name: created.name }))
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
      toast.success(t('passkeys.removedToast'))
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
          {t('passkeys.none')}
        </p>
      ) : (
        <ul className="divide-y divide-border" aria-label={t('passkeys.list')}>
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
                  {p.deviceType === 'multiDevice' && (
                    <Badge variant="outline">{t('passkeys.synced')}</Badge>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t('passkeys.added', { date: formatDate(p.createdAt) })} ·{' '}
                  {p.lastUsedAt
                    ? t('passkeys.usedAt', { when: formatRelative(p.lastUsedAt) })
                    : t('passkeys.neverUsed')}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setRemoving(p)}>
                {t('common.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          {supported ? t('passkeys.supported') : t('passkeys.unsupported')}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={!supported}
          loading={add.isPending}
          onClick={() => add.mutate()}
        >
          <Plus aria-hidden /> {t('passkeys.add')}
        </Button>
      </CardFooter>

      {removing && (
        <Dialog
          title={t('passkeys.removeTitle')}
          busy={remove.isPending}
          onClose={() => setRemoving(null)}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            <Trans
              i18nKey="passkeys.removeBody"
              values={{ name: removing.name }}
              components={{ b: <strong /> }}
            />
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={remove.isPending}
              onClick={() => setRemoving(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={remove.isPending}
              onClick={() => remove.mutate(removing.id)}
            >
              {t('common.remove')}
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  )
}
