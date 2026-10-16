import { createFileRoute } from '@tanstack/react-router'
import { PageHeader, Section } from '@/components/layout/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { DeletionCard } from '@/features/privacy/deletion-card'
import { ExportCard } from '@/features/privacy/export-card'
import { deletionQuery, exportsQuery } from '@/features/privacy/queries'

export const Route = createFileRoute('/_authed/privacy')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(exportsQuery),
      queryClient.ensureQueryData(deletionQuery),
    ]),
  pendingComponent: PrivacySkeleton,
  component: PrivacyPage,
})

function PrivacyPage() {
  return (
    <>
      <PageHeader
        title="Privacy"
        description="Take a copy of your data with you, or have it erased."
      />
      <Section
        title="Export your data"
        description="We collect what every part of the service holds about you into one file and email you the link. The link works for a week."
      >
        <ExportCard />
      </Section>
      <Section
        title="Delete your account"
        description="Erases your account and all of its data from every part of the service."
      >
        <DeletionCard />
      </Section>
    </>
  )
}

function PrivacySkeleton() {
  return (
    <div
      role="status"
      className="flex flex-col gap-8"
      aria-busy="true"
      aria-label="Loading privacy settings"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="grid gap-4 border-t border-border pt-8 md:grid-cols-3 md:gap-10">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="h-28 rounded-xl md:col-span-2" />
        </div>
      ))}
    </div>
  )
}
