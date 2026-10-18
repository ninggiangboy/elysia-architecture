/** Architecture boundary rules — run with `bun run check:arch`. */
const ROOT = '^src/(app|main|bootstrap)'

/**
 * Each folder of `src/shared` is a future package (`@kit/<name>`) and may import only the ones listed here. The graph
 * has no cycle, which is what lets a folder be lifted out into a package without dragging the others along.
 */
const SHARED_GRAPH = {
  core: [],
  config: [],
  context: [],
  telemetry: ['context', 'config'],
  db: ['core', 'config'],
  auth: ['core', 'context', 'http'],
  http: ['core', 'context', 'telemetry'],
  messaging: ['core', 'config', 'context', 'db', 'telemetry'],
  mail: ['core', 'config', 'messaging'],
  storage: ['core', 'config'],
  'privacy-participant': ['core', 'messaging', 'storage'],
  runtime: ['core', 'config', 'db', 'messaging', 'privacy-participant', 'telemetry'],
  // Fakes for tests: may use anything a test may want to fake.
  testing: Object.keys({
    core: 1,
    config: 1,
    context: 1,
    db: 1,
    messaging: 1,
    mail: 1,
    storage: 1,
  }),
}

/** npm packages that only an adapter may import: where they may be used from. */
const ADAPTERS = {
  'elysia|@elysiajs/[^/]+': [
    'shared/(http|auth|runtime)',
    'modules/[^/]+/presentation',
    'modules/[^/]+/[^/]+\\.module\\.ts',
    'app',
    'main',
    'bootstrap',
  ],
  nodemailer: ['shared/mail'],
  'drizzle-orm|drizzle-kit|postgres': [
    'shared/(db|messaging|runtime|testing)',
    'modules/[^/]+/(infrastructure|[^/]+\\.module\\.ts)',
    'bootstrap',
  ],
  jose: ['shared/auth', 'modules/identity/infrastructure'],
  pino: ['shared/telemetry'],
  stripe: ['modules/billing/infrastructure'],
  'web-push': ['modules/notification/infrastructure'],
  sharp: ['modules/profile/infrastructure'],
  '@simplewebauthn|arctic': ['modules/identity/infrastructure'],
  '@opentelemetry': ['shared/(telemetry|messaging|http|context)'],
}

const sharedPackageRules = Object.entries(SHARED_GRAPH).flatMap(([pkg, allowed]) => {
  const others = Object.keys(SHARED_GRAPH).filter((p) => p !== pkg && !allowed.includes(p))
  return [
    {
      name: `shared-${pkg}-imports-only-its-allowed-packages`,
      comment: `shared/${pkg} may import: ${allowed.join(', ') || 'nothing from shared'}. The graph is what keeps each folder liftable into a package.`,
      severity: 'error',
      from: { path: `^src/shared/${pkg}/`, pathNot: '\\.test\\.ts$' },
      to: { path: `^src/shared/(${others.join('|')})/` },
    },
    {
      name: `import-shared-${pkg}-via-its-barrel`,
      comment: `Outside shared/${pkg}, import '#/shared/${pkg}' (index.ts), never a file inside it: that is what a package's exports map will enforce.`,
      severity: 'error',
      from: { pathNot: `^src/shared/${pkg}/` },
      to: { path: `^src/shared/${pkg}/`, pathNot: `^src/shared/${pkg}/index\\.ts$` },
    },
  ]
})

const adapterRules = Object.entries(ADAPTERS).map(([libs, allowedFrom]) => ({
  name: `no-${libs.split('|')[0].replace(/[^a-z]/g, '')}-outside-adapters`,
  comment: `${libs} is a framework/driver: only adapters may import it (${allowedFrom.join(', ')}).`,
  severity: 'error',
  from: { path: '^src/', pathNot: [...allowedFrom.map((p) => `^src/${p}`), '\\.test\\.ts$'] },
  to: { path: `node_modules/(${libs})/` },
}))

module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment:
        'domain depends only on domain and shared/core; it knows nothing of application/infrastructure/presentation or any framework.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/domain/' },
      to: {
        path: [
          '^src/modules/[^/]+/(application|infrastructure|presentation)/',
          '^src/shared/(?!core/)',
          ROOT,
        ],
      },
    },
    {
      name: 'application-no-infrastructure',
      comment:
        'application talks to the outside world through ports; it does not import infrastructure/presentation or the plumbing in shared (http, db, runtime…); the ports of shared/mail and shared/storage are fine.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/application/' },
      to: {
        path: [
          '^src/modules/[^/]+/(infrastructure|presentation)/',
          '^src/shared/(http|db|telemetry|runtime|config)/',
          ROOT,
        ],
      },
    },
    {
      name: 'modules-talk-only-through-contracts',
      comment:
        'Module A may only import modules/B/contracts — never B internals (so modules can be split into services later).',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/[^/]+/',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/contracts/'],
      },
    },
    {
      name: 'contracts-are-self-contained',
      comment:
        'contracts are plain DTOs/interfaces: they import nothing from inside the module or from shared (except the privacy participation protocol, which privacy re-exports).',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/contracts/' },
      to: {
        path: [
          '^src/modules/[^/]+/(domain|application|infrastructure|presentation)/',
          '^src/shared/',
          ROOT,
        ],
        pathNot: '^src/shared/privacy-participant/',
      },
    },
    {
      name: 'participants-do-not-know-privacy',
      comment:
        'A module that takes part in the privacy jobs speaks the protocol in shared/privacy-participant; it does not import the privacy module, so privacy can be left out. Only integrations/ (the glue the app installs) may read privacy events.',
      severity: 'error',
      from: { path: '^src/modules/(?!privacy/)', pathNot: '/integrations/' },
      to: { path: '^src/modules/privacy/' },
    },
    {
      name: 'generic-modules-are-leaves',
      comment:
        'notification and realtime deliver for every module, so their core must not know any module. What they say about a producer lives in the producer (integrations/).',
      severity: 'error',
      from: { path: '^src/modules/(notification|realtime)/' },
      to: { path: '^src/modules/', pathNot: '^src/modules/(notification|realtime)/' },
    },
    {
      name: 'integrations-use-contracts-only',
      comment:
        'An integrations/ folder sees its own contracts, the consumer contracts (notification, realtime) and shared; nothing else.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/integrations/' },
      to: {
        path: '^src/modules/',
        pathNot: [
          '^src/modules/$1/(contracts|integrations)/',
          '^src/modules/(notification|realtime)/contracts/',
        ],
      },
    },
    {
      name: 'module-core-does-not-load-its-integrations',
      comment:
        'Only the composition root installs integrations; otherwise the consumer stops being optional.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/', pathNot: '/integrations/' },
      to: { path: '^src/modules/[^/]+/integrations/' },
    },
    {
      name: 'shared-knows-no-module',
      comment: 'shared is a building block and does not depend on business modules.',
      severity: 'error',
      from: { path: '^src/shared/', pathNot: '^src/shared/testing/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'only-composition-root-wires-modules',
      comment: 'Only app.ts/main.ts/bootstrap may import *.module.ts and concrete implementations.',
      severity: 'error',
      from: { path: '^src/(modules|shared)/' },
      to: { path: ROOT },
    },
    ...sharedPackageRules,
    ...adapterRules,
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.test\\.ts$' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.js'],
      mainFields: ['module', 'main'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
}
