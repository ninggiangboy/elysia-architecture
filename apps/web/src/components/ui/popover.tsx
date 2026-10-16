import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { cn } from '@/lib/utils'

interface PopoverContext {
  open: boolean
  setOpen: (open: boolean) => void
  panelId: string
  triggerRef: React.RefObject<HTMLButtonElement | null>
  /** Close and hand focus back to the trigger. */
  close: () => void
}

const Ctx = createContext<PopoverContext | null>(null)
const usePopover = () => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('Popover parts must be rendered inside <Popover>')
  return ctx
}

/** A panel anchored to its trigger that holds arbitrary content (unlike `Dropdown`, which is a menu). Closes on outside click and Escape. */
export function Popover({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  return (
    <Ctx.Provider value={{ open, setOpen, panelId, triggerRef, close }}>
      <div ref={rootRef} className="relative">
        {children}
      </div>
    </Ctx.Provider>
  )
}

export function PopoverTrigger({
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen, panelId, triggerRef } = usePopover()
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={(e) => {
        onClick?.(e)
        setOpen(!open)
      }}
      {...props}
    />
  )
}

export function PopoverContent({
  className,
  align = 'end',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { align?: 'start' | 'end' }) {
  const { open, panelId } = usePopover()
  if (!open) return null
  return (
    <div
      id={panelId}
      role="dialog"
      className={cn(
        'absolute top-full z-50 mt-2 origin-top overflow-hidden rounded-lg border border-border bg-card text-sm shadow-lg shadow-black/10 motion-safe:animate-[menu-in_0.12s_ease-out] dark:shadow-black/40',
        align === 'end' ? 'right-0' : 'left-0',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/** Lets content inside the panel close it (e.g. after following a link). */
export function usePopoverClose() {
  return usePopover().close
}
