import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Section } from '@/components/layout/page-header'
import { PageSkeleton } from '@/components/layout/page-skeleton'
import { ConnectedAccounts } from '@/features/account/connected-accounts'
import { InvitationsCard } from '@/features/account/invitations-card'
import { PasskeysCard } from '@/features/account/passkeys-card'
import { PasswordCard } from '@/features/account/password-card'
import {
  connectedAccountsQuery,
  invitationsQuery,
  passkeysQuery,
  securityQuery,
  sessionsQuery,
} from '@/features/account/queries'
import { SessionsList } from '@/features/account/sessions-list'
import { TwoFactorCard } from '@/features/account/two-factor-card'
import { authOptionsQuery, oauthProvidersQuery } from '@/features/auth/queries'

export const Route = createFileRoute('/_authed/settings/security')({
  loader: async ({ context: { queryClient } }) => {
    const [security] = await Promise.all([
      queryClient.ensureQueryData(securityQuery),
      queryClient.ensureQueryData(authOptionsQuery),
      queryClient.ensureQueryData(passkeysQuery),
      queryClient.ensureQueryData(connectedAccountsQuery),
      queryClient.ensureQueryData(oauthProvidersQuery),
      queryClient.ensureQueryData(sessionsQuery),
    ])
    // Only members of an invite-only deployment have the list.
    if (security.canInvite) await queryClient.ensureQueryData(invitationsQuery)
  },
  pendingComponent: SecuritySkeleton,
  component: SecurityPage,
})

function SecurityPage() {
  const { t } = useTranslation()
  const { data: security } = useSuspenseQuery(securityQuery)
  return (
    <>
      {security.passwordAvailable && (
        <Section
          stacked
          title={t('security.passwordTitle')}
          description={t('security.passwordDescription')}
        >
          <PasswordCard />
        </Section>
      )}
      <Section
        stacked
        title={t('security.passkeysTitle')}
        description={t('security.passkeysDescription')}
      >
        <PasskeysCard />
      </Section>
      <Section
        stacked
        title={t('security.accountsTitle')}
        description={t('security.accountsDescription')}
      >
        <ConnectedAccounts />
      </Section>
      {security.twoFactor.available && (
        <Section
          stacked
          title={t('security.twoFactorTitle')}
          description={t('security.twoFactorDescription')}
        >
          <TwoFactorCard />
        </Section>
      )}
      {security.canInvite && (
        <Section
          stacked
          title={t('security.invitesTitle')}
          description={t('security.invitesDescription')}
        >
          <InvitationsCard />
        </Section>
      )}
      <Section
        stacked
        title={t('profile.devicesTitle')}
        description={t('profile.devicesDescription')}
      >
        <SessionsList />
      </Section>
    </>
  )
}

function SecuritySkeleton() {
  const { t } = useTranslation()
  return <PageSkeleton label={t('security.loading')} sections={5} />
}
