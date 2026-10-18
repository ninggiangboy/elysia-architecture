/**
 * Counts the files outside a module that must be edited to remove it (kit plan T1: at most 3, plus the dependency line).
 * A file "needs editing" when it references the module by import path, by container key or by factory name.
 *
 * Usage: bun scripts/check-removal.ts <module>
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(import.meta.dir, '..')
const name = process.argv[2]
if (!name) {
  console.error('usage: bun scripts/check-removal.ts <module>')
  process.exit(2)
}

const moduleDirs = [`apps/api/src/modules/${name}`, `modules/${name}`]
const own = moduleDirs.find((d) => existsSync(join(root, d)))
if (!own) {
  console.error(`no such module: ${name}`)
  process.exit(2)
}

const Name = name[0]?.toUpperCase() + name.slice(1)
const patterns = [
  new RegExp(`modules/${name}/`),
  new RegExp(`@mod/${name}\\b`),
  new RegExp(`modules\\.${name}\\b`),
  new RegExp(`create${Name}Module`),
  new RegExp(`\\b${name}\\.(handlers|outbox|jobs|routes|api|verifier)\\b`),
  new RegExp(`['"]${name}['"]`), // module lists: scripts, drizzle config, participant names
]

const skip = new Set(['node_modules', 'dist', 'coverage', '.git', 'test-results', 'migrations'])
const exts = new Set(['.ts', '.tsx', '.json', '.cjs'])

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (exts.has(full.slice(full.lastIndexOf('.')))) yield full
  }
}

const hits: { file: string; lines: number }[] = []
for (const top of ['apps', 'packages', 'modules', 'examples', 'scripts']) {
  const dir = join(root, top)
  if (!existsSync(dir)) continue
  for (const file of walk(dir)) {
    const rel = relative(root, file)
    if (rel.startsWith(own)) continue
    const count = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => patterns.some((p) => p.test(line))).length
    if (count > 0) hits.push({ file: rel, lines: count })
  }
}

console.log(`Removing "${name}" (${own}) touches ${hits.length} file(s) outside its folder:`)
for (const h of hits.sort((a, b) => a.file.localeCompare(b.file)))
  console.log(`  ${String(h.lines).padStart(3)}  ${h.file}`)
