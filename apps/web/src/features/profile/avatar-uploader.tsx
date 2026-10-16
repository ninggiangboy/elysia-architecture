import { AVATAR_CONTENT_TYPES, AVATAR_MAX_BYTES } from '@app/shared-types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { type ChangeEvent, useRef } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/avatar'
import { errorMessage } from '@/lib/api'
import { requestAvatarUpload, setAvatar } from './queries'

async function uploadAvatar(file: File) {
  // 1) xin presigned URL  2) PUT thẳng lên S3 (byte ảnh không đi qua API)  3) báo API gán avatar
  const ticket = await requestAvatarUpload(file)
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: file })
  if (!put.ok) throw new Error('Tải ảnh lên thất bại, vui lòng thử lại')
  return setAvatar(ticket.key)
}

export function AvatarUploader({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)

  const upload = useMutation({
    mutationFn: uploadAvatar,
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data)
      toast.success('Đã cập nhật ảnh đại diện')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // cho phép chọn lại cùng một file
    if (!file) return
    if (!(file.type in AVATAR_CONTENT_TYPES))
      return void toast.error('Ảnh phải là JPEG, PNG hoặc WebP')
    if (file.size > AVATAR_MAX_BYTES)
      return void toast.error(`Ảnh tối đa ${AVATAR_MAX_BYTES / 1024 / 1024} MB`)
    upload.mutate(file)
  }

  return (
    <div className="relative">
      <Avatar src={avatarUrl} name={name} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={upload.isPending}
        aria-label="Đổi ảnh đại diện"
        className="absolute -right-1 -bottom-1 grid size-8 place-items-center rounded-full border border-border bg-card shadow-sm hover:bg-muted disabled:opacity-50"
      >
        <Camera className="size-4" aria-hidden />
      </button>
      <input
        ref={input}
        type="file"
        accept={Object.keys(AVATAR_CONTENT_TYPES).join(',')}
        onChange={onPick}
        className="hidden"
        data-testid="avatar-input"
      />
    </div>
  )
}
