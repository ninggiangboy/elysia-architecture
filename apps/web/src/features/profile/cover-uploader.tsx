import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { type ChangeEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/api'
import { sourceError } from '@/lib/crop'
import { ImageCropDialog } from './image-crop-dialog'
import { requestCoverUpload, setCover } from './queries'

/** width ÷ height of the banner. Fixed, so the crop the user picks is exactly what is shown. */
export const COVER_ASPECT = 4

async function uploadCover(image: Blob) {
  // Same flow as the avatar: presigned URL → PUT straight to S3 → tell the API to set it.
  const ticket = await requestCoverUpload(image)
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: image })
  if (!put.ok) throw new Error('Image upload failed, please try again')
  return setCover(ticket.key)
}

/** The banner at the top of the profile card: the cover image (or a gradient) with a button to change it. */
export function CoverUploader({ coverUrl }: { coverUrl: string | null }) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)

  const upload = useMutation({
    mutationFn: uploadCover,
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data)
      setFile(null)
      toast.success('Cover image updated')
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
    <div className="relative overflow-hidden bg-accent" style={{ aspectRatio: COVER_ASPECT }}>
      {coverUrl ? (
        <img src={coverUrl} alt="Cover" className="size-full object-cover" />
      ) : (
        <div
          aria-hidden
          className="size-full bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_oklab,var(--primary)_55%,transparent),transparent_60%),radial-gradient(90%_140%_at_100%_100%,color-mix(in_oklab,#d946ef_35%,transparent),transparent_60%)]"
        />
      )}
      <button
        type="button"
        onClick={() => input.current?.click()}
        aria-label="Change cover image"
        title="Change cover image"
        className="absolute top-2 right-2 grid size-8 place-items-center rounded-full border border-border bg-card/90 text-foreground shadow-md backdrop-blur transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <Camera className="size-4" aria-hidden />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onPick}
        className="hidden"
        data-testid="cover-input"
      />
      {file && (
        <ImageCropDialog
          file={file}
          title="Cover image"
          aspect={COVER_ASPECT}
          outputWidth={1600}
          saving={upload.isPending}
          onSave={(image) => upload.mutate(image)}
          onClose={() => setFile(null)}
        />
      )}
    </div>
  )
}
