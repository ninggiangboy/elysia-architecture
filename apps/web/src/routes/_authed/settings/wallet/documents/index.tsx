import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Section } from '@/components/layout/page-header'
import { PageSkeleton } from '@/components/layout/page-skeleton'
import { DocumentsList } from '@/features/billing/documents-list'
import { documentsQuery } from '@/features/billing/queries'

export const Route = createFileRoute('/_authed/settings/wallet/documents/')({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureInfiniteQueryData(documentsQuery(undefined)),
  pendingComponent: DocumentsSkeleton,
  component: DocumentsPage,
})

function DocumentsPage() {
  const { t } = useTranslation()
  return (
    <Section
      stacked
      title={t('billing.documents.title')}
      description={t('billing.documents.description')}
    >
      <DocumentsList />
    </Section>
  )
}

function DocumentsSkeleton() {
  const { t } = useTranslation()
  return <PageSkeleton label={t('billing.loading')} />
}
