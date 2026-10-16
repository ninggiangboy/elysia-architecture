// `bun run dev`: the API and the web app, plus the Stripe CLI forwarding webhooks when STRIPE_SECRET_KEY is set.
import { listen } from './stripe'

const apps = Bun.spawn(['bun', 'run', '--parallel', '--filter', './apps/*', 'dev'], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})

// Without a key `listen` returns at once, so a project that does not use Stripe sees one log line and nothing else.
const stripe = listen()

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => apps.kill(signal))
const code = await apps.exited
// The CLI got the same Ctrl+C; give it a moment to say goodbye.
await Promise.race([stripe, Bun.sleep(1000)])
process.exit(code)
