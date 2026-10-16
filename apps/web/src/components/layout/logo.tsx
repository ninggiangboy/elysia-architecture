import { cn } from '@/lib/utils'

/** The app mark: a gradient tile with a stylised "E". */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-fuchsia-500 text-white shadow-sm shadow-primary/30',
        className,
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="size-[60%]"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
      >
        <path d="M17 6H8v12h9M8 12h7" />
      </svg>
    </span>
  )
}
