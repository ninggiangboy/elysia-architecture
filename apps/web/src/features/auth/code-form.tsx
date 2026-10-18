import { Button, Input, Label } from '@kit/ui'
import { type FormEvent, type ReactNode, useState } from 'react'

/** One code to type (6 digits, or a recovery code), with a submit button and room for secondary actions. */
export function CodeForm({
  id,
  label,
  hint,
  submitLabel,
  pending,
  numeric = true,
  onSubmit,
  children,
}: {
  id: string
  label: string
  hint?: string
  submitLabel: string
  pending: boolean
  /** True: 6 digits. False: also accepts a recovery code. */
  numeric?: boolean
  onSubmit: (code: string) => void
  children?: ReactNode
}) {
  const [code, setCode] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit(code.trim())
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          autoFocus
          required
          autoComplete="one-time-code"
          inputMode={numeric ? 'numeric' : 'text'}
          maxLength={numeric ? 7 : 30}
          placeholder={numeric ? '123456' : undefined}
          className="tracking-[0.2em] sm:h-10"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      <Button type="submit" size="lg" loading={pending} disabled={code.trim().length < 6}>
        {submitLabel}
      </Button>
      {children}
    </form>
  )
}
