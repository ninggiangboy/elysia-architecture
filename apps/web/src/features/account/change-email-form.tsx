import { useMutation } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage } from '@/lib/api'
import { requestEmailChange } from './queries'

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [newEmail, setNewEmail] = useState('')
  const request = useMutation({
    mutationFn: requestEmailChange,
    onSuccess: (_, email) => {
      toast.success(`Đã gửi liên kết xác nhận tới ${email}`)
      setNewEmail('')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    request.mutate(newEmail.trim())
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="newEmail">Email mới</Label>
        <Input
          id="newEmail"
          type="email"
          required
          placeholder={`Hiện tại: ${currentEmail}`}
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        className="self-start"
        disabled={request.isPending || !newEmail}
      >
        {request.isPending ? 'Đang gửi…' : 'Gửi liên kết xác nhận'}
      </Button>
    </form>
  )
}
