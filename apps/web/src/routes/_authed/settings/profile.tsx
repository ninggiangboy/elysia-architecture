import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { CircleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Section } from '@/components/layout/page-header'
import { PageSkeleton } from '@/components/layout/page-skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AvatarUploader } from '@/features/profile/avatar-uploader'
import { CoverUploader } from '@/features/profile/cover-uploader'
import { EditProfileForm } from '@/features/profile/edit-profile-form'
import { meQuery } from '@/features/profile/queries'

export const Route = createFileRoute('/_authed/settings/profile')({
  loader: ({ context }) => context.queryClient.ensureQueryData(meQuery),
  pendingComponent: ProfileSkeleton,
  errorComponent: ProfileError,
  component: ProfilePage,
})

function ProfilePage() {
  const { t } = useTranslation()
  const { data: me } = useSuspenseQuery(meQuery)

  return (
    <>
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

      <Section
        stacked
        title={t('profile.personalTitle')}
        description={t('profile.personalDescription')}
      >
        <EditProfileForm me={me} />
      </Section>
    </>
  )
}

function ProfileSkeleton() {
  const { t } = useTranslation()
  return <PageSkeleton label={t('profile.loading')} sections={1} />
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
