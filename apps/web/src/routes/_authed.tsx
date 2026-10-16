import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import { Radio, UserRound } from 'lucide-react'
import { Logo } from '@/components/layout/logo'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { UserMenu } from '@/components/layout/user-menu'
import { NotificationBell } from '@/features/notifications/notification-bell'
import { unreadCountQuery } from '@/features/notifications/queries'
import { meQuery } from '@/features/profile/queries'
import { useLiveSession } from '@/features/realtime/use-live-session'
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
  useLiveSession()

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
            <ThemeToggle />
            <NotificationBell />
            <div className="mx-1 h-6 w-px bg-border" />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  )
}
