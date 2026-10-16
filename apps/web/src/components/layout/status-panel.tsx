import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const TONES = {
  pending: { icon: LoaderCircle, className: 'bg-muted text-muted-foreground [&_svg]:animate-spin' },
  success: { icon: CircleCheck, className: 'bg-success/12 text-success' },
  error: { icon: CircleAlert, className: 'bg-destructive/10 text-destructive' },
} as const

/** A one-message card (icon, title, text, action) for link callbacks and other transient states. */
export function StatusPanel({
  tone,
  title,
  children,
  action,
}: {
  tone: keyof typeof TONES
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  const { icon: Icon, className } = TONES[tone]
  return (
    <Card role="status" className="flex flex-col items-center gap-4 px-6 py-8 text-center">
      <span className={cn('grid size-12 place-items-center rounded-full', className)}>
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        {title && <h1 className="text-lg font-semibold tracking-tight">{title}</h1>}
        {children && (
          <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
        )}
      </div>
      {action}
    </Card>
  )
}
