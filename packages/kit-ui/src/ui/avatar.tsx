import { cn } from '../utils'

/** "Ada Lovelace" → "AL", "ada.lovelace" → "AL", "ada" → "AD". */
function initials(name: string) {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '').slice(0, 2)
  return letters.toUpperCase() || '?'
}

export function Avatar({
  src,
  name,
  alt,
  className,
  decorative,
}: {
  src: string | null
  name: string
  /** Description of the picture for assistive tech; the name when omitted. */
  alt?: string
  className?: string
  /** Hide from assistive tech when the name is already next to it. */
  decorative?: boolean
}) {
  return (
    <span
      aria-hidden={decorative || undefined}
      className={cn(
        'inline-flex size-20 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary/80 to-fuchsia-500/80 text-xl font-semibold text-white',
        className,
      )}
    >
      {src ? (
        <img src={src} alt={decorative ? '' : (alt ?? name)} className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  )
}
