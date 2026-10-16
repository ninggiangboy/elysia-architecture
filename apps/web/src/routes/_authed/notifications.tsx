import { createFileRoute } from '@tanstack/react-router'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { NotificationsList } from '@/features/notifications/notifications-list'

export const Route = createFileRoute('/_authed/notifications')({
  component: NotificationsPage,
})

function NotificationsPage() {
  return (
    <Card>
      <CardTitle>Notifications</CardTitle>
      <CardDescription>
        Account activity such as a changed email address. New ones appear here as they happen.
      </CardDescription>
      <NotificationsList />
    </Card>
  )
}
