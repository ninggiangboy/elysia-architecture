import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useRef } from 'react'
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@/components/ui/dropdown'
import { type ThemePreference, themeStore, useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/** A menu to pick light / dark / system; the trigger shows the theme currently in effect. */
export function ThemeToggle({ className }: { className?: string }) {
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
        aria-label="Theme"
        title="Theme"
        className={cn(
          'inline-flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 aria-expanded:bg-muted aria-expanded:text-foreground',
          className,
        )}
        ref={triggerRef}
      >
        <Icon className="size-4" aria-hidden />
      </DropdownTrigger>
      <DropdownContent className="min-w-40" aria-label="Theme">
        {OPTIONS.map(({ value, label, icon: ItemIcon }) => (
          <DropdownItem key={value} checked={preference === value} onSelect={() => choose(value)}>
            <ItemIcon aria-hidden />
            <span className="flex-1">{label}</span>
            {preference === value && <Check className="!text-primary" aria-hidden />}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  )
}
