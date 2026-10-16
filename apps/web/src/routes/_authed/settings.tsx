import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { Bell, ShieldCheck, SlidersHorizontal, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/page-header'

export const Route = createFileRoute('/_authed/settings')({
  component: SettingsLayout,
})

const TABS = [
  { to: '/settings/profile', label: 'settings.nav.profile', icon: UserRound },
  { to: '/settings/account', label: 'settings.nav.account', icon: SlidersHorizontal },
  { to: '/settings/security', label: 'settings.nav.security', icon: ShieldCheck },
  { to: '/settings/notifications', label: 'settings.nav.notifications', icon: Bell },
] as const

/** Every setting lives under here: a sidebar on wide screens, a row of tabs on phones. */
function SettingsLayout() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <div className="grid items-start gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
        <nav
          aria-label={t('settings.title')}
          className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 md:sticky md:top-20 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0"
        >
          {TABS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
            >
              {/* Phones have room for the words or the icons, not both. */}
              <Icon className="hidden size-4 md:block" aria-hidden />
              {t(label)}
            </Link>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-8">
          <Outlet />
        </div>
      </div>
    </>
  )
}
