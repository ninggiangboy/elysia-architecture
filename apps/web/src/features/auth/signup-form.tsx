import { Button, CardContent, Input, Label } from '@kit/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/api'
import type { PendingSignIn } from './pending'
import { authOptionsQuery, completeSignup } from './queries'
import { TermsField } from './terms-field'

/** The email is proven but no account exists yet: choose a name and accept the terms to create it. */
export function SignupForm({
  pending,
  onDone,
  onBack,
}: {
  pending: Extract<PendingSignIn, { kind: 'signup' }>
  onDone: () => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const { data: options } = useQuery(authOptionsQuery)
  const [name, setName] = useState(pending.suggestedName ?? '')
  const [accepted, setAccepted] = useState(false)
  const create = useMutation({
    mutationFn: () =>
      completeSignup({
        signupToken: pending.token,
        displayName: name.trim() || undefined,
        acceptTerms: accepted,
      }),
    onSuccess: onDone,
    onError: (err) => toast.error(errorMessage(err)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }
  return (
    <CardContent>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{t('signup.title')}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('signup.intro', { email: pending.email })}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="signup-name">{t('signup.name')}</Label>
          <Input
            id="signup-name"
            autoFocus
            maxLength={50}
            autoComplete="name"
            className="sm:h-10"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('signup.nameHint')}</p>
        </div>
        <TermsField
          id="signup-terms"
          checked={accepted}
          onChange={setAccepted}
          url={options?.termsUrl ?? null}
        />
        <Button type="submit" size="lg" loading={create.isPending} disabled={!accepted}>
          {t('signup.create')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          {t('signup.cancel')}
        </Button>
      </form>
    </CardContent>
  )
}
