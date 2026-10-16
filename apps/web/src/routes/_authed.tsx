import { createFileRoute, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { logout } from '@/features/auth/queries'
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

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <span className="font-semibold">Elysia Architecture</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground sm:inline">{user?.email}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await logout()
                await navigate({ to: '/login' })
              }}
            >
              <LogOut className="size-4" aria-hidden /> Đăng xuất
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
