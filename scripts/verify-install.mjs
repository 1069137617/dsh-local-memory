/**
 * Offline proof that the installed plugin will be served to the browser.
 *
 * `dsh-client-modules` only serves a bundle for a package that has a live Loader
 * entry, and it locates that bundle by reading the package's own manifest. This
 * script replays exactly that resolution — from the profile's node_modules, not
 * from this directory — so a packaging mistake surfaces here instead of as a
 * silent absence of the control after a server restart.
 *
 * It checks, in the host's own order:
 *   1. the row is in the profile's `dsh.profile.bundles` list (no live entry means
 *      no bundle, no matter what else is declared);
 *   2. `dsh.client` parses: it is an object, `platform` is the string `"web"`,
 *      and `inject`/`external` are string arrays when present;
 *   3. `exports["./client"]` resolves to a string, directly or through `default`;
 *   4. the resolved bundle file actually exists on disk;
 *   5. `dsh.bundle.patch` resolves and exists, and the patch inserts this row;
 *   6. the bundle registers the package name byte for byte and requires only
 *      platform seed words.
 *
 * Usage: `node scripts/verify-install.mjs [profileName]` (default `web`).
 *
 * @module dsh-local-memory/scripts/verify-install
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const self = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const pluginId = self.name

const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh')
const profileName = process.argv[2] ?? 'web'
const profileDir = join(home, 'profiles', profileName)
const manifestPath = join(profileDir, 'package.json')

/** Specifiers the shell seeds into the module table; a bundle may require only these. */
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

const failures = []
const notes = []

/** Record a failed check. */
const fail = (message) => failures.push(message)
/** Record a successful check. */
const pass = (message) => notes.push(message)

if (!existsSync(manifestPath)) {
  console.error(`profile manifest not found: ${manifestPath}`)
  process.exit(2)
}

const profile = JSON.parse(readFileSync(manifestPath, 'utf8'))
const bundles = profile.dsh?.profile?.bundles ?? []

// 1. Live Loader entry. Without this, `dsh.client` is inert.
if (bundles.includes(pluginId)) {
  pass(`profile "${profileName}" lists ${pluginId} in dsh.profile.bundles`)
} else {
  fail(
    `${pluginId} is not in dsh.profile.bundles — client-modules only serves packages ` +
      'with a live Loader entry, so the bundle would never be requested',
  )
}

// 2-4. The host's package -> bundle resolution, run from the profile.
const requireFromProfile = createRequire(manifestPath)
let pkgPath
try {
  pkgPath = requireFromProfile.resolve(`${pluginId}/package.json`)
} catch (error) {
  fail(`cannot resolve ${pluginId}/package.json from the profile: ${String(error)}`)
}

if (pkgPath !== undefined) {
  pass(`resolved from profile: ${pkgPath}`)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

  const decl = pkg.dsh?.client
  if (typeof decl !== 'object' || decl === null) {
    fail('dsh.client is missing or not an object; the host would skip this package')
  } else {
    if (typeof decl.platform !== 'string') fail('dsh.client.platform must be a string')
    else if (decl.platform !== 'web') fail(`dsh.client.platform is "${decl.platform}"; only "web" is served`)
    else pass('dsh.client.platform is "web"')

    for (const field of ['inject', 'external']) {
      const value = decl[field]
      if (value === undefined) continue
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        fail(`dsh.client.${field} must be an array of strings`)
      }
    }
  }

  const clientField = pkg.exports?.['./client']
  const clientRel =
    typeof clientField === 'string'
      ? clientField
      : typeof clientField?.default === 'string'
        ? clientField.default
        : undefined
  if (clientRel === undefined) {
    fail('exports["./client"] must be a string or an object with a string default')
  } else {
    const bundlePath = join(dirname(pkgPath), clientRel)
    if (existsSync(bundlePath)) {
      pass(`bundle present: ${bundlePath}`)
      const bundle = readFileSync(bundlePath, 'utf8')
      if (!bundle.startsWith('window.__ModuleLoader__.load({')) {
        fail('bundle does not open with the __ModuleLoader__.load registration')
      } else if (!bundle.includes(`id: ${JSON.stringify(pluginId)}`)) {
        fail(`bundle does not register the id ${JSON.stringify(pluginId)} byte for byte`)
      } else {
        pass('bundle registers this package id')
      }
      const requested = new Set()
      for (const match of bundle.matchAll(/require\(\s*"([^"]+)"\s*\)/g)) {
        if (match[1] !== undefined) requested.add(match[1])
      }
      const stray = [...requested].filter((specifier) => !PLATFORM_SEED.includes(specifier))
      if (stray.length > 0) fail(`bundle requires non-seed modules: ${stray.join(', ')}`)
      else pass(`bundle requires only platform seeds: [${[...requested].sort().join(', ')}]`)
    } else {
      fail(`bundle missing at ${bundlePath} — run \`npm run build\` before launch`)
    }
  }

  // 5. The host half that carries the live Loader entry.
  const patch = pkg.dsh?.bundle?.patch
  if (typeof patch !== 'string') {
    fail('dsh.bundle.patch is missing; `dsh plugin add` would not have created a Loader entry')
  } else {
    const patchPath = join(dirname(pkgPath), patch)
    if (!existsSync(patchPath)) {
      fail(`dsh.bundle.patch points at a missing file: ${patchPath}`)
    } else {
      const text = readFileSync(patchPath, 'utf8')
      if (!text.includes(pluginId)) fail(`the patch does not mention ${pluginId}`)
      else pass(`bundle patch present and names the package: ${patchPath}`)
    }
  }
}

for (const note of notes) console.log(`  ok    ${note}`)
for (const problem of failures) console.error(`  FAIL  ${problem}`)
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed — the page would not render.`)
  process.exit(1)
}
console.log(`\nAll checks passed. Restart \`dsh web\` and reload the page to load ${pluginId}.`)
