import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PushToggle } from '@/features/notifications/push-toggle'

export const Route = createFileRoute('/_authed/notifications/settings')({
  component: NotificationSettingsPage,
})

function NotificationSettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link
        to="/"
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back
      </Link>
      <PageHeader
        title="Notification settings"
        description="Choose how you hear about account activity. The notifications themselves are in the bell menu."
      />
      <PushToggle />
    </div>
  )
}
