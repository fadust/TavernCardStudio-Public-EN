# Releasing the public workspace

`maintenance/public-release.json` explicitly defines the export. The exporter does not traverse personal work, imports, builds, conversations, reference caches, dependencies, or Git objects. Add root files and official examples to the manifest before publishing them.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm release:export ../TavernCardStudio-release
```

The destination must not exist. If export fails, inspect its partial output and choose a fresh destination; the tool does not delete/overwrite existing directories. Complete tool tests, official-example builds, and link checks first. If reference research is required, restore pinned sources and run `pnpm verify:refs`.

The export includes `release-manifest.json` with version and per-file SHA-256. Archive hidden paths, including `.agents/`, `.github/`, `.gitignore`, and example `.card/` directories. Check extracted files against the manifest, install dependencies in a clean directory, and rerun `pnpm verify`. A standalone source publication must not carry another workspace's Git object database/history.

Review every newly published file, embedded PNG card data, script, and template. Automated checks detect only some credential patterns and release-boundary mistakes. Confirm `git status` contains only reviewed tools, documentation, templates, and official examples. Personal cards, generated reference indexes, and caches remain excluded.

Publishing the workspace does not require a SillyTavern connection or deploy to a remote host. CI runs offline tests, example builds, public-package checks, and local Studio browser tests. Browser checks use Playwright Chromium in CI and may use local Chrome; see [Verification](VERIFICATION.md). Neither CI nor a source publication verifies real host/model behavior.
