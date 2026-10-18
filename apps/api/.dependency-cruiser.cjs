/** Architecture boundary rules — run with `bun run check:arch`. */
const ROOT = '^src/(app|main|bootstrap)'

/**
 * npm packages that only an adapter may import, and where from. (The kit packages carry the same kind of rule in
 * .dependency-cruiser.packages.cjs, for their own sources.)
 */
const ADAPTERS = {
  'elysia|@elysiajs/[^/]+': [
    'modules/[^/]+/presentation',
    'modules/[^/]+/[^/]+\\.module\\.ts',
    'app',
    'main',
    'bootstrap',
  ],
  'drizzle-orm|drizzle-kit|postgres': [
    'modules/[^/]+/(infrastructure|[^/]+\\.module\\.ts)',
    'bootstrap',
  ],
  jose: ['modules/identity/infrastructure'],
  stripe: ['modules/billing/infrastructure'],
  'web-push': ['modules/notification/infrastructure'],
  sharp: ['modules/profile/infrastructure'],
  '@simplewebauthn|arctic': ['modules/identity/infrastructure'],
}

const adapterRules = Object.entries(ADAPTERS).map(([libs, allowedFrom]) => ({
  name: `no-${libs.split('|')[0].replace(/[^a-z]/g, '')}-outside-adapters`,
  comment: `${libs} is a framework/driver: only adapters may import it (${allowedFrom.join(', ')}).`,
  severity: 'error',
  from: { path: '^src/', pathNot: [...allowedFrom.map((p) => `^src/${p}`), '\\.test\\.ts$'] },
  to: { path: `node_modules/(${libs})/` },
}))

/** The kit packages, as the cruiser sees them once it resolves `@kit/*` (workspace folders). */
const KIT = '^\\.\\./\\.\\./packages/kit-'

module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment:
        'domain depends only on domain and @kit/core; it knows nothing of application/infrastructure/presentation or any framework.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/domain/' },
      to: {
        path: [
          '^src/modules/[^/]+/(application|infrastructure|presentation)/',
          `${KIT}(?!core/|i18n/)`,
          ROOT,
        ],
      },
    },
    {
      name: 'application-no-infrastructure',
      comment:
        'application talks to the outside world through ports; it does not import infrastructure/presentation or the plumbing in the kit (http, db, runtime…); the ports of @kit/mail and @kit/storage are fine.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/application/' },
      to: {
        path: [
          '^src/modules/[^/]+/(infrastructure|presentation)/',
          `${KIT}(http|db|telemetry|runtime|config)/`,
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
        'contracts are plain DTOs/interfaces: they import nothing from inside the module or from the kit (except the privacy participation protocol, which privacy re-exports, and the i18n types).',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/contracts/' },
      to: {
        path: ['^src/modules/[^/]+/(domain|application|infrastructure|presentation)/', KIT, ROOT],
        pathNot: `${KIT}(privacy-participant|i18n)/`,
      },
    },
    {
      name: 'participants-do-not-know-privacy',
      comment:
        'A module that takes part in the privacy jobs speaks the protocol in @kit/privacy-participant; it does not import the privacy module, so privacy can be left out. Only integrations/ (the glue the app installs) may read privacy events.',
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
        'An integrations/ folder sees its own contracts, the consumer contracts (notification, realtime) and the kit; nothing else.',
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
      name: 'only-composition-root-wires-modules',
      comment: 'Only app.ts/main.ts/bootstrap may import *.module.ts and concrete implementations.',
      severity: 'error',
      from: { path: '^src/modules/' },
      to: { path: ROOT },
    },
    ...adapterRules,
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    // The kit packages are checked on their own (.dependency-cruiser.packages.cjs); here they are black boxes.
    doNotFollow: { path: ['node_modules', '^\\.\\./\\.\\./packages/'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.test\\.ts$' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.js'],
      mainFields: ['module', 'main'],
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
}
