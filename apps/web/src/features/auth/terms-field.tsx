import { useTranslation } from 'react-i18next'

/** The "I accept the terms" box. Rendered only where the deployment has terms. */
export function TermsField({
  id,
  checked,
  onChange,
  url,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  url: string | null
}) {
  const { t } = useTranslation()
  return (
    <label htmlFor={id} className="flex items-start gap-2.5 text-sm leading-relaxed">
      <input
        id={id}
        type="checkbox"
        required
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 shrink-0 accent-primary"
      />
      <span>
        {t('terms.accept')}{' '}
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {t('terms.read')}
          </a>
        )}
      </span>
    </label>
  )
}
