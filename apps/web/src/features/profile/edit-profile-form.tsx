import { BIO_MAX, DISPLAY_NAME_MAX } from '@app/shared-types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
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
  const reset = () => {
    setDisplayName(me.displayName)
    setBio(me.bio ?? '')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              required
              autoComplete="nickname"
              maxLength={DISPLAY_NAME_MAX}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="bio">Bio</Label>
              <span
                className={cn(
                  'text-xs tabular-nums text-muted-foreground',
                  bio.length >= BIO_MAX && 'text-warning',
                )}
              >
                {bio.length}/{BIO_MAX}
              </span>
            </div>
            <Textarea
              id="bio"
              maxLength={BIO_MAX}
              placeholder="A sentence or two about yourself"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter>
          <p className="text-xs text-muted-foreground">
            {dirty ? 'You have unsaved changes.' : 'Up to date.'}
          </p>
          <div className="ml-auto flex gap-2">
            {dirty && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={save.isPending}
              >
                Discard
              </Button>
            )}
            <Button type="submit" size="sm" disabled={!dirty} loading={save.isPending}>
              Save changes
            </Button>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
