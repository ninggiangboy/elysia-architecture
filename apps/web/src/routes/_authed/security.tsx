import { createFileRoute } from '@tanstack/react-router'
import { PageHeader, Section } from '@/components/layout/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { ConnectedAccounts } from '@/features/account/connected-accounts'
import { PasskeysCard } from '@/features/account/passkeys-card'
import { connectedAccountsQuery, passkeysQuery } from '@/features/account/queries'
import { oauthProvidersQuery } from '@/features/auth/queries'

export const Route = createFileRoute('/_authed/security')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(passkeysQuery),
      queryClient.ensureQueryData(connectedAccountsQuery),
      queryClient.ensureQueryData(oauthProvidersQuery),
    ]),
  pendingComponent: SecuritySkeleton,
  component: SecurityPage,
})

function SecurityPage() {
  return (
    <>
      <PageHeader
        title="Security"
        description="Choose how you sign in. An email link always works; these add faster ways in."
      />
      <Section
        title="Passkeys"
        description="Sign in with your fingerprint, face or screen lock. Passkeys cannot be phished and never leave your device unless you sync them."
      >
        <PasskeysCard />
      </Section>
      <Section
        title="Connected accounts"
        description="Sign in with Google or GitHub. We only match an account by an email the provider has verified."
      >
        <ConnectedAccounts />
      </Section>
    </>
  )
}

function SecuritySkeleton() {
  return (
    <div
      role="status"
      className="flex flex-col gap-8"
      aria-busy="true"
      aria-label="Loading security settings"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="grid gap-4 border-t border-border pt-8 md:grid-cols-3 md:gap-10">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="h-32 rounded-xl md:col-span-2" />
        </div>
      ))}
    </div>
  )
}
