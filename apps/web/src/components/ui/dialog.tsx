import { type ReactNode, useEffect, useId, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * A modal on the native `<dialog>`: focus trap, Esc and the backdrop come from the browser. Mount it to open it,
 * unmount it to close it. While `busy`, Esc and backdrop clicks are ignored.
 */
export function Dialog({
  title,
  onClose,
  busy,
  className,
  children,
}: {
  title: string
  onClose: () => void
  busy?: boolean
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  // A drag that starts inside the dialog and is released over the backdrop must not count as a backdrop click.
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => (busy ? e.preventDefault() : undefined)}
      onClose={onClose}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === ref.current
      }}
      onClick={(e) => e.target === ref.current && pressedBackdrop.current && !busy && onClose()}
      className={cn(
        'm-auto w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50',
        className,
      )}
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 id={titleId} className="text-[15px] font-semibold tracking-tight">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  )
}
