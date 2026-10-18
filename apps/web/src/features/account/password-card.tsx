import { Button, Card, CardFooter, Dialog, Input, Label } from '@kit/ui'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { authOptionsQuery } from '@/features/auth/queries'
import { isStepUpCancelled } from '@/features/auth/step-up'
import { errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { removePassword, securityQuery, setPassword } from './queries'

/** Set, change or remove the password. Each is a sensitive action: the server asks for a recent confirmation. */
export function PasswordCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: security } = useSuspenseQuery(securityQuery)
  const { data: options } = useSuspenseQuery(authOptionsQuery)
  const [editing, setEditing] = useState(false)
  const [password, setNewPassword] = useState('')
  const done = () => void queryClient.invalidateQueries({ queryKey: securityQuery.queryKey })

  const save = useMutation({
    mutationFn: () => setPassword(password),
    onSuccess: (result) => {
      toast.success(t(result.change === 'set' ? 'password.setToast' : 'password.changedToast'))
      setEditing(false)
      setNewPassword('')
      done()
    },
    onError: (err) => {
      if (!isStepUpCancelled(err)) toast.error(errorMessage(err))
    },
  })
  const remove = useMutation({
    mutationFn: removePassword,
    onSuccess: () => {
      toast.success(t('password.removedToast'))
      done()
    },
    onError: (err) => {
      if (!isStepUpCancelled(err)) toast.error(errorMessage(err))
    },
  })

  if (!security.passwordAvailable) return null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Card>
      <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
          <KeyRound className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {security.hasPassword ? t('password.isSet') : t('password.notSet')}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {security.passwordChangedAt
              ? t('password.changedAt', { date: formatDate(security.passwordChangedAt) })
              : t('password.hint')}
          </p>
        </div>
      </div>
      <CardFooter>
        <p className="text-xs text-muted-foreground">{t('password.signOutNote')}</p>
        <div className="ml-auto flex gap-2">
          {security.hasPassword && (
            <Button
              size="sm"
              variant="ghost"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t('common.remove')}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {security.hasPassword ? t('password.change') : t('password.set')}
          </Button>
        </div>
      </CardFooter>

      {editing && (
        <Dialog
          title={security.hasPassword ? t('password.change') : t('password.set')}
          busy={save.isPending}
          onClose={() => setEditing(false)}
        >
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password">{t('reset.newPassword')}</Label>
              <Input
                id="new-password"
                type="password"
                required
                autoFocus
                autoComplete="new-password"
                minLength={options.passwordMinLength}
                maxLength={128}
                value={password}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('register.passwordHint', { count: options.passwordMinLength })}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={save.isPending}
                onClick={() => setEditing(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" loading={save.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </Card>
  )
}
