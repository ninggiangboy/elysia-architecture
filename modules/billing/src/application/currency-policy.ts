import { ValidationError } from '@kit/core'

export interface CurrencyRule {
  code: string
  min: number
  max: number
  presets: readonly number[]
}

/** Which currencies can be topped up and in what range. Built once from the config; the browser shows the same rules. */
export class CurrencyPolicy {
  private readonly rules: Map<string, CurrencyRule>

  constructor(rules: readonly CurrencyRule[]) {
    this.rules = new Map(rules.map((r) => [r.code, r]))
  }

  all(): CurrencyRule[] {
    return [...this.rules.values()]
  }

  assertAllowed(currency: string, amount: number): void {
    const rule = this.rules.get(currency)
    if (!rule) throw new ValidationError('unsupported_currency', 'This currency is not supported')
    if (!Number.isSafeInteger(amount) || amount < rule.min || amount > rule.max)
      throw new ValidationError('amount_out_of_range', 'The amount is outside the allowed range')
  }
}
