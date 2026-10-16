import { COVER_CONTENT_TYPES, COVER_MAX_BYTES } from '@app/shared-types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, LoaderCircle } from 'lucide-react'
import { type ChangeEvent, useRef } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/api'
import { requestCoverUpload, setCover } from './queries'

async function uploadCover(file: File) {
  // Same flow as the avatar: presigned URL → PUT straight to S3 → tell the API to set it.
  const ticket = await requestCoverUpload(file)
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: file })
  if (!put.ok) throw new Error('Image upload failed, please try again')
  return setCover(ticket.key)
}

/** The banner at the top of the profile card: the cover image (or a gradient) with a button to change it. */
export function CoverUploader({ coverUrl }: { coverUrl: string | null }) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)

  const upload = useMutation({
    mutationFn: uploadCover,
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data)
      toast.success('Cover image updated')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!file) return
    if (!(file.type in COVER_CONTENT_TYPES))
      return void toast.error('Image must be JPEG, PNG or WebP')
    if (file.size > COVER_MAX_BYTES)
      return void toast.error(`Image must be at most ${COVER_MAX_BYTES / 1024 / 1024} MB`)
    upload.mutate(file)
  }

  return (
    <div className="relative h-24 overflow-hidden bg-accent sm:h-28">
      {coverUrl ? (
        <img src={coverUrl} alt="Cover" className="size-full object-cover" />
      ) : (
        <div
          aria-hidden
          className="size-full bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_oklab,var(--primary)_55%,transparent),transparent_60%),radial-gradient(90%_140%_at_100%_100%,color-mix(in_oklab,#d946ef_35%,transparent),transparent_60%)]"
        />
      )}
      {upload.isPending && (
        <span className="absolute inset-0 grid place-items-center bg-black/45 text-white">
          <LoaderCircle className="size-6 animate-spin" aria-hidden />
        </span>
      )}
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={upload.isPending}
        aria-label="Change cover image"
        title="Change cover image"
        className="absolute top-2 right-2 grid size-8 place-items-center rounded-full border border-border bg-card/90 text-foreground shadow-md backdrop-blur transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-50"
      >
        <Camera className="size-4" aria-hidden />
      </button>
      <input
        ref={input}
        type="file"
        accept={Object.keys(COVER_CONTENT_TYPES).join(',')}
        onChange={onPick}
        className="hidden"
        data-testid="cover-input"
      />
    </div>
  )
}
