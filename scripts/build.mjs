/**
 * Build the browser half and prove it satisfies the module-loader contract.
 *
 * The shell serves exactly one file per plugin — `lib/client.js` — and executes
 * it as a classic script that must register its factory through
 * `window.__ModuleLoader__.load({ id, factory })`, where `id` equals the package
 * name byte for byte and `factory` is synchronous. Nothing in the installed
 * harness generates that wrapper, so it is written here and then checked.
 *
 * Two gates run after bundling, and both fail the build rather than the browser:
 *
 * 1. **Wrapper shape** — the file must open with the loader call and carry the
 *    package name from `package.json` (never a literal, so the two cannot drift).
 * 2. **External purity** — every `require()` the bundle emits must be a specifier
 *    the shell's platform seed table actually serves. A miss there surfaces at
 *    runtime as a module-table throw inside the shell, which is far harder to
 *    diagnose than a build error.
 *
 * The resolve hook enforces the same rule one step earlier: a *value* import of
 * any non-seed `@deepseek-ai/*` package is refused outright, because the shell's
 * supported way for two plugins to cooperate is a cordis service, not a module
 * edge. Type-only imports are erased before they reach the hook and stay legal.
 *
 * @module dsh-local-memory/scripts/build
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, context } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const watching = process.argv.includes('--watch')

/**
 * The specifiers the web shell seeds into the module table.
 *
 * Mirrors the shell's platform table (`react`, `react/jsx-runtime`,
 * `react-dom`, `react-dom/client`, cordis, the client store, the slot contract,
 * the UI primitives, and the dock kit). Everything else a bundle needs must be
 * bundled into it; these must stay external.
 */
const PLATFORM_SEED = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** Refuse to bundle an official package that the page cannot answer at runtime. */
const purityGate = {
  name: 'dsh-client-bundle-purity',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@deepseek-ai\// }, (args) => {
      if (PLATFORM_SEED.includes(args.path)) return { external: true }
      return {
        errors: [
          {
            text:
              `client bundle purity: "${args.path}" is not a platform module. ` +
              'Cross-plugin value imports are forbidden — cooperate through cordis services. ' +
              '(A type-only import is erased and never reaches this gate.)',
          },
        ],
      }
    })
  },
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const pluginId = packageJson.name
if (typeof pluginId !== 'string' || pluginId.length === 0) {
  throw new Error('package.json has no usable "name"')
}

const BANNER =
  'window.__ModuleLoader__.load({\n' +
  `\tid: ${JSON.stringify(pluginId)},\n` +
  '\tfactory: (require) => {\n' +
  '\t\tvar module = { exports: {} };\n' +
  '\t\tvar exports = module.exports;\n' +
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n'

const FOOTER = '\n\t\treturn module.exports;\n\t}\n});\n'

const options = {
  entryPoints: [join(root, 'src/client.ts')],
  outfile: join(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'react',
  sourcemap: true,
  minify: true,
  external: PLATFORM_SEED,
  plugins: [purityGate],
  banner: { js: BANNER },
  footer: { js: FOOTER },
  logLevel: 'warning',
}

/**
 * Verify the emitted bundle against the loader contract.
 * @param code - the built `lib/client.js` text.
 */
function verify(code) {
  const problems = []

  if (!code.startsWith('window.__ModuleLoader__.load({')) {
    problems.push('bundle does not open with the __ModuleLoader__.load registration')
  }
  if (!code.includes(`id: ${JSON.stringify(pluginId)}`)) {
    problems.push(`bundle does not register the package name ${JSON.stringify(pluginId)}`)
  }
  if (!code.includes('return module.exports;')) {
    problems.push('bundle does not return module.exports from its factory')
  }

  const requested = new Set()
  for (const match of code.matchAll(/require\(\s*"([^"]+)"\s*\)/g)) {
    const specifier = match[1]
    if (specifier !== undefined) requested.add(specifier)
  }
  for (const specifier of requested) {
    if (!PLATFORM_SEED.includes(specifier)) {
      problems.push(`bundle requires "${specifier}", which is not a platform seed word`)
    }
  }

  if (problems.length > 0) {
    throw new Error(`client bundle failed its contract check:\n  - ${problems.join('\n  - ')}`)
  }
  return [...requested].sort()
}

await mkdir(join(root, 'lib'), { recursive: true })

if (watching) {
  // A watcher is not a convenience here: client HMR only fires when something
  // actually rewrites lib/client.js on disk, and the host merely stats the file.
  const buildContext = await context(options)
  await buildContext.watch()
  console.log(`[dsh-local-memory] watching src/ -> lib/client.js`)
} else {
  await build(options)
  const code = await readFile(join(root, 'lib/client.js'), 'utf8')
  const requested = verify(code)
  console.log(
    `[dsh-local-memory] lib/client.js ok — id=${pluginId}, ` +
      `requires=[${requested.join(', ')}]`,
  )
}
