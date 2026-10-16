import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, LoaderCircle, LogOut, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@/components/ui/dropdown'
import { logout } from '@/features/auth/queries'
import { meQuery } from '@/features/profile/queries'
import { useAuth } from '@/lib/auth-store'
import { formatDate } from '@/lib/format'

/** Header account menu: who is signed in (name, email, bio, member since) and the sign-out action. */
export function UserMenu() {
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
        aria-label="Account menu"
        title={email}
        className="group flex h-9 items-center gap-1.5 rounded-full py-1 pr-2 pl-1 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 aria-expanded:bg-muted"
      >
        <Avatar decorative src={me?.avatarUrl ?? null} name={name} className="size-7 text-[11px]" />
        <ChevronDown
          className="size-3.5 text-muted-foreground transition-transform group-aria-expanded:rotate-180"
          aria-hidden
        />
      </DropdownTrigger>
      <DropdownContent className="w-72 max-w-[calc(100vw-2rem)] p-0" aria-label="Account">
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
        {(me?.bio || me?.createdAt) && (
          <div className="space-y-1.5 border-t border-border px-4 py-3 text-[13px]">
            {me.bio && (
              <p className="line-clamp-3 whitespace-pre-line text-muted-foreground">{me.bio}</p>
            )}
            {me.createdAt && (
              <p className="text-xs text-muted-foreground/80">
                Member since {formatDate(me.createdAt)}
              </p>
            )}
          </div>
        )}
        <div className="border-t border-border p-1">
          <DropdownItem onSelect={() => navigate({ to: '/security' })}>
            <ShieldCheck aria-hidden />
            Security
          </DropdownItem>
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
            Sign out
          </DropdownItem>
        </div>
      </DropdownContent>
    </Dropdown>
  )
}
