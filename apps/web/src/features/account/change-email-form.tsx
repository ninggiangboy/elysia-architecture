import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage } from '@/lib/api'
import { requestEmailChange } from './queries'

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [newEmail, setNewEmail] = useState('')
  const request = useMutation({
    mutationFn: requestEmailChange,
    onSuccess: (_, email) => {
      toast.success(`Confirmation link sent to ${email}`)
      setNewEmail('')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    request.mutate(newEmail.trim())
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium leading-none">Current email</span>
            <p className="truncate text-sm text-muted-foreground">{currentEmail}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="newEmail">New email</Label>
            <Input
              id="newEmail"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="new@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter>
          <p className="text-xs text-muted-foreground">The link is valid for 30 minutes.</p>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={!newEmail.trim()}
            loading={request.isPending}
          >
            Send confirmation link
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
