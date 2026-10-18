import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '../utils'

const field =
  'w-full min-w-0 rounded-md border border-input bg-card px-3 text-base shadow-xs sm:text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 hover:border-muted-foreground/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-muted/30'

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn(field, 'h-10 sm:h-9', className)} {...props} />
)

export const Textarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cn(field, 'min-h-24 resize-y py-2 leading-relaxed', className)} {...props} />
)
