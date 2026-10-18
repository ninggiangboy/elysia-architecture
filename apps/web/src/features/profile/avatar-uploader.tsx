import { Avatar } from '@kit/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { type ChangeEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { errorMessage } from '@/lib/api'
import { sourceError } from '@/lib/crop'
import { ImageCropDialog } from './image-crop-dialog'
import { requestAvatarUpload, setAvatar } from './queries'

async function uploadAvatar(image: Blob) {
  // 1) request a presigned URL  2) PUT straight to S3 (image bytes never pass through the API)  3) tell the API to set the avatar
  const ticket = await requestAvatarUpload(image)
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: image })
  if (!put.ok) throw new Error(i18n.t('profile.uploadFailed'))
  return setAvatar(ticket.key)
}

export function AvatarUploader({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)

  const upload = useMutation({
    mutationFn: uploadAvatar,
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data)
      setFile(null)
      toast.success(t('profile.pictureUpdated'))
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!picked) return
    const error = sourceError(picked)
    if (error) return void toast.error(error)
    setFile(picked)
  }

  return (
    <div className="relative -mt-10 w-fit shrink-0 sm:-mt-12">
      <Avatar
        src={avatarUrl}
        name={name}
        alt={t('profile.pictureOf', { name })}
        className="size-20 border-4 border-card text-2xl shadow-sm sm:size-24"
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        aria-label={t('profile.changePicture')}
        title={t('profile.changePicture')}
        className="absolute right-0 bottom-0 grid size-8 place-items-center rounded-full border border-border bg-card text-foreground shadow-md transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <Camera className="size-4" aria-hidden />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onPick}
        className="hidden"
        data-testid="avatar-input"
      />
      {file && (
        <ImageCropDialog
          file={file}
          title={t('profile.picture')}
          aspect={1}
          round
          outputWidth={512}
          saving={upload.isPending}
          onSave={(image) => upload.mutate(image)}
          onClose={() => setFile(null)}
        />
      )}
    </div>
  )
}
