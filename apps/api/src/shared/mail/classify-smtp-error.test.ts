import { describe, expect, test } from 'bun:test'
import { classifySmtpError } from './classify-smtp-error'

const smtp = (responseCode: number, response: string) => ({
  responseCode,
  response,
  message: response,
})

describe('classifySmtpError', () => {
  test.each([
    ['SES throttling', smtp(454, '454 Throttling failure: Maximum sending rate exceeded.')],
    ['SES daily quota', smtp(454, '454 Throttling failure: Daily message quota exceeded.')],
    ['service busy', smtp(421, '421 4.7.0 Try again later')],
    ['mailbox busy', smtp(450, '450 4.2.1 mailbox temporarily unavailable')],
    [
      'Gmail quota is a 550 but still a rate limit',
      smtp(550, '550 5.4.5 Daily user sending quota exceeded'),
    ],
    ['generic "too many" text', smtp(451, '451 Too many connections from your IP')],
  ])('%s → rate_limited', (_name, err) => {
    expect(classifySmtpError(err).kind).toBe('rate_limited')
  })

  test.each([
    ['unknown mailbox', smtp(550, '550 5.1.1 User unknown')],
    ['message rejected', smtp(554, '554 Message rejected: Email address is not verified.')],
    ['policy rejection', smtp(553, '553 5.7.1 sender not allowed')],
  ])('%s → permanent', (_name, err) => {
    expect(classifySmtpError(err).kind).toBe('permanent')
  })

  test.each([
    ['bad credentials must not drop mail', smtp(535, '535 Authentication Credentials Invalid')],
    ['connection reset', { code: 'ECONNRESET', message: 'read ECONNRESET' }],
    ['timeout', { code: 'ETIMEDOUT', message: 'Connection timeout' }],
    ['non-error', undefined],
  ])('%s → transient (normal backoff, counts attempts)', (_name, err) => {
    expect(classifySmtpError(err).kind).toBe('transient')
  })
})
