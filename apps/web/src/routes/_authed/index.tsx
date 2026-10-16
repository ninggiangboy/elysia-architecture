import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { ChangeEmailForm } from '@/features/account/change-email-form'
import { AvatarUploader } from '@/features/profile/avatar-uploader'
import { EditProfileForm } from '@/features/profile/edit-profile-form'
import { meQuery } from '@/features/profile/queries'

export const Route = createFileRoute('/_authed/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(meQuery),
  pendingComponent: () => <p className="text-sm text-muted-foreground">Đang tải…</p>,
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
        <CardTitle>Thông tin cá nhân</CardTitle>
        <CardDescription>Tên hiển thị và giới thiệu ngắn.</CardDescription>
        <EditProfileForm me={me} />
      </Card>

      <Card>
        <CardTitle>Đổi địa chỉ email</CardTitle>
        <CardDescription>
          Chúng tôi sẽ gửi liên kết xác nhận tới địa chỉ mới; email chỉ đổi khi bạn bấm vào liên kết
          đó.
        </CardDescription>
        <ChangeEmailForm currentEmail={me.email} />
      </Card>
    </>
  )
}
