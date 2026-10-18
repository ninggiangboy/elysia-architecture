import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../utils'

const variants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity] outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 active:bg-primary/85',
        secondary: 'bg-muted text-foreground hover:bg-muted/70',
        outline:
          'border border-input bg-card shadow-xs hover:bg-muted hover:text-foreground dark:bg-muted/40 dark:hover:bg-muted',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        destructive:
          'border border-destructive/30 bg-card text-destructive shadow-xs hover:border-destructive/50 hover:bg-destructive/10 dark:bg-transparent',
      },
      size: {
        default: 'h-10 px-4 sm:h-9',
        sm: 'h-9 px-3 text-[13px] sm:h-8',
        lg: 'h-11 px-5 sm:h-10',
        icon: 'size-10 sm:size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof variants> {
  asChild?: boolean
  /** Shows a spinner in front of the label and disables the button. */
  loading?: boolean
}

export function Button({
  className,
  variant,
  size,
  asChild,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(variants({ variant, size }), className)
  if (asChild)
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    )
  return (
    <button className={classes} disabled={disabled || loading} {...props}>
      {loading && <LoaderCircle className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
}
