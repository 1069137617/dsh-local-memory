# dsh-local-memory — Standalone Local Memory Plugin

A **DSH** plugin that mounts a persistent, editable local memory into every session's runtime context. Fully independent of `dsh-mnemon` (zero references) and safe to run alongside it.

## Capabilities

1. **Per-turn context injection** — a user-role snapshot (context name `local-memory:snapshot`, order 200) is injected into every turn; global vs workspace entries are separated by the session's working directory.
2. **Agent tools** — `local_memory_search` (query/scope/limit retrieval) and `local_memory_remember` (add / replace / remove with Edit-style literal replacement semantics).
3. **Settings page** — the "Local Memory" page: browse, filter, scope tabs, CRUD with revision conflict protection, plus direct editing of injection & tool settings.

## Install (web profile)

1. Add to the profile's `package.json` dependencies:
   ```json
   "dsh-local-memory": "link:<repo path>"
   ```
2. Append `"dsh-local-memory"` to `dsh.profile.bundles` (the host reads its `dsh.bundle.patch` to compose the bundle injection list).
3. Restart `dsh web` — bundles are read at boot only.

## Data location & format

- File: `~/.dsh/local-memory/entries.jsonl` (i.e. `<DSH_HOME>/local-memory/entries.jsonl`).
- Format: one JSON object per line; corrupt lines are skipped and surfaced as an "N corrupt lines" badge instead of poisoning the whole file.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | entry id (timestamp + random suffix) |
| `text` | string | memory text |
| `scope` | string | `"global"` or normalized workspace path (backslashes → slashes, lowercased drive letter, trailing slash trimmed) |
| `importance` | string | `critical` / `normal` / `low` |
| `tags` | string[] | optional |
| `createdAt` / `updatedAt` | string | ISO timestamps |
| `source` | string | `"agent"` (model-written) or `"ui"` (settings page) |

- The top-level revision = first 12 hex of the sha256 over the id-sorted entry fingerprint; concurrent movers are rejected via the `expectedRevision` optimistic lock (error code `revision-conflict`).

## Settings namespace `local-memory`

| Field | Default | Notes |
| --- | --- | --- |
| `enabled` | `true` | master switch; tools report disabled, no injection |
| `injectEnabled` | `true` | per-turn snapshot injection on/off |
| `injectWorkspace` | `true` | when off, injection holds global entries only |
| `allowAgentWrite` | `true` | when off, `local_memory_remember` refuses writes |
| `maxInjectionChars` | `4000` (200–20000) | character budget of the injected snapshot |
| `entryMaxChars` | `2000` (50–8000) | max characters per entry |
| `searchLimit` | `8` (1–32) | default tool retrieval count |

## Injection format example

```
## LOCAL MEMORY SNAPSHOT (3 entries, 512/4000 chars, cwd d:/code/x)

- [global|critical] Redeploys need a 45s cooldown #ftp
- [d:/code/x|normal] Test baseline for this repo is 29/29
- [d:/code/y|low] Legacy project notes (2 of 7 entries shown — call local_memory_search)
```

When the budget runs out a "k of m entries shown — call local_memory_search" hint is appended; with nothing to inject the callback returns an empty string (the host skips it).

## Troubleshooting

- **"N corrupt lines" badge**: partially written or hand-edited lines in `entries.jsonl`; they are skipped — remove them by hand, valid lines are unaffected.
- **"Changed elsewhere — view refreshed"**: the store revision moved between page load and submit (another window / an agent write); the page re-pulled automatically, just retry.
- **Tool says disabled**: the `enabled` or `allowAgentWrite` setting is off.
- **Page/tools missing entirely**: bundles load at boot only — check the bundles entry and restart `dsh web`.
- **Coexisting with dsh-mnemon**: neither reads or writes the other's data; both may inject their own snapshots simultaneously.

## Development

```powershell
npm install        # never run npm prune / npm ci --omit=dev in a link:-installed copy
npm test           # node --test (pretest builds lib/)
npm run typecheck  # host + client tsconfigs
npm run verify:install web   # offline install self-check replaying host resolution
```

License: MIT
