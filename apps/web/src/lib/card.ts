/** Card number as typed: digits only, at most 19. */
export const cardDigits = (input: string) => input.replace(/\D/g, '').slice(0, 19)

const isAmex = (digits: string) => /^3[47]/.test(digits)

/** "4242424242424242" → "4242 4242 4242 4242" (American Express groups as 4-6-5). */
export function formatCardNumber(input: string) {
  const digits = cardDigits(input)
  const groups = isAmex(digits) ? [4, 6, 5] : [4, 4, 4, 4, 3]
  const parts: string[] = []
  let at = 0
  for (const size of groups) {
    if (at >= digits.length) break
    parts.push(digits.slice(at, at + size))
    at += size
  }
  return parts.join(' ')
}

/** The Luhn checksum every real card number satisfies: catches a mistyped digit before Stripe is called. */
export function luhnValid(digits: string) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return digits.length > 0 && sum % 10 === 0
}

export const isCardNumberValid = (input: string) => {
  const digits = cardDigits(input)
  return digits.length >= 13 && luhnValid(digits)
}

/** "1229" → "12 / 29"; a first digit above 1 is a month on its own ("4" → "04 / "). */
export function formatExpiry(input: string) {
  let digits = input.replace(/\D/g, '').slice(0, 4)
  if (digits.length === 1 && Number(digits) > 1) digits = `0${digits}`
  return digits.length > 2 ? `${digits.slice(0, 2)} / ${digits.slice(2)}` : digits
}

/** Month and four-digit year of "MM / YY", or `null` when it is incomplete, not a month, or already past. */
export function parseExpiry(input: string, now = new Date()) {
  const digits = input.replace(/\D/g, '')
  if (digits.length !== 4) return null
  const month = Number(digits.slice(0, 2))
  const year = 2000 + Number(digits.slice(2))
  if (month < 1 || month > 12) return null
  // A card is good through the last day of its month.
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1))
    return null
  return { month, year }
}

export const cvcLength = (number: string) => (isAmex(cardDigits(number)) ? 4 : 3)

export const isCvcValid = (cvc: string, number: string) =>
  new RegExp(`^\\d{${cvcLength(number)}}$`).test(cvc)
