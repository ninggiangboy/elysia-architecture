import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, LoaderCircle, LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@/components/ui/avatar'
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@/components/ui/dropdown'
import { logout } from '@/features/auth/queries'
import { meQuery } from '@/features/profile/queries'
import { useAuth } from '@/lib/auth-store'

/** Header account menu: who is signed in, the way into the settings, and the sign-out action. */
export function UserMenu() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { data: me } = useQuery(meQuery)
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  const email = me?.email ?? user?.email ?? ''
  const name = me?.displayName ?? email

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
    <Dropdown>
      <DropdownTrigger
        aria-label={t('menu.account')}
        title={email}
        className="group flex h-10 items-center sm:h-9 gap-1.5 rounded-full py-1 pr-2 pl-1 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 aria-expanded:bg-muted"
      >
        <Avatar decorative src={me?.avatarUrl ?? null} name={name} className="size-7 text-[11px]" />
        <ChevronDown
          className="size-3.5 text-muted-foreground transition-transform group-aria-expanded:rotate-180"
          aria-hidden
        />
      </DropdownTrigger>
      <DropdownContent
        className="w-72 max-w-[calc(100vw-2rem)] p-0"
        aria-label={t('menu.accountLabel')}
      >
        <div className="flex items-start gap-3 p-4" data-testid="user-menu-info">
          <Avatar
            decorative
            src={me?.avatarUrl ?? null}
            name={name}
            className="size-11 text-base"
          />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate font-semibold">{name}</p>
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{email}</p>
          </div>
        </div>
        <div className="border-t border-border p-1">
          <DropdownItem onSelect={() => navigate({ to: '/settings/profile' })}>
            <UserRound aria-hidden />
            {t('menu.profile')}
          </DropdownItem>
          <DropdownItem onSelect={() => navigate({ to: '/settings/account' })}>
            <Settings aria-hidden />
            {t('menu.settings')}
          </DropdownItem>
          <DropdownItem onSelect={() => navigate({ to: '/settings/security' })}>
            <ShieldCheck aria-hidden />
            {t('menu.security')}
          </DropdownItem>
        </div>
        <div className="border-t border-border p-1">
          <DropdownItem
            closeOnSelect={false}
            disabled={signingOut}
            onSelect={signOut}
            className="text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10 [&_svg]:text-destructive"
          >
            {signingOut ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <LogOut aria-hidden />
            )}
            {t('menu.signOut')}
          </DropdownItem>
        </div>
      </DropdownContent>
    </Dropdown>
  )
}
