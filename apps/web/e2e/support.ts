export const MAILPIT = 'http://localhost:8025'

/** A fake IP per run so the magic-link per-IP rate limit does not carry over between test runs. */
export const TEST_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

/** An IP of its own, for a spec that signs in and must not eat into the per-IP magic-link limit the others share. */
export const uniqueIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function search(address: string) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)
  const { messages = [] } = (await res.json()) as { messages?: { ID: string; Subject: string }[] }
  return messages
}

export async function countMails(address: string, subject: string) {
  return (await search(address)).filter((m) => m.Subject.includes(subject)).length
}

/** The link in the NEW mail (after the `skip` mails of the same kind that already existed). */
export async function linkFromMail(address: string, subject: string, skip = 0): Promise<string> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const matches = (await search(address)).filter((m) => m.Subject.includes(subject))
    if (matches.length > skip) {
      const detail = (await (
        await fetch(`${MAILPIT}/api/v1/message/${matches[0]!.ID}`)
      ).json()) as { Text: string }
      const link = detail.Text.match(/https?:\/\/\S+token=\S+/)?.[0]
      if (link) return link
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`mail "${subject}" to ${address} not received`)
}

/** The 6-digit code in the subject of the NEW "confirmation code" mail (after the `skip` that already existed). */
export async function codeFromMail(address: string, skip = 0): Promise<string> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const matches = (await search(address)).filter((m) => m.Subject.includes('confirmation code'))
    const code = matches.length > skip ? matches[0]?.Subject.match(/\d{6}/)?.[0] : undefined
    if (code) return code
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`confirmation code for ${address} not received`)
}

/** The 6-digit code in the subject of the NEW mail whose subject contains `subject` (after the `skip` that already existed). */
export async function codeFromSubject(address: string, subject: string, skip = 0): Promise<string> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const matches = (await search(address)).filter((m) => m.Subject.includes(subject))
    const code = matches.length > skip ? matches[0]?.Subject.match(/\d{6}/)?.[0] : undefined
    if (code) return code
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`mail "${subject}" with a code to ${address} not received`)
}
