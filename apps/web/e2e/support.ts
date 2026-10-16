export const MAILPIT = 'http://localhost:8025'

/** IP giả cho mỗi lần chạy để không dính rate limit theo IP của magic link giữa các lần test. */
export const TEST_IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

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

/** Link trong mail MỚI (sau `skip` mail cùng loại đã có). */
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
