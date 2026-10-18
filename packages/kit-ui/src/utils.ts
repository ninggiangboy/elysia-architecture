import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Joins class names and resolves Tailwind conflicts (`cn('p-2', cond && 'p-4')` keeps the last padding). */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
