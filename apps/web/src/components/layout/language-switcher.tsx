import { LOCALE_NAMES, LOCALES } from '@app/shared-types/locales'
import { Check, Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from '@/components/ui/dropdown'
import { chooseLocale } from '@/features/account/locale'
import { cn } from '@/lib/utils'

/** A menu to pick the app's language; names are shown in their own language so anyone can find theirs. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
  return (
    <Dropdown>
      <DropdownTrigger
        aria-label={t('language.label')}
        title={t('language.label')}
        className={cn(
          'inline-flex size-10 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 aria-expanded:bg-muted aria-expanded:text-foreground sm:size-9',
          className,
        )}
      >
        <Languages className="size-4" aria-hidden />
      </DropdownTrigger>
      <DropdownContent className="min-w-40" aria-label={t('language.label')}>
        {LOCALES.map((locale) => (
          <DropdownItem
            key={locale}
            checked={i18n.language === locale}
            lang={locale}
            onSelect={() => void chooseLocale(locale)}
          >
            <span className="flex-1">{LOCALE_NAMES[locale]}</span>
            {i18n.language === locale && <Check className="!text-primary" aria-hidden />}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  )
}
