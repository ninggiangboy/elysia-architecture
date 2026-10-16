import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
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
  pendingComponent: () => <p className="text-sm text-muted-foreground">Loading…</p>,
  errorComponent: ({ error }) => (
    <p role="alert" className="text-sm text-destructive">
      {(error as Error).message}
    </p>
  ),
  component: ProfilePage,
})

function ProfilePage() {
  const { data: me } = useSuspenseQuery(meQuery)

  return (
    <>
      <Card className="flex items-center gap-5">
        <AvatarUploader name={me.displayName} avatarUrl={me.avatarUrl} />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold" data-testid="display-name">
            {me.displayName}
          </h1>
          <p className="truncate text-sm text-muted-foreground" data-testid="account-email">
            {me.email}
          </p>
          {me.bio && <p className="mt-2 text-sm">{me.bio}</p>}
        </div>
      </Card>

      <Card>
        <CardTitle>Personal information</CardTitle>
        <CardDescription>Display name and a short bio.</CardDescription>
        <EditProfileForm me={me} />
      </Card>

      <Card>
        <CardTitle>Change email address</CardTitle>
        <CardDescription>
          We will send a confirmation link to the new address; your email only changes once you
          click that link.
        </CardDescription>
        <ChangeEmailForm currentEmail={me.email} />
      </Card>

      <Card>
        <CardTitle>Signed-in devices</CardTitle>
        <CardDescription>
          Devices that can currently access your account. Signing one out stops it from refreshing
          its session; it may stay active for up to 15 more minutes.
        </CardDescription>
        <SessionsList />
      </Card>
    </>
  )
}
