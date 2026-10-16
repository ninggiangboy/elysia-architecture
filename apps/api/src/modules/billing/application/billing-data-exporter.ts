import type { DataExporter, ExportedPart } from '#/shared/application/privacy'
import type { LedgerRepository, TopUpRepository } from '../domain/billing-repository'

const PAGE = 200

/** What billing holds about a user, for a data export: every top-up attempt, the ledger and the balances. */
export class BillingDataExporter implements DataExporter {
  constructor(
    private topUps: TopUpRepository,
    private ledger: LedgerRepository,
  ) {}

  async collect(userId: string): Promise<ExportedPart> {
    const topUps: Record<string, unknown>[] = []
    let before: string | undefined
    for (;;) {
      const page = await this.topUps.list({ userId, before, limit: PAGE })
      for (const t of page)
        topUps.push({
          id: t.props.id,
          status: t.props.status,
          currency: t.props.currency,
          amount: t.props.amount,
          failureReason: t.props.failureReason,
          createdAt: t.props.createdAt.toISOString(),
          updatedAt: t.props.updatedAt.toISOString(),
        })
      if (page.length < PAGE) break
      before = page[page.length - 1]?.id
    }
    const entries = await this.ledger.entries(userId)
    return {
      data: {
        balances: await this.ledger.balances(userId),
        topUps,
        ledger: entries.map((e) => ({
          id: e.id,
          type: e.type,
          currency: e.currency,
          amount: e.amount,
          topUpId: e.topUpId,
          createdAt: e.createdAt.toISOString(),
        })),
      },
    }
  }
}
