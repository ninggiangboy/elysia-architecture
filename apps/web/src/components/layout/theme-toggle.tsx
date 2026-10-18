import { cn, Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@kit/ui'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { type ThemePreference, themeStore, useTheme } from '@/lib/theme'

const OPTIONS = [
  { value: 'light', label: 'theme.light', icon: Sun },
  { value: 'dark', label: 'theme.dark', icon: Moon },
  { value: 'system', label: 'theme.system', icon: Monitor },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string; icon: typeof Sun }>

/** A menu to pick light / dark / system; the trigger shows the theme currently in effect. */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { preference, resolved } = useTheme()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const Icon = resolved === 'dark' ? Moon : Sun

  const choose = (value: ThemePreference) => {
    // Ripple out from the trigger's centre (also right for keyboard activation).
    const rect = triggerRef.current?.getBoundingClientRect()
    themeStore.set(value, rect && { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }

  return (
    <Dropdown>
      <DropdownTrigger
        aria-label={t('theme.label')}
        title={t('theme.label')}
        className={cn(
          'inline-flex size-10 items-center sm:size-9 justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 aria-expanded:bg-muted aria-expanded:text-foreground',
          className,
        )}
        ref={triggerRef}
      >
        <Icon className="size-4" aria-hidden />
      </DropdownTrigger>
      <DropdownContent className="min-w-40" aria-label={t('theme.label')}>
        {OPTIONS.map(({ value, label, icon: ItemIcon }) => (
          <DropdownItem key={value} checked={preference === value} onSelect={() => choose(value)}>
            <ItemIcon aria-hidden />
            <span className="flex-1">{t(label)}</span>
            {preference === value && <Check className="!text-primary" aria-hidden />}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  )
}
