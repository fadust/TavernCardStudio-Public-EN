# Architecture and operations

## Isolated tests

The CLI always uses the repository root; there is no `--root` option. For a skill exercise or tool test, explicitly pass an isolated root to exported functions while retaining the repository templates. For example, place this trusted script in `work/` and run it from the repository root:

```js
import { newCard } from '../tools/lib/templates.mjs';
import { checkProject } from '../tools/lib/validation.mjs';
import { buildCard } from '../tools/lib/build.mjs';
import path from 'node:path';

const root = path.resolve('work/my-isolated-test');
await newCard('exercise', { root, modules: ['mvu'] });
const result = await checkProject('exercise', root);
if (!result.report.ok) throw new Error(result.report.errors.join('\n'));
await buildCard('exercise', root);
```

Source and output remain under the isolated root. Execute only reviewed, trusted test code, never imported card code.

## Directories

```text
TavernCardStudio/
  cards/<name>/
    project.json          modules, dependencies, avatar, runtimeVerified, original
    .card/state.json      tool-maintained compatibility state and integrity hash
    CONTENTS.md           generated content navigation
    original/             verified original and baseline; read-only
    src/
      index.yaml          authoring entry point
      text/ greetings/ worldbook/ regex/ scripts/ ui/ variables/
    tests/regex.json       regex fixtures
    AUTHORING.md           optional author notes; not packaged
  dist/<name>/             generated card and build report
  references/              pinned read-only research cache
  maintenance/             source configuration, locks, public manifest
  templates/               new-card skeletons
  tools/                   CLI, validation, packaging, Studio
  tests/                   automated tests
  docs/                    workspace documentation
```

Personal cards, imports, output, work files, and reference caches are ignored by Git. Official examples are explicitly allowlisted. One card directory represents one project. Edit source/configuration under `src/`; generated cards, pointers, `.card/`, and baselines are tool-maintained.

## Authoring entry point

`src/index.yaml` joins the card's content using English keys. References are `src/...` paths relative to the card directory. Legacy Chinese keys/enum spellings remain accepted; new files use the English implementation. The canonical aliases are defined in `tools/lib/authoring-language.mjs`, with field mappings in `tools/lib/authoring.mjs`.

```yaml
character:
  name: my-card
  creator: Your name
  version: '1.0'
  tags: [fantasy, adventure]
text:
  first_mes: src/text/first_mes.md
alternate_greetings:
  - src/greetings/rainy-night.md
group_only_greetings:
  - src/greetings/group-opening.md
worldbook:
  name: my-card
  entries:
    - src/worldbook/geography/old-bookshop.yaml
regex:
  - src/regex/hide-variable-updates.yaml
scripts:
  - src/scripts/example-script.yaml
```

Additional compatibility sections are `legacy_text`, `legacy_regex`, `legacy_script_groups`, `helper_variables`, and `legacy_helper_variables`. They preserve imported content in its original structure/order; do not merge them into standard entries merely to simplify the layout.

`text` normally references nonempty fields, always including `first_mes`. Supported text fields are `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `creator_notes`, `system_prompt`, and `post_history_instructions`. Unreferenced files may remain on disk without being packaged. Settings may live in traditional fields or worldbook entries; avoid duplicating the same prose. Imported nonempty fields are preserved.

Each worldbook, regex, and script entry has its own YAML file. Worldbook/script bodies use `file`; regex replacement bodies use `replacement_file`; script folders list child YAML paths in `scripts`. Worldbook subdirectories may have arbitrary depth and are included only through explicit index references, never automatic scanning.

Text references may be paths or objects: `{ file: src/..., build: { type: html, entry: src/... } }`. This applies to text fields, greetings, and legacy text. `build` can also attach to a worldbook, regex, or script entry. Reordering does not require updating pointers because the build is attached to its target. Empty text with a build binding remains referenced.

Irregular imported nested text appears under the owning entry's `attachments`; its labels map to the same path/object reference form. Ownership is tool-bound. Preserve it unless intentionally editing that content.

Preserve generated `link` identities, especially when moving files. If omitted on an unchanged path, original identity can be recovered by path; new entries may omit it and receive stable path-derived IDs. Moving a new entry before the tool records identity can change its ID. Strict YAML rejects duplicate keys, cyclic aliases, custom tags, and merge keys (`<<`). Quote version-like strings. Do not paste another tool's YAML without checking its schema.

Generated `CONTENTS.md` lists content locations and points to `src/index.yaml`. Manual edits to it are overwritten.

## Authoring field mapping

English authoring keys describe local editing; exported JSON keeps the host's native fields. In root context `character` means card metadata; in worldbook entries `role` means injection message role. Imported user data under script data/Helper-variable objects is opaque and is not translated as schema.

| Index YAML | Card JSON |
| --- | --- |
| `character.name`, `creator`, `version`, `tags` | `data.name`, `creator`, `character_version`, `tags` |
| `text.<field>` | `data.<field>` using the supported text fields above |
| `alternate_greetings`, `group_only_greetings` | matching arrays under `data` |
| `worldbook.name/description/scan_depth/token_budget/recursive_scanning` | matching fields under `data.character_book` |
| `helper_variables`, `legacy_helper_variables` | `data.extensions.tavern_helper.variables`, root `extensions.tavern_helper.variables` |

Worldbook entry mappings (`file` supplies `content`):

| YAML | Card JSON |
| --- | --- |
| `name`, `enabled` | `comment`, `enabled` |
| `keys`, `secondary_keys`, `selective`, `use_regex` | matching top-level entry fields |
| `order`, `depth` | `insertion_order`, `extensions.depth` |
| `category` | local directory metadata only; not exported |
| `probability`, `use_probability` | `extensions.probability`, `extensions.useProbability` |
| `selective_logic`, `scan_depth`, `case_sensitive`, `match_whole_words` | `extensions.selectiveLogic`, `scan_depth`, `case_sensitive`, `match_whole_words` |
| `exclude_recursion`, `prevent_recursion`, `delay_until_recursion` | same names under `extensions` |
| `ignore_budget`, `group`, `group_override`, `group_weight` | same names under `extensions` |
| `sticky`, `cooldown`, `delay`, `outlet`, `automation_id` | `extensions.sticky/cooldown/delay/outlet_name/automation_id` |
| `activation`, `position`, `role` | `constant`/`extensions.vectorized`, `extensions.position`/`position`, `extensions.role` |

Regex entry mappings (`replacement_file` supplies `replaceString`):

| YAML | Card JSON |
| --- | --- |
| `name`, `find`, `trim` | `scriptName`, `findRegex`, `trimStrings` |
| `disabled`, `display_only`, `prompt_only`, `run_on_edit` | `disabled`, `markdownOnly`, `promptOnly`, `runOnEdit` |
| `substitute_regex`, `min_depth`, `max_depth`, `placement` | `substituteRegex`, `minDepth`, `maxDepth`, `placement` |

Script entry mappings (`file` supplies `content`): `name`, `enabled`, `info`, `button`, `data`, `export_with`, `type`, `icon`, `color`, and `scripts` retain native field names. Type is `script` or `folder`; icon/color/children belong to folders. Inline small `data`; data over 2000 characters is split to a same-name `.data.yaml` via `data_file`. The two forms are mutually exclusive.

| Setting | English values | JSON mapping |
| --- | --- | --- |
| `activation` | `constant`, `keyword`, `vector` | always-active, keyword, vectorized flags |
| `position` | `before_character`, `after_character`, `before_author_note`, `after_author_note`, `at_depth`, `before_example_messages`, `after_example_messages`, `outlet` | position 0–7 in that order |
| `role` | `system`, `user`, `assistant` | role 0, 1, 2 |
| `placement` | `legacy_display`, `user_input`, `ai_output`, `slash_command`, `world_info`, `reasoning` | placement 0, 1, 2, 3, 5, 6 |
| `selective_logic` | `any`, `not_all`, `none`, `all` | 0, 1, 2, 3; numeric imports are supported |

## project.json

| Field | Meaning |
| --- | --- |
| `schemaVersion` | 2 for new projects; v1 remains readable and can be migrated |
| `name` | project name, matching the directory |
| `modules` | chosen template modules, not runtime switches; imported cards default to [] |
| `dependencies` | array of `{ url, purpose, version }` external resources |
| `avatar` | relative PNG path or null; imported PNG uses `src/assets/avatar.png` |
| `runtimeVerified` | actual host/version evidence; null when unverified |
| `original` | `baseline`/`baselineSha256`, plus imported `file`/`sha256` |
| `source` | tool-maintained `src/index.yaml` |
| `state` | tool-maintained `{ file: ".card/state.json", sha256 }` |

Dependencies must use credential-free HTTPS URLs containing their fixed version/commit. For example, the pinned MVU template uses:

```json
{
  "url": "https://cdn.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@3377b494cd7277230f3056230062124fe117f93f/artifact/bundle.js",
  "purpose": "Public MVU framework; Tavern Helper and enabled card scripts required.",
  "version": "3377b494cd7277230f3056230062124fe117f93f"
}
```

Field/build mappings are computed from YAML during loading rather than stored in project.json. Compatibility state retains unknown original data, entry records, links, and unreferenced records. Its SHA-256 protects integrity; manual editing fails validation. Back up it and `original/` with the complete project.

Migration snapshots v1 project/card files under `.card/migration-v1/`. It checks semantic equality and build mappings sorted by target before replacing the project; failure preserves the original. Templates affect future projects, not existing cards.

## Loading, content locations, and order

Split normalizes the baseline into `original/card.json`, preserves the imported file as `original/input.<extension>`, emits authoring YAML/source, and stores unrecognized compatibility data separately. It preserves order and metadata, with `link` connecting entries to their original records. Before check/build/diff, the loader assembles a complete card from explicit references and verifies files, boundaries, state, and original hashes. Immediate post-import diff should be empty; investigate missing references if it is not.

Text is under `src/text/`, legacy text under `src/legacy/`, greetings under `src/greetings/`, worldbooks under `src/worldbook/**/*.yaml`, regexes/scripts under their corresponding directories, depth prompt under `src/text/depth_prompt.md`, MVU's optional projection under `src/variables/schema.json`, and interfaces under `src/ui/html/` or `src/ui/vue/`. Short settings stay in YAML.

Regex/script index order is execution/loading order. Worldbook index order controls storage/display; actual injection groups by position/depth/role and then order. `card arrange` updates the index, continuous global order, and display_index together, after a backup. Split/build/organize do not silently change order. Removing references excludes content from the next build while allowing source files to remain. Changing `modules` alone does not add/remove any content.

## PNG and JSON

Only PNG/JSON carriers are supported. PNG `tEXt` chunks hold Base64 JSON: `chara` for V2 and `ccv3` for V3; ccv3 takes precedence when both exist. Accepted specs are `chara_card_v2` and `chara_card_v3`. V3 JSON fields are preserved, but CHARX packaging and automatic old-format conversion are not provided.

Build chooses the chunk according to spec and preserves original image data byte-for-byte apart from character-data chunks. PNG import supplies an avatar and outputs both JSON/PNG; JSON import without an avatar outputs JSON only.

Source references are project-relative with forward slashes. Absolute paths, backslashes, symlinks, traversal, Windows-reserved names, invalid filename characters, and trailing spaces/dots are rejected.

## Commands

See [AGENTS.md](../AGENTS.md#commands) for the main command table. Additional reference options are `refs search <keyword> [--limit N] [--context N]`, `refs check [--source <id>]`, `refs update [--source <id>] [--seed <directory>]`, and `refs verify-sources`. Restore uses the lockfile without updating it; update intentionally refreshes it.

Card commands return JSON shaped as `{ ok, action, results: [...] }`; reference commands use `{ ok, command, ... }`. Failure exits with code 1. In PowerShell, quote module lists: `pnpm card new my-card --modules "worldbook,regex,script,mvu,vue"`.

## Build and output

Check first; errors stop packaging. Script builds use esbuild to produce one browser ESM file; HTML/Vue builds use Vite plus singlefile, then Base64 transport wrapping. Results replace the bound card field in the assembled output, leaving authoring source editable. Audit non-built source and final bundled resources for unresolved files/modules and undeclared links.

Output is staged in a temporary directory and published to `dist/<name>/`. Existing-output replacement tries directory rename first. Windows EPERM/EACCES/EBUSY can trigger a file-by-file fallback with rollback backups. Failure restores prior output where possible; an extreme failure retains a backup path in the error. Whole-directory atomic replacement is not guaranteed.

| Output | Purpose |
| --- | --- |
| `<name>.json` | importable card |
| `<name>.png` | same card data with an avatar, when present |
| `build-report.json` | input/output SHA-256, sizes, dependencies, external URLs, warnings, check evidence |
| `USAGE.md` | import steps and runtime requirements |
| `scripts/*`, `ui/*` | inspection copies; names/numbers do not determine build bindings |

Total output above 5 MiB adds a device-performance warning. Checks parse/compile without executing imported code, type-checking TypeScript, fetching runtime URLs, or launching SillyTavern. EJS compile failures are warnings because fragments may span entries. Keep `runtimeVerified` tied to actual host evidence. See [Verification](VERIFICATION.md) and [Backup/update](UPDATING.md).
