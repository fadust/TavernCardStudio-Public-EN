# Contributing

Read [LICENSE](LICENSE) first. Workspace content is for non-commercial use. By contributing, you confirm that you can provide the content and agree to distribute your contribution under the project license. Retain the source and license of third-party material; do not relicense it as project-owned content.

Tool maintenance starts in `tools/` and `tests/`; card-authoring guidance starts in [AGENTS.md](AGENTS.md). For a bug, provide a minimal reproducible input that you are allowed to share, the actual behavior, and the expected result. Exclude private conversations, credentials, complete private cards, and other people's work.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm verify:examples
pnpm release:check
```

These checks do not need reference downloads and do not execute imported card scripts. When changing reference-dependent behavior, also run `pnpm refs restore` and `pnpm verify:refs`. For local Studio changes, run the browser checks described in [Verification](docs/VERIFICATION.md).

Preserve unknown PNG/JSON fields and compatibility with existing projects. Building must never silently publish or write to an external application. Tests use isolated temporary projects and must not require personal creations as fixtures. Register new public examples in both `maintenance/public-release.json` and the matching `.gitignore` exceptions.

Use English for maintained UI text, diagnostics, documentation, skills, templates, and examples. Use the canonical English authoring keys in new material and preserve support for legacy Chinese authoring keys. Do not translate imported user content automatically or change runtime protocol tags, hashes, pinned URLs, or upstream attribution. See [Localization principles](docs/LOCALIZATION.md).

Update [CHANGELOG.md](CHANGELOG.md) when changing a version. Follow [Release](docs/RELEASE.md) and validate the exported package in a clean directory. Upgrade reference versions separately from ordinary tool updates; missing local reference files require restore, not an upstream upgrade.
