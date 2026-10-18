/** Architecture boundary rules — run with `bun run check:arch`. */
const FRAMEWORKS =
  'node_modules/(elysia|@elysiajs|drizzle-orm|drizzle-kit|postgres|nodemailer|jose|pino|@simplewebauthn|arctic|stripe)/'
const ROOT = '^src/(app|main|bootstrap)'

module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment:
        'domain depends only on domain; it knows nothing of application/infrastructure/presentation or any framework.',
      severity: 'error',
      from: { path: ['^src/modules/[^/]+/domain/', '^src/shared/domain/'] },
      to: {
        path: [
          '^src/modules/[^/]+/(application|infrastructure|presentation)/',
          '^src/shared/(application|infrastructure|presentation|http|messaging)/',
          ROOT,
          FRAMEWORKS,
        ],
      },
    },
    {
      name: 'application-no-infrastructure',
      comment:
        'application talks to the outside world through ports; it does not import infrastructure/presentation/framework.',
      severity: 'error',
      from: { path: ['^src/modules/[^/]+/application/', '^src/shared/application/'] },
      to: {
        path: [
          '^src/modules/[^/]+/(infrastructure|presentation)/',
          '^src/shared/(infrastructure|presentation|http)/',
          ROOT,
          FRAMEWORKS,
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
