import { AVATAR_CONTENT_TYPES, AVATAR_MAX_BYTES } from '@app/shared-types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, LoaderCircle } from 'lucide-react'
import { type ChangeEvent, useRef } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/avatar'
import { errorMessage } from '@/lib/api'
import { requestAvatarUpload, setAvatar } from './queries'

async function uploadAvatar(file: File) {
  // 1) request a presigned URL  2) PUT straight to S3 (image bytes never pass through the API)  3) tell the API to set the avatar
  const ticket = await requestAvatarUpload(file)
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: file })
  if (!put.ok) throw new Error('Image upload failed, please try again')
  return setAvatar(ticket.key)
}

export function AvatarUploader({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)

  const upload = useMutation({
    mutationFn: uploadAvatar,
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data)
      toast.success('Profile picture updated')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!file) return
    if (!(file.type in AVATAR_CONTENT_TYPES))
      return void toast.error('Image must be JPEG, PNG or WebP')
    if (file.size > AVATAR_MAX_BYTES)
      return void toast.error(`Image must be at most ${AVATAR_MAX_BYTES / 1024 / 1024} MB`)
    upload.mutate(file)
  }

  return (
    <div className="relative -mt-10 w-fit shrink-0 sm:-mt-12">
      <Avatar
        src={avatarUrl}
        name={name}
        className="size-20 border-4 border-card text-2xl shadow-sm sm:size-24"
      />
      {upload.isPending && (
        <span className="absolute inset-1 grid place-items-center rounded-full bg-black/45 text-white">
          <LoaderCircle className="size-6 animate-spin" aria-hidden />
        </span>
      )}
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={upload.isPending}
        aria-label="Change profile picture"
        title="Change profile picture"
        className="absolute right-0 bottom-0 grid size-8 place-items-center rounded-full border border-border bg-card text-foreground shadow-md transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-50"
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
