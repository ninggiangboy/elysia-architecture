import { Avatar, Button, Card, CardContent } from '@kit/ui'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PageSkeleton } from '@/components/layout/page-skeleton'
import { passkeysQuery } from '@/features/account/queries'
import { SetupChecklist } from '@/features/account/setup-checklist'
import { meQuery } from '@/features/profile/queries'
import { formatDate } from '@/lib/format'

export const Route = createFileRoute('/_authed/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([queryClient.ensureQueryData(meQuery), queryClient.ensureQueryData(passkeysQuery)]),
  pendingComponent: OverviewSkeleton,
  component: OverviewPage,
})

/** Home: who you are and what to do next. Everything editable, the wallet included, lives in Settings. */
function OverviewPage() {
  const { t } = useTranslation()
  const { data: me } = useSuspenseQuery(meQuery)

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
          <Avatar
            decorative
            src={me.avatarUrl}
            name={me.displayName}
            className="size-16 text-2xl"
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {t('overview.welcome', { name: me.displayName })}
            </h1>
            <p className="truncate text-sm text-muted-foreground" data-testid="account-email">
              {me.email}
            </p>
            {me.createdAt && (
              <p className="mt-0.5 text-xs text-muted-foreground/80">
                {t('menu.memberSince', { date: formatDate(me.createdAt) })}
              </p>
            )}
          </div>
          <Button asChild variant="outline" size="sm" className="self-start sm:self-center">
            <Link to="/settings/profile">{t('overview.editProfile')}</Link>
          </Button>
        </CardContent>
      </Card>

      <SetupChecklist />
    </>
  )
}

function OverviewSkeleton() {
  const { t } = useTranslation()
  return <PageSkeleton label={t('overview.loading')} />
}
