import { Dialog } from '@kit/ui'
import { useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useMaintenance } from '@/lib/maintenance'

/**
 * Covers the whole app while the API is in maintenance mode or cannot be reached. It cannot be dismissed (no Esc, no backdrop
 * click, no button): it goes away by itself when the API answers again, and then everything on screen is fetched again.
 */
export function MaintenanceDialog() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const kind = useMaintenance()
  const active = kind !== null
  const wasActive = useRef(false)

  useEffect(() => {
    if (wasActive.current && !active) void queryClient.invalidateQueries()
    wasActive.current = active
  }, [active, queryClient])

  if (!kind) return null
  return (
    <Dialog title={t(`outage.${kind}.title`)} role="alertdialog" busy onClose={() => {}}>
      <div className="flex items-start gap-3 text-sm text-muted-foreground">
        <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
        <p>{t(`outage.${kind}.body`)}</p>
      </div>
    </Dialog>
  )
}
