import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { LogOut, Radio, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Logo } from '@/components/layout/logo'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { logout } from '@/features/auth/queries'
import { NotificationBell } from '@/features/notifications/notification-bell'
import { unreadCountQuery } from '@/features/notifications/queries'
import { meQuery } from '@/features/profile/queries'
import { useLiveSession } from '@/features/realtime/use-live-session'
import { useAuth } from '@/lib/auth-store'
import { ensureSession } from '@/lib/session'
import { preloadImage } from '@/lib/utils'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async () => {
    if (!(await ensureSession())) throw redirect({ to: '/login' })
  },
  // The header needs these on every page: load them with the page so it does not fill in piece by piece.
  // prefetchQuery never throws — a failure here only leaves the header without them, the page still renders.
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      queryClient.prefetchQuery(meQuery),
      queryClient.prefetchQuery(unreadCountQuery),
    ])
    const avatarUrl = queryClient.getQueryData(meQuery.queryKey)?.avatarUrl
    if (avatarUrl) await preloadImage(avatarUrl)
  },
  component: AuthedLayout,
})

const NAV = [
  { to: '/', label: 'Profile', icon: UserRound },
  { to: '/realtime', label: 'Realtime', icon: Radio },
] as const

function AuthedLayout() {
  const { user } = useAuth()
  const { data: me } = useQuery(meQuery)
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  useLiveSession()

  const signOut = async () => {
    setSigningOut(true)
    try {
      await logout()
      await navigate({ to: '/login' })
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 px-4 sm:px-6">
          <Link to="/" className="flex h-14 items-center gap-2.5 font-semibold tracking-tight">
            <Logo />
            <span className="hidden sm:inline">Elysia Architecture</span>
            <span className="sm:hidden">Elysia</span>
          </Link>

          {/* One nav for every width: a second row of tabs on small screens, inline on md+. */}
          <nav
            aria-label="Main"
            className="order-last -mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto border-t border-border px-3 py-1.5 sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-5 md:order-none md:mx-0 md:w-auto md:border-0 md:p-0"
          >
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: true }}
                className="flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex h-14 items-center gap-1.5">
            <NotificationBell />
            <div className="mx-1.5 hidden h-6 w-px bg-border sm:block" />
            <div className="hidden min-w-0 items-center gap-2.5 sm:flex">
              <Avatar
                decorative
                src={me?.avatarUrl ?? null}
                name={me?.displayName ?? user?.email ?? ''}
                className="size-7 text-[11px]"
              />
              <div className="hidden max-w-48 flex-col leading-tight lg:flex">
                <span className="truncate text-sm font-medium">{me?.displayName}</span>
                <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Sign out"
              title="Sign out"
              className="ml-1"
              loading={signingOut}
              onClick={signOut}
            >
              {!signingOut && <LogOut aria-hidden />}
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  )
}
