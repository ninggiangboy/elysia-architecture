import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '@kit/ui'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { pushStateQuery } from '@/features/notifications/push-toggle'
import { meQuery } from '@/features/profile/queries'
import { passkeysQuery } from './queries'

/** A few optional steps that make the account safer, each a link to the setting that does it. Gone once all are done. */
export function SetupChecklist() {
  const { t } = useTranslation()
  const { data: me } = useSuspenseQuery(meQuery)
  const { data: passkeys } = useSuspenseQuery(passkeysQuery)
  const { data: push } = useQuery(pushStateQuery)

  const steps = [
    {
      to: '/settings/profile',
      label: 'overview.stepProfile',
      done: Boolean(me.bio) && Boolean(me.avatarUrl),
    },
    { to: '/settings/security', label: 'overview.stepPasskey', done: passkeys.length > 0 },
    // Where the browser cannot do push, the step would be a dead end: leave it out.
    ...(push && push !== 'unsupported' && push !== 'unavailable'
      ? ([
          { to: '/settings/notifications', label: 'overview.stepPush', done: push === 'on' },
        ] as const)
      : []),
  ] as const

  if (steps.every((s) => s.done)) return null

  return (
    <Card data-testid="setup-checklist">
      <CardHeader>
        <CardTitle>{t('overview.checklistTitle')}</CardTitle>
        <CardDescription>{t('overview.checklistDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="px-2 pb-2 sm:px-3">
        <ul className="flex flex-col">
          {steps.map(({ to, label, done }) => (
            <li key={to}>
              <Link
                to={to}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-muted"
              >
                <span
                  className={cn(
                    'grid size-5 shrink-0 place-items-center rounded-full border',
                    done ? 'border-success bg-success text-white' : 'border-input text-transparent',
                  )}
                >
                  <Check className="size-3" aria-hidden />
                </span>
                <span className={done ? 'text-muted-foreground line-through' : 'font-medium'}>
                  {t(label)}
                </span>
                <ChevronRight
                  className="ml-auto size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
