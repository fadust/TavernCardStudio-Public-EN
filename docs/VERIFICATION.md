# Verification

| Evidence | Method | Establishes |
| --- | --- | --- |
| Static | `pnpm card check <name\|all>` | structure, mappings, syntax, resource consistency |
| Build | `pnpm card build <name\|all>` | local importable output can be generated |
| Real host | actual SillyTavern/extensions | runtime behavior in the recorded versions and tested scope |

Report these separately. `runtimeVerified` defaults to null; do not fill it from static/build results or assume compatibility from matching field names.

## Commands and browser checks

`doctor:workspace` checks Node/pnpm, dependencies, locks, and local tools without writing or installing. `pnpm verify` runs unit tests, official-example checks/builds, and release checks offline, without reference caches. `pnpm refs restore [--source <id>]` downloads locked full commits/files with SHA-256 verification and does not change the lockfile; `pnpm verify:refs` then verifies cache/index consistency. Use `refs update` only for intentional upstream upgrades.

`pnpm release:check` checks the explicit public manifest, documentation links, versions/locks, and common credential patterns.

`pnpm test:studio-ui` covers new/import/copy workflows, covers, building, mobile layout, and shutdown. It uses installed Chrome by default. CI uses Playwright Chromium: run `pnpm exec playwright install chromium`, then set `TAVERN_TEST_BROWSER=chromium`. In PowerShell use `$env:TAVERN_TEST_BROWSER='chromium'`.

`pnpm test:ui` is a separate browser suite for selected trusted legacy example interfaces; run `pnpm verify:examples` first. It intentionally executes those reviewed example UIs. Never change it to discover and execute arbitrary user cards. Local browser tests do not establish real-host compatibility.

## Static coverage

- Required text types, nonempty name, compatible spec/spec_version, string-array greetings and tags.
- Project version/structure, directory/name agreement, reference existence and containment under src, duplicate/unknown YAML keys and unsafe categories.
- Compatibility-state SHA-256 and original/baseline hashes, retaining legacy data and migration snapshots.
- Credential-free pinned HTTPS dependencies with nonempty fields and no duplicates; parseable PNG avatar.
- Worldbook content/keys types; warnings for enabled entries with no constant/keyword/vector activation.
- Regex unique IDs, compilable find expressions, replacement/placement types, and macro-substitution warnings requiring host review.
- JavaScript parsing with acorn; TypeScript syntax transformation with esbuild (no type check); Vue SFC parsing and script/template compilation.
- EJS compilation where <% occurs; failures are warnings because cross-entry fragments need actual injection context.
- Resource audits of source, assembled card strings, and output: missing/escaping relative resources, undeclared external resources, local/private URLs, unknown protocols, unresolved bundled imports/resources. Dynamic URLs generate warnings for manual review.
- `tests/regex.json` resolves regex by id or name and compares replacement output with expected. It checks the pinned replacement-group/trim behavior, without host macro expansion or routing simulation.

Trusted `mvu-template.test.mjs` verifies initialization, bounds, idempotence, JSON Schema projection, and regex chains. `complex-example.test.mjs` explicitly tests the original comprehensive example's opening states, derived state, invalid inputs, and projection. These execute reviewed fixed sources, never discovered user schemas.

Check does not execute card scripts/EJS/UI, request external URLs, or load a browser/host. Diff compares the editing source semantically with `original/card.json`; pending build differences are listed separately.

## Build evidence

Build checks first, compiles bound script/HTML/Vue targets, audits remaining source and output, stages files, then replaces the output directory with rollback handling. See [Architecture](ARCHITECTURE.md#build-and-output) for Windows replacement limitations.

`build-report.json` includes input/output SHA-256, output sizes, dependencies, observed external URLs, warnings, and checks: `static`, `localBuild`, and `realTavern` (`not-tested` without host evidence). Total output above 5 MiB adds a warning.

## Choose checks by change

Documentation needs wording/link checks. Card prose/settings need check/build. Script/EJS/UI/dependency changes need check/build plus dependency-record review. Reference/module/build-binding changes also need diff for imported cards. Tool/template/official-example changes need `pnpm verify`; reference/lock changes additionally need restore and verify:refs. Repeat passing checks only if their inputs changed or a new unresolved concern warrants it.

Report changed files, exact checks/results and output paths, external dependency versions, and the boundary between local and real-host evidence. Real-host review should cover relevant activation, macros, MVU initialization/update, streaming rendering, swipe/regeneration, editing, and chat switching.
