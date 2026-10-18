/**
 * The kit's wiring tool.
 *
 *   bun scripts/kit.ts add <module…>      [--app examples/starter]   wire installed @mod/* packages into an app
 *   bun scripts/kit.ts remove <module…>   [--app examples/starter]   take them out again
 *   bun scripts/kit.ts gen <name>         [--app examples/starter]   create a new module from templates/module and wire it
 *
 * What it edits is found by markers (`// <kit:…>`) and sentinels (`// <kit:module x>` … `// </kit:module x>`) in the app's
 * module-catalog.ts, container.ts and app.ts, and it reads what each module needs from the module's own `kit.json`, so the
 * order of `add` calls does not matter: integrations are derived from which modules are installed.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')

interface KitIntegration {
  import: string
  entry: string
}
interface KitFile {
  requires: string[]
  late: boolean
  /** The integration list (`notification` | `realtime`) this module consumes, if it is one. */
  consumes?: string
  appDependencies: Record<string, string>
  container: { imports: string[]; install: string }
  integrations: Record<string, KitIntegration>
}

const readKit = (name: string): KitFile => {
  const path = join(ROOT, 'modules', name, 'kit.json')
  if (!existsSync(path))
    throw new Error(`modules/${name}/kit.json not found: is "${name}" a module of this kit?`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

// ---- the app's files -------------------------------------------------------------------------------------------------

class App {
  constructor(readonly dir: string) {}
  path = (file: string) => join(this.dir, file)
  read = (file: string) => readFileSync(this.path(file), 'utf8')
  write = (file: string, content: string) => writeFileSync(this.path(file), content)
  readonly catalog = 'src/bootstrap/module-catalog.ts'
  readonly container = 'src/bootstrap/container.ts'
  readonly routes = 'src/app.ts'
  readonly pkg = 'package.json'

  installed(): string[] {
    const content = this.read(this.catalog)
    const body = content.slice(content.indexOf('MODULE_CATALOG'))
    return [...body.matchAll(/^\s+(\w+)Manifest,/gm)].map((m) => m[1] as string)
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function insertBefore(content: string, marker: string, text: string): string {
  const re = new RegExp(`^([ \\t]*)// <kit:${escape(marker)}>[ \\t]*$`, 'm')
  const match = re.exec(content)
  if (!match) throw new Error(`marker "// <kit:${marker}>" not found`)
  const indent = match[1] ?? ''
  const lines = text
    .split('\n')
    .map((l) => (l ? indent + l : l))
    .join('\n')
  return content.slice(0, match.index) + lines + '\n' + content.slice(match.index)
}

/** `import { a, type B } from 'spec'` statements: parse enough to merge and remove names. */
const IMPORT_RE = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'\n?/g

function parseImport(statement: string) {
  const m = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/.exec(statement)
  if (!m) throw new Error(`cannot read import: ${statement}`)
  return {
    typeOnly: !!m[1],
    names: (m[2] as string)
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean),
    spec: m[3] as string,
  }
}

function addImport(content: string, statement: string): string {
  const want = parseImport(statement)
  for (const m of content.matchAll(IMPORT_RE)) {
    const have = parseImport(m[0])
    if (have.spec === want.spec && have.typeOnly === want.typeOnly) {
      const names = [...new Set([...have.names, ...want.names])]
      if (names.length === have.names.length) return content
      return content.replace(
        m[0],
        `import ${have.typeOnly ? 'type ' : ''}{ ${names.join(', ')} } from '${have.spec}'\n`,
      )
    }
  }
  return `${statement}\n${content}`
}

function removeImport(content: string, statement: string): string {
  const want = parseImport(statement)
  return content.replace(IMPORT_RE, (whole) => {
    const have = parseImport(whole)
    if (have.spec !== want.spec || have.typeOnly !== want.typeOnly) return whole
    const left = have.names.filter((n) => !want.names.includes(n))
    return left.length === 0
      ? ''
      : `import ${have.typeOnly ? 'type ' : ''}{ ${left.join(', ')} } from '${have.spec}'\n`
  })
}

function sortedDeps(deps: Record<string, string>) {
  return Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)))
}

// ---- add / remove ------------------------------------------------------------------------------------------------------

function add(app: App, name: string) {
  const kit = readKit(name)
  const installed = app.installed()
  if (installed.includes(name)) return console.log(`= ${name} is already installed in ${app.dir}`)
  const missing = kit.requires.filter((r) => !installed.includes(r))
  if (missing.length > 0)
    throw new Error(
      `${name} requires ${missing.join(', ')}: add ${missing.length > 1 ? 'them' : 'it'} first`,
    )

  // 1. package.json
  const pkg = JSON.parse(app.read(app.pkg))
  pkg.dependencies = sortedDeps({ ...pkg.dependencies, ...kit.appDependencies })
  app.write(app.pkg, `${JSON.stringify(pkg, null, 2)}\n`)

  // 2. catalog
  let catalog = app.read(app.catalog)
  catalog = addImport(catalog, `import { ${name}Manifest } from '@mod/${name}/manifest'`)
  catalog = insertBefore(catalog, 'catalog', `${name}Manifest,`)
  app.write(app.catalog, catalog)

  // 3. container: imports, the install block between sentinels, the modules record
  let container = app.read(app.container)
  for (const statement of kit.container.imports) container = addImport(container, statement)
  container = insertBefore(
    container,
    kit.late ? 'install-late' : 'install',
    `// <kit:module ${name}>\n${kit.container.install}\n// </kit:module ${name}>`,
  )
  container = insertBefore(container, 'modules', `${name},`)

  // 4. routes
  let routes = app.read(app.routes)
  routes = insertBefore(routes, 'routes', `.use(container.modules.${name}.routes)`)
  app.write(app.routes, routes)

  // 5. integrations, both directions, from whatever is installed now
  const all = [...installed, name]
  for (const consumer of Object.keys(kit.integrations)) {
    if (all.includes(consumer))
      container = addIntegration(container, consumer, kit.integrations[consumer] as KitIntegration)
  }
  if (kit.consumes) {
    for (const producer of installed) {
      const entry = readKit(producer).integrations[kit.consumes]
      if (entry) container = addIntegration(container, kit.consumes, entry)
    }
  }
  app.write(app.container, container)
  console.log(`+ ${name}`)
}

function addIntegration(container: string, list: string, integration: KitIntegration) {
  if (new RegExp(`^\\s+${integration.entry},`, 'm').test(container)) return container
  container = addImport(container, integration.import)
  return insertBefore(container, `${list}-integrations`, `${integration.entry},`)
}

function remove(app: App, name: string) {
  const kit = readKit(name)
  const installed = app.installed()
  if (!installed.includes(name)) return console.log(`= ${name} is not installed in ${app.dir}`)
  const dependents = installed.filter((m) => m !== name && readKit(m).requires.includes(name))
  if (dependents.length > 0)
    throw new Error(
      `${dependents.join(', ')} require${dependents.length > 1 ? '' : 's'} ${name}: remove ${dependents.length > 1 ? 'them' : 'it'} first`,
    )

  let container = app.read(app.container)
  // the install block, its modules-record entry, and the imports its snippet needed
  container = container.replace(
    new RegExp(`^[ \\t]*// <kit:module ${name}>[\\s\\S]*?// </kit:module ${name}>\\n`, 'm'),
    '',
  )
  container = container.replace(new RegExp(`^[ \\t]+${name},\\n`, 'm'), '')
  for (const statement of kit.container.imports) container = removeImport(container, statement)
  // the imports of what the other modules ship for it (the lists went with its install block)
  if (kit.consumes) {
    for (const producer of installed) {
      const entry = readKit(producer).integrations[kit.consumes]
      if (producer !== name && entry) container = removeImport(container, entry.import)
    }
  }
  // its entries in the other modules' integration lists
  for (const integration of Object.values(kit.integrations)) {
    container = container.replace(new RegExp(`^[ \\t]+${integration.entry},\\n`, 'm'), '')
    container = removeImport(container, integration.import)
  }
  app.write(app.container, container)

  let catalog = app.read(app.catalog)
  catalog = catalog.replace(new RegExp(`^[ \\t]+${name}Manifest,\\n`, 'm'), '')
  catalog = removeImport(catalog, `import { ${name}Manifest } from '@mod/${name}/manifest'`)
  app.write(app.catalog, catalog)

  app.write(
    app.routes,
    app
      .read(app.routes)
      .replace(
        new RegExp(`^[ \\t]+\\.use\\(container\\.modules\\.${name}\\.routes\\)\\n`, 'm'),
        '',
      ),
  )

  // dependencies nobody else asks for any more
  const stillNeeded = new Set(
    installed.filter((m) => m !== name).flatMap((m) => Object.keys(readKit(m).appDependencies)),
  )
  const pkg = JSON.parse(app.read(app.pkg))
  for (const dep of Object.keys(kit.appDependencies))
    if (!stillNeeded.has(dep)) delete pkg.dependencies[dep]
  app.write(app.pkg, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`- ${name}`)
}

// ---- gen -----------------------------------------------------------------------------------------------------------------

const pascal = (s: string) => s[0]?.toUpperCase() + s.slice(1)

function copyTemplate(from: string, to: string, name: string) {
  const sub = (s: string) =>
    s
      .replaceAll('__NAME__', name.toUpperCase())
      .replaceAll('__Name__', pascal(name))
      .replaceAll('__name__', name)
  for (const entry of readdirSync(from)) {
    const source = join(from, entry)
    const target = join(to, sub(entry))
    if (statSync(source).isDirectory()) {
      Bun.spawnSync(['mkdir', '-p', target])
      copyTemplate(source, target, name)
    } else writeFileSync(target, sub(readFileSync(source, 'utf8')))
  }
}

async function gen(app: App, name: string) {
  if (!/^[a-z][a-z0-9]*$/.test(name))
    throw new Error('a module name is lowercase letters and digits, starting with a letter')
  const dest = join(ROOT, 'modules', name)
  if (existsSync(dest)) throw new Error(`modules/${name} already exists`)
  Bun.spawnSync(['mkdir', '-p', dest])
  copyTemplate(join(ROOT, 'templates/module'), dest, name)
  console.log(`+ modules/${name} (from templates/module)`)
  await sh(['bun', 'install'])
  add(app, name)
}

// ---- main ----------------------------------------------------------------------------------------------------------------

async function sh(cmd: string[], cwd = ROOT) {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' })
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(' ')} failed`)
}

const [command, ...rest] = process.argv.slice(2)
const appFlag = rest.indexOf('--app')
const appDir = join(ROOT, appFlag >= 0 ? (rest[appFlag + 1] ?? '') : 'examples/starter')
const names = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--app')
if (!command || !['add', 'remove', 'gen'].includes(command) || names.length === 0) {
  console.error('usage: bun scripts/kit.ts <add|remove|gen> <name…> [--app <dir>]')
  process.exit(1)
}
const app = new App(appDir)

try {
  if (command === 'gen') for (const name of names) await gen(app, name)
  else if (command === 'add') for (const name of names) add(app, name)
  else for (const name of names.toReversed()) remove(app, name)
} catch (err) {
  console.error(`✗ ${(err as Error).message}`)
  process.exit(1)
}

// Format what was touched, refresh the lockfile and the sample env, and say what is left to do.
const files = [app.catalog, app.container, app.routes, app.pkg].map((f) =>
  relative(ROOT, app.path(f)),
)
await sh(['bunx', '@biomejs/biome', 'check', '--write', ...files]).catch(() => {})
await sh(['bun', 'install'])
if (existsSync(app.path('scripts/config-example.ts')))
  await sh(['bun', 'run', 'config:example'], app.dir)
console.log(
  command === 'remove'
    ? `\nDone. The module's tables stay in the database. Typecheck: bun run --filter ${JSON.parse(app.read(app.pkg)).name} typecheck`
    : `\nNext: bun run --filter ${JSON.parse(app.read(app.pkg)).name} db:migrate  (and set the module's variables in .env)`,
)
