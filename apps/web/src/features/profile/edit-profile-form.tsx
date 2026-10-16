import { BIO_MAX, DISPLAY_NAME_MAX } from '@app/shared-types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, errorMessage } from '@/lib/api'
import { updateProfile } from './queries'

interface Me {
  displayName: string
  bio: string | null
  version: number
}

export function EditProfileForm({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(me.displayName)
  const [bio, setBio] = useState(me.bio ?? '')

  // Đồng bộ lại form khi dữ liệu server đổi (sau khi lưu, hoặc sau khi tải lại do xung đột phiên bản).
  useEffect(() => {
    setDisplayName(me.displayName)
    setBio(me.bio ?? '')
  }, [me.displayName, me.bio])

  const save = useMutation({
    mutationFn: () =>
      updateProfile({ displayName, bio: bio.trim() === '' ? null : bio }, me.version),
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data)
      toast.success('Đã lưu thay đổi')
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        toast.error('Hồ sơ vừa được thay đổi ở nơi khác. Đã tải lại dữ liệu mới, vui lòng thử lại.')
        void queryClient.invalidateQueries({ queryKey: ['me'] })
      } else {
        toast.error(errorMessage(err))
      }
    },
  })

  const dirty = displayName !== me.displayName || bio !== (me.bio ?? '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">Tên hiển thị</Label>
        <Input
          id="displayName"
          required
          maxLength={DISPLAY_NAME_MAX}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="bio">Giới thiệu</Label>
        <Textarea
          id="bio"
          maxLength={BIO_MAX}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />
        <span className="self-end text-xs text-muted-foreground">
          {bio.length}/{BIO_MAX}
        </span>
      </div>
      <Button type="submit" className="self-start" disabled={!dirty || save.isPending}>
        {save.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
      </Button>
    </form>
  )
}
