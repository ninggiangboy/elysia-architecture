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

  // Re-sync the form when server data changes (after saving, or after a reload caused by a version conflict).
  useEffect(() => {
    setDisplayName(me.displayName)
    setBio(me.bio ?? '')
  }, [me.displayName, me.bio])

  const save = useMutation({
    mutationFn: () =>
      updateProfile({ displayName, bio: bio.trim() === '' ? null : bio }, me.version),
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data)
      toast.success('Changes saved')
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        toast.error(
          'Your profile was changed elsewhere. The latest data has been reloaded, please try again.',
        )
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
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          required
          maxLength={DISPLAY_NAME_MAX}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="bio">Bio</Label>
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
        {save.isPending ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  )
}
