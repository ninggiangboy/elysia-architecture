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

/** A settings block: title and explanation on the left (on top on small screens), the card on the right. */
export function Section({
  title,
  description,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="grid gap-4 border-t border-border pt-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-10">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}
