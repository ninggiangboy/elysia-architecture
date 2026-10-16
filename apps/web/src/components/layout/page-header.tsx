import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  )
}

/**
 * A settings block: title and explanation on the left (on top on small screens), the card on the right.
 * `stacked` keeps the title above the card at every width, for a column that is already narrow (inside Settings).
 */
export function Section({
  title,
  description,
  children,
  stacked,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  stacked?: boolean
}) {
  return (
    <section
      className={
        stacked
          ? 'grid gap-4 border-t border-border pt-8 first:border-t-0 first:pt-0'
          : 'grid gap-4 border-t border-border pt-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-10'
      }
    >
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}
