/**
 * Keeps the README of every package and module honest (kit plan T5):
 *  - it has the required headings, and
 *  - its "Configuration" section is the table generated from the package's config slice.
 *
 *   bun scripts/package-docs.ts          write the generated tables
 *   bun scripts/package-docs.ts --check  fail when a README is missing a heading or its table is out of date
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describeSlice } from '../packages/kit-config/src/example'

const ROOT = join(import.meta.dir, '..')
const check = process.argv.includes('--check')

const COMMON = [
  'Purpose',
  'Install',
  'Ports',
  'Configuration',
  'Tables and migrations',
  'Wiring',
  'Guarantees',
  'Limits',
  'Related',
]
const MODULE_ONLY = ['Events', 'Extension points']

interface Slice {
  title: string
  schema: unknown
  example?: unknown
}
const isSlice = (value: unknown): value is Slice =>
  typeof value === 'object' && value !== null && 'title' in value && 'schema' in value

/** The config slices a package exports from its entry (or its `./config` subpath for a module). */
async function slicesOf(dir: string, isModule: boolean): Promise<Slice[]> {
  const entry = isModule ? join(dir, 'src/config.ts') : join(dir, 'src/index.ts')
  if (!existsSync(entry)) return []
  const exports = (await import(entry)) as Record<string, unknown>
  return Object.values(exports).filter(isSlice)
}

const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ')

function table(slices: Slice[]): string {
  if (slices.length === 0) return 'None: this package reads no environment variables.'
  const rows: string[] = []
  for (const slice of slices) {
    for (const v of describeSlice(slice as never)) {
      const def = v.required
        ? '**required**'
        : v.default === undefined
          ? 'unset'
          : `\`${cell(v.default) || '(empty)'}\``
      rows.push(`| \`${v.name}\` | ${def} | ${cell(v.description)} |`)
    }
  }
  return [
    "_Generated from the config slice by `bun scripts/package-docs.ts`; the reference app's `.env.example` lists the same variables._",
    '',
    '| Variable | Default | Description |',
    '| --- | --- | --- |',
    ...rows,
  ].join('\n')
}

const problems: string[] = []
const dirs = [
  ...readdirSync(join(ROOT, 'packages'))
    .filter((d) => d.startsWith('kit-'))
    .map((d) => ({ dir: join('packages', d), isModule: false })),
  ...readdirSync(join(ROOT, 'modules')).map((d) => ({ dir: join('modules', d), isModule: true })),
]

for (const { dir, isModule } of dirs) {
  const path = join(ROOT, dir, 'README.md')
  if (!existsSync(path)) {
    problems.push(`${dir}: no README.md`)
    continue
  }
  let readme = readFileSync(path, 'utf8')
  const headings = new Set([...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]))
  for (const heading of [...COMMON, ...(isModule ? MODULE_ONLY : [])])
    if (!headings.has(heading)) problems.push(`${dir}/README.md: missing "## ${heading}"`)

  const block = /<!-- config:start -->\n[\s\S]*?<!-- config:end -->/
  if (!block.test(readme)) {
    problems.push(`${dir}/README.md: no <!-- config:start --> … <!-- config:end --> block`)
    continue
  }
  const generated = `<!-- config:start -->\n${table(await slicesOf(join(ROOT, dir), isModule))}\n<!-- config:end -->`
  if (readme.match(block)?.[0] !== generated) {
    if (check)
      problems.push(
        `${dir}/README.md: the configuration table is out of date (run bun scripts/package-docs.ts)`,
      )
    else {
      readme = readme.replace(block, () => generated)
      writeFileSync(path, readme)
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(check ? 'package READMEs: ok\n' : 'package READMEs: written\n')
