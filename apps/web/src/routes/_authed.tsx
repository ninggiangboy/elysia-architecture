import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { logout } from '@/features/auth/queries'
import { NotificationBell } from '@/features/notifications/notification-bell'
import { useLiveSession } from '@/features/realtime/use-live-session'
import { useAuth } from '@/lib/auth-store'
import { ensureSession } from '@/lib/session'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async () => {
    if (!(await ensureSession())) throw redirect({ to: '/login' })
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const { user } = useAuth()
  const navigate = useNavigate()
  useLiveSession()

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <nav className="flex items-center gap-4">
            <span className="font-semibold">Elysia Architecture</span>
            <Link to="/" className="text-sm text-muted-foreground [&.active]:text-foreground">
              Profile
            </Link>
            <Link
              to="/realtime"
              className="text-sm text-muted-foreground [&.active]:text-foreground"
            >
              Realtime
            </Link>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <NotificationBell />
            <span className="hidden text-muted-foreground sm:inline">{user?.email}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await logout()
                await navigate({ to: '/login' })
              }}
            >
              <LogOut className="size-4" aria-hidden /> Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
