import { cn } from '@/lib/utils'

export function Avatar({ src, name, className }: { src: string | null; name: string; className?: string }) {
  const initials = name.trim().slice(0, 2).toUpperCase() || '?'
  return (
    <span
      className={cn(
        'inline-flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xl font-semibold text-muted-foreground',
        className,
      )}
    >
      {src ? <img src={src} alt={`Ảnh đại diện của ${name}`} className="size-full object-cover" /> : initials}
    </span>
  )
}
