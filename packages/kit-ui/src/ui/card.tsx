import type { HTMLAttributes } from 'react'
import { cn } from '../utils'

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'overflow-hidden rounded-xl border border-border bg-card shadow-xs shadow-black/[0.03]',
      className,
    )}
    {...props}
  />
)

export const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1 px-5 pt-5 sm:px-6 sm:pt-6', className)} {...props} />
)

export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h2 className={cn('text-[15px] font-semibold leading-6 tracking-tight', className)} {...props} />
)

export const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-sm leading-relaxed text-muted-foreground', className)} {...props} />
)

export const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-5 sm:p-6', className)} {...props} />
)

/** Action bar at the bottom of a card: a hint on the left, the buttons on the right. */
export const CardFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-5 py-3 sm:px-6',
      className,
    )}
    {...props}
  />
)
