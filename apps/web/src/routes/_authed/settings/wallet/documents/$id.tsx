import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PageSkeleton } from '@/components/layout/page-skeleton'
import { DocumentView } from '@/features/billing/document-view'
import { documentQuery } from '@/features/billing/queries'

export const Route = createFileRoute('/_authed/settings/wallet/documents/$id')({
  loader: ({ context: { queryClient }, params }) =>
    queryClient.ensureQueryData(documentQuery(params.id)),
  pendingComponent: DocumentSkeleton,
  component: DocumentPage,
})

function DocumentPage() {
  const { id } = Route.useParams()
  return <DocumentView id={id} />
}

function DocumentSkeleton() {
  const { t } = useTranslation()
  return <PageSkeleton label={t('billing.loading')} />
}
