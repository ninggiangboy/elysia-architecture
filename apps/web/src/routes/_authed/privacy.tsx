import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('privacy.title')} description={t('privacy.description')} />
      <Section title={t('privacy.exportTitle')} description={t('privacy.exportDescription')}>
        <ExportCard />
      </Section>
      <Section title={t('privacy.deleteTitle')} description={t('privacy.deleteDescription')}>
        <DeletionCard />
      </Section>
    </>
  )
}

function PrivacySkeleton() {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      className="flex flex-col gap-8"
      aria-busy="true"
      aria-label={t('privacy.loading')}
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
