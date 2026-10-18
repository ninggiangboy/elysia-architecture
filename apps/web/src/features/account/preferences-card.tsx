import { LOCALE_NAMES, LOCALES } from '@app/shared-types/locales'
import { Card, CardContent, cn } from '@kit/ui'
import { Monitor, Moon, Sun } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { type ThemePreference, themeStore, useTheme } from '@/lib/theme'
import { chooseLocale } from './locale'

const THEMES = [
  { value: 'light', label: 'theme.light', icon: Sun },
  { value: 'dark', label: 'theme.dark', icon: Moon },
  { value: 'system', label: 'theme.system', icon: Monitor },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string; icon: typeof Sun }>

function Choice({
  checked,
  onSelect,
  children,
  ...props
}: {
  checked: boolean
  onSelect: (origin: DOMRect) => void
  children: ReactNode
  lang?: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={checked}
      onClick={() => ref.current && onSelect(ref.current.getBoundingClientRect())}
      className={cn(
        'flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 sm:h-9',
        checked
          ? 'border-primary bg-accent text-accent-foreground'
          : 'border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/** The same language and theme choices as the header menus, laid out where people look for "settings". */
export function PreferencesCard() {
  const { t, i18n } = useTranslation()
  const { preference } = useTheme()

  return (
    <Card>
      <CardContent className="flex flex-col gap-6">
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-3 p-0 text-sm font-medium leading-none">
            {t('language.label')}
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LOCALES.map((locale) => (
              <Choice
                key={locale}
                lang={locale}
                checked={i18n.language === locale}
                onSelect={() => void chooseLocale(locale)}
              >
                {LOCALE_NAMES[locale]}
              </Choice>
            ))}
          </div>
        </fieldset>
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-3 p-0 text-sm font-medium leading-none">{t('theme.label')}</legend>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <Choice
                key={value}
                checked={preference === value}
                onSelect={(r) =>
                  themeStore.set(value, { x: r.left + r.width / 2, y: r.top + r.height / 2 })
                }
              >
                <Icon className="size-4" aria-hidden />
                {t(label)}
              </Choice>
            ))}
          </div>
        </fieldset>
      </CardContent>
    </Card>
  )
}
