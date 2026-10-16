import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { CircleAlert } from 'lucide-react'
import { PageHeader, Section } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ChangeEmailForm } from '@/features/account/change-email-form'
import { sessionsQuery } from '@/features/account/queries'
import { SessionsList } from '@/features/account/sessions-list'
import { AvatarUploader } from '@/features/profile/avatar-uploader'
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
  const { data: me } = useSuspenseQuery(meQuery)

  return (
    <>
      <PageHeader title="Profile" description="Manage how you appear and how you sign in." />

      <Card>
        <div
          aria-hidden
          className="h-24 bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_oklab,var(--primary)_55%,transparent),transparent_60%),radial-gradient(90%_140%_at_100%_100%,color-mix(in_oklab,#d946ef_35%,transparent),transparent_60%)] bg-accent sm:h-28"
        />
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
        title="Personal information"
        description="Your display name and a short bio, shown to people you interact with."
      >
        <EditProfileForm me={me} />
      </Section>

      <Section
        title="Email address"
        description="We send a confirmation link to the new address. Your email only changes once you open it."
      >
        <ChangeEmailForm currentEmail={me.email} />
      </Section>

      <Section
        title="Signed-in devices"
        description="Devices that can access your account. A device you sign out stops refreshing its session and may stay active for up to 15 more minutes."
      >
        <SessionsList />
      </Section>
    </>
  )
}

function ProfileSkeleton() {
  return (
    <div
      role="status"
      className="flex flex-col gap-8"
      aria-busy="true"
      aria-label="Loading profile"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Card>
        <Skeleton className="h-24 rounded-none sm:h-28" />
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
  const router = useRouter()
  return (
    <Card role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlert className="size-5" aria-hidden />
      </span>
      <div>
        <h1 className="font-semibold">Could not load your profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : 'Something went wrong, please try again'}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => router.invalidate()}>
        Try again
      </Button>
    </Card>
  )
}
