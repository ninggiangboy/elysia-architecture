import { BIO_MAX, DISPLAY_NAME_MAX } from '@app/shared-types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { meQuery, updateProfile } from './queries'

interface Me {
  displayName: string
  bio: string | null
  version: number
}

interface Values {
  displayName: string
  bio: string
}

const toValues = (me: Me): Values => ({ displayName: me.displayName, bio: me.bio ?? '' })
const sameValues = (a: Values, b: Values) => a.displayName === b.displayName && a.bio === b.bio
// `profile_conflict`: the profile row was created (asynchronously, after sign-up) while we were editing the default one.
const isConflict = (err: unknown) =>
  err instanceof ApiError && (err.code === 'version_conflict' || err.code === 'profile_conflict')

export function EditProfileForm({ me }: { me: Me }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  // The server version the form is editing; `me` may move ahead of it (another tab, an avatar upload, a refetch).
  const [base, setBase] = useState(me)
  const [values, setValues] = useState(() => toValues(me))
  const [conflict, setConflict] = useState(false)
  const dirty = !sameValues(values, toValues(base))

  // Follow server changes without losing edits: reset an untouched form, and rebase an edited one when the fields
  // it shows did not change (e.g. only the avatar did). A real conflict surfaces as a 409 on save.
  useEffect(() => {
    if (me.version === base.version) return
    if (!dirty) {
      setBase(me)
      setValues(toValues(me))
    } else if (sameValues(toValues(me), toValues(base))) {
      setBase(me)
    }
  }, [me, base, dirty])

  const loadLatest = () => {
    setBase(me)
    setValues(toValues(me))
    setConflict(false)
  }

  const save = useMutation({
    mutationFn: (version: number) =>
      updateProfile(
        { displayName: values.displayName, bio: values.bio.trim() === '' ? null : values.bio },
        version,
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data)
      setBase(data)
      setValues(toValues(data))
      setConflict(false)
      toast.success(t('profile.saved'))
    },
    onError: async (err, version) => {
      if (!isConflict(err)) {
        toast.error(errorMessage(err))
        return
      }
      const latest = await queryClient.fetchQuery({ ...meQuery, staleTime: 0 })
      // Nothing this form shows was changed elsewhere, so saving on top overwrites nobody's edits.
      if (latest.version !== version && sameValues(toValues(latest), toValues(base))) {
        save.mutate(latest.version)
        return
      }
      setConflict(true)
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(base.version)
  }
  const set = (field: keyof Values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }))

  return (
    <Card>
      <form onSubmit={submit}>
        <CardContent className="flex flex-col gap-5">
          {conflict && <ConflictNotice latest={toValues(me)} mine={values} />}
          <div className="flex flex-col gap-2">
            <Label htmlFor="displayName">{t('profile.displayName')}</Label>
            <Input
              id="displayName"
              required
              autoComplete="nickname"
              maxLength={DISPLAY_NAME_MAX}
              value={values.displayName}
              onChange={set('displayName')}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="bio">{t('profile.bio')}</Label>
              <span
                className={cn(
                  'text-xs tabular-nums text-muted-foreground',
                  values.bio.length >= BIO_MAX && 'text-warning',
                )}
              >
                {values.bio.length}/{BIO_MAX}
              </span>
            </div>
            <Textarea
              id="bio"
              maxLength={BIO_MAX}
              placeholder={t('profile.bioPlaceholder')}
              value={values.bio}
              onChange={set('bio')}
            />
          </div>
        </CardContent>
        <CardFooter>
          {conflict ? (
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadLatest}
                disabled={save.isPending}
              >
                {t('profile.loadLatest')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => save.mutate(me.version)}
                loading={save.isPending}
              >
                {t('profile.overwrite')}
              </Button>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {dirty ? t('profile.unsaved') : t('profile.upToDate')}
              </p>
              <div className="ml-auto flex gap-2">
                {dirty && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setValues(toValues(base))}
                    disabled={save.isPending}
                  >
                    {t('profile.discard')}
                  </Button>
                )}
                <Button type="submit" size="sm" disabled={!dirty} loading={save.isPending}>
                  {t('profile.save')}
                </Button>
              </div>
            </>
          )}
        </CardFooter>
      </form>
    </Card>
  )
}

function ConflictNotice({ latest, mine }: { latest: Values; mine: Values }) {
  const { t } = useTranslation()
  const changed = [
    {
      label: t('profile.displayName'),
      value: latest.displayName,
      differs: latest.displayName !== mine.displayName,
    },
    { label: t('profile.bio'), value: latest.bio, differs: latest.bio !== mine.bio },
  ].filter((f) => f.differs)

  return (
    <div
      role="alert"
      data-testid="profile-conflict"
      className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
    >
      <p className="font-medium">{t('profile.conflictTitle')}</p>
      {changed.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {changed.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-muted-foreground">
                {t('profile.conflictField', { field: f.label })}
              </dt>
              <dd className="min-w-0 break-words">
                {f.value || <em>{t('profile.conflictEmpty')}</em>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-xs text-muted-foreground">{t('profile.conflictHelp')}</p>
    </div>
  )
}
