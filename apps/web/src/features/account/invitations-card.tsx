import { Badge, Button, Card, CardContent, Input, Label } from '@kit/ui'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { invitationsQuery, revokeInvitation, sendInvitation } from './queries'

/** Where sign-up is by invitation: invite an address, see who was invited, withdraw a pending invitation. */
export function InvitationsCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: invitations } = useSuspenseQuery(invitationsQuery)
  const [email, setEmail] = useState('')
  const refresh = () => void queryClient.invalidateQueries({ queryKey: invitationsQuery.queryKey })

  const invite = useMutation({
    mutationFn: sendInvitation,
    onSuccess: (sent) => {
      toast.success(t('invites.sent', { email: sent.email }))
      setEmail('')
      refresh()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const revoke = useMutation({
    mutationFn: revokeInvitation,
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    invite.mutate(email.trim())
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="invite-email">{t('invites.email')}</Label>
            <Input
              id="invite-email"
              type="email"
              required
              placeholder={t('login.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" loading={invite.isPending}>
            {t('invites.send')}
          </Button>
        </form>
      </CardContent>
      {invitations.length > 0 && (
        <ul
          className="divide-y divide-border border-t border-border"
          aria-label={t('invites.list')}
        >
          {invitations.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{i.email}</p>
                <p className="text-xs text-muted-foreground">
                  {t('invites.sentOn', { date: formatDate(i.createdAt) })}
                </p>
              </div>
              <Badge variant={i.status === 'accepted' ? 'default' : 'outline'}>
                {t(`invites.status.${i.status}`)}
              </Badge>
              {i.status === 'pending' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(i.id)}
                >
                  {t('invites.withdraw')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
