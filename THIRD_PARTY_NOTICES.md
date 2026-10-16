# Third-party attribution

This file identifies the upstream reference sources pinned by this workspace. It neither repeats nor changes the license for project-owned content. Third-party licenses remain separate from the project's own license.

- Source configuration: `maintenance/reference-sources.json`
- Pinned commits, license identifiers (`license.spdx`), license paths (`licenseFile`), and per-file SHA-256: `maintenance/references.lock.json`
- Original license texts: the corresponding files under `references/upstream/<source-id>/`

`references/upstream/` and `references/index.json` are local caches excluded from releases. Run `pnpm refs restore` after cloning to retrieve only the full commits and files recorded in the lockfile and verify each SHA-256. References are read-only research material; they are not executed or automatically included in cards.

| Source ID | Upstream repository |
| --- | --- |
| `tavern-helper` | https://github.com/N0VI028/JS-Slash-Runner |
| `tavern-helper-docs` | https://github.com/N0VI028/JS-Slash-Runner-Doc |
| `sillytavern` | https://github.com/SillyTavern/SillyTavern |
| `sillytavern-docs` | https://github.com/SillyTavern/SillyTavern-Docs |
| `prompt-template` | https://github.com/zonde306/ST-Prompt-Template |
| `tavern-helper-template` | https://github.com/StageDog/tavern_helper_template |
| `mvu` | https://github.com/MagicalAstrogy/MagVarUpdate |
| `character-card-spec` | https://github.com/malfoyslastname/character-card-spec-v2 |
| `character-card-spec-v3` | https://github.com/kwaroran/character-card-spec-v3 |
| `tavern-resource` | https://github.com/StageDog/tavern_resource |

Resolve any mismatch against the lockfile and restored original license text. Do not infer a license from a project name or memory. This English edition retains the original TavernCardStudio contributors' attribution; see [README](README.md) for the upstream project.
