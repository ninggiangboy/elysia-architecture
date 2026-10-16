import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/page-header'
import { NotificationsList } from '@/features/notifications/notifications-list'
import { PushToggle } from '@/features/notifications/push-toggle'

export const Route = createFileRoute('/_authed/notifications')({
  component: NotificationsPage,
})

function NotificationsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Account activity such as a changed email address. New ones appear here as they happen."
      />
      <PushToggle />
      <NotificationsList />
    </div>
  )
}
