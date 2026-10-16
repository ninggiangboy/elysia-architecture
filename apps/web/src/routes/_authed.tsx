import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import { LayoutDashboard, Radio, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '@/components/layout/language-switcher'
import { Logo } from '@/components/layout/logo'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { UserMenu } from '@/components/layout/user-menu'
import { StepUpHost } from '@/features/auth/step-up-dialog'
import { NotificationBell } from '@/features/notifications/notification-bell'
import { unseenCountQuery } from '@/features/notifications/queries'
import { meQuery } from '@/features/profile/queries'
import { useLiveSession } from '@/features/realtime/use-live-session'
import { adoptLocale } from '@/i18n'
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
      queryClient.prefetchQuery(unseenCountQuery),
    ])
    const me = queryClient.getQueryData(meQuery.queryKey)
    // The account's language wins over this browser's: it is what the emails and notifications use.
    if (me) adoptLocale(me.locale)
    if (me?.avatarUrl) await preloadImage(me.avatarUrl)
  },
  component: AuthedLayout,
})

// `exact` keeps Overview from lighting up on every page; the other sections own everything below them.
const NAV = [
  { to: '/', label: 'nav.overview', icon: LayoutDashboard, exact: true },
  { to: '/realtime', label: 'nav.realtime', icon: Radio, exact: false },
] as const

// Settings is reached from the user menu on wide screens; phones have no room there, so it gets a tab.
const TABS = [
  ...NAV,
  { to: '/settings', label: 'nav.settings', icon: Settings, exact: false },
] as const

function AuthedLayout() {
  const { t } = useTranslation()
  useLiveSession()

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-x-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <Logo />
            <span className="hidden sm:inline">Elysia Architecture</span>
            <span className="sm:hidden">Elysia</span>
          </Link>

          {/* Inline from md; below that the same links live in the tab bar at the bottom of the screen. */}
          <nav aria-label={t('nav.main')} className="hidden gap-1 md:flex">
            {NAV.map(({ to, label, icon: Icon, exact }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact }}
                className="flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
              >
                <Icon className="size-4" aria-hidden />
                {t(label)}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            <LanguageSwitcher />
            <ThemeToggle />
            <NotificationBell />
            <div className="mx-1 h-6 w-px bg-border" />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-10 md:pb-10">
        <Outlet />
      </main>
      <StepUpHost />

      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-border bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
      >
        {TABS.map(({ to, label, icon: Icon, exact }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact }}
            className="flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors [&.active]:text-primary"
          >
            <Icon className="size-5" aria-hidden />
            {t(label)}
          </Link>
        ))}
      </nav>
    </div>
  )
}
