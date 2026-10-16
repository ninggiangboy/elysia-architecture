import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type ThemePreference, themeStore, useTheme } from '@/lib/theme'

const LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' }
const ICON = { system: Monitor, light: Sun, dark: Moon }
const NEXT: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' }

/** One button that cycles system → light → dark; the icon shows the current preference. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference } = useTheme()
  const Icon = ICON[preference]
  const label = `Theme: ${LABEL[preference]}. Switch to ${LABEL[NEXT[preference]]}`
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      className={className}
      onClick={(e) => {
        // Ripple out from the button's centre (also right for keyboard activation).
        const rect = e.currentTarget.getBoundingClientRect()
        themeStore.set(NEXT[preference], { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      }}
    >
      <Icon aria-hidden />
    </Button>
  )
}
