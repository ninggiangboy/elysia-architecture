import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type Ref,
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

interface DropdownContext {
  open: boolean
  setOpen: (open: boolean) => void
  menuId: string
  triggerRef: React.RefObject<HTMLButtonElement | null>
  /** Close and hand focus back to the trigger. */
  close: () => void
}

const Ctx = createContext<DropdownContext | null>(null)
const useDropdown = () => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('Dropdown parts must be rendered inside <Dropdown>')
  return ctx
}

const ITEMS = '[role^="menuitem"]:not([disabled])'

/** A small menu anchored to its trigger: closes on outside click, Escape and selection; arrow keys move between items. */
export function Dropdown({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
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
    <Ctx.Provider value={{ open, setOpen, menuId, triggerRef, close }}>
      <div ref={rootRef} className="relative">
        {children}
      </div>
    </Ctx.Provider>
  )
}

export function DropdownTrigger({
  className,
  onClick,
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
  const { open, setOpen, menuId, triggerRef } = useDropdown()
  return (
    <button
      ref={(node) => {
        triggerRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      className={className}
      onClick={(e) => {
        onClick?.(e)
        setOpen(!open)
      }}
      {...props}
    />
  )
}

export function DropdownContent({
  className,
  align = 'end',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { align?: 'start' | 'end' }) {
  const { open, menuId } = useDropdown()
  const ref = useRef<HTMLDivElement>(null)

  // Focus the first item (or the checked one) so the menu is usable from the keyboard right away.
  useEffect(() => {
    if (!open) return
    const items = ref.current?.querySelectorAll<HTMLElement>(ITEMS)
    const checked = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    ;(checked ?? items?.[0])?.focus({ preventScroll: true })
  }, [open])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const move = (n: number) => {
      e.preventDefault()
      items[(n + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') move(i + 1)
    else if (e.key === 'ArrowUp') move(i < 0 ? -1 : i - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(-1)
    else if (e.key === 'Tab') e.preventDefault()
  }

  return (
    <div
      ref={ref}
      id={menuId}
      role="menu"
      onKeyDown={onKeyDown}
      className={cn(
        'absolute top-full z-50 mt-2 min-w-48 origin-top rounded-lg border border-border bg-card p-1 text-sm shadow-lg shadow-black/10 motion-safe:animate-[menu-in_0.12s_ease-out] dark:shadow-black/40',
        align === 'end' ? 'right-0' : 'left-0',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

const ITEM =
  'flex w-full select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

export function DropdownItem({
  className,
  onSelect,
  checked,
  closeOnSelect = true,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> & {
  onSelect?: (e: React.MouseEvent<HTMLButtonElement>) => void
  /** Makes this a radio-style item; omit for a plain action. */
  checked?: boolean
  closeOnSelect?: boolean
}) {
  const { close } = useDropdown()
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      className={cn(ITEM, className)}
      onClick={(e) => {
        onSelect?.(e)
        if (closeOnSelect) close()
      }}
      {...props}
    />
  )
}
