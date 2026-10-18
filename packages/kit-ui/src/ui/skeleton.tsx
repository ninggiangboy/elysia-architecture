import type { HTMLAttributes } from 'react'
import { cn } from '../utils'

export const Skeleton = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
)
