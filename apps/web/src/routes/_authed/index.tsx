import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { CircleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader, Section } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ChangeEmailForm } from '@/features/account/change-email-form'
import { sessionsQuery } from '@/features/account/queries'
import { SessionsList } from '@/features/account/sessions-list'
import { AvatarUploader } from '@/features/profile/avatar-uploader'
import { CoverUploader } from '@/features/profile/cover-uploader'
import { EditProfileForm } from '@/features/profile/edit-profile-form'
import { meQuery } from '@/features/profile/queries'

export const Route = createFileRoute('/_authed/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(meQuery),
      context.queryClient.ensureQueryData(sessionsQuery),
    ]),
  pendingComponent: ProfileSkeleton,
  errorComponent: ProfileError,
  component: ProfilePage,
})

function ProfilePage() {
  const { t } = useTranslation()
  const { data: me } = useSuspenseQuery(meQuery)

  return (
    <>
      <PageHeader title={t('profile.title')} description={t('profile.description')} />

      <Card>
        <CoverUploader coverUrl={me.coverUrl} />
        <CardContent className="flex flex-col gap-4 pt-0 sm:flex-row sm:items-end sm:gap-5">
          <AvatarUploader name={me.displayName} avatarUrl={me.avatarUrl} />
          <div className="min-w-0 sm:pb-1">
            <h2
              className="truncate text-xl font-semibold tracking-tight"
              data-testid="display-name"
            >
              {me.displayName}
            </h2>
            <p className="truncate text-sm text-muted-foreground" data-testid="account-email">
              {me.email}
            </p>
          </div>
        </CardContent>
        {me.bio && (
          <p className="-mt-1 px-5 pb-5 text-sm leading-relaxed whitespace-pre-line text-foreground/90 sm:px-6 sm:pb-6">
            {me.bio}
          </p>
        )}
      </Card>

      <Section title={t('profile.personalTitle')} description={t('profile.personalDescription')}>
        <EditProfileForm me={me} />
      </Section>

      <Section title={t('profile.emailTitle')} description={t('profile.emailDescription')}>
        <ChangeEmailForm currentEmail={me.email} />
      </Section>

      <Section title={t('profile.devicesTitle')} description={t('profile.devicesDescription')}>
        <SessionsList />
      </Section>
    </>
  )
}

function ProfileSkeleton() {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      className="flex flex-col gap-8"
      aria-busy="true"
      aria-label={t('profile.loading')}
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Card>
        <Skeleton className="aspect-[4/1] rounded-none" />
        <CardContent className="flex items-end gap-5 pt-0">
          <Skeleton className="-mt-10 size-24 rounded-full border-4 border-card" />
          <div className="flex flex-1 flex-col gap-2 pb-1">
            <Skeleton className="h-5 w-48 max-w-full" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
        </CardContent>
      </Card>
      {[0, 1].map((i) => (
        <div key={i} className="grid gap-4 border-t border-border pt-8 md:grid-cols-3 md:gap-10">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="h-48 rounded-xl md:col-span-2" />
        </div>
      ))}
    </div>
  )
}

function ProfileError({ error }: { error: unknown }) {
  const { t } = useTranslation()
  const router = useRouter()
  return (
    <Card role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlert className="size-5" aria-hidden />
      </span>
      <div>
        <h1 className="font-semibold">{t('profile.loadFailed')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : t('common.unknownError')}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => router.invalidate()}>
        {t('common.tryAgain')}
      </Button>
    </Card>
  )
}
