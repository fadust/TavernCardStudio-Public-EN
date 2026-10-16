# TavernCardStudio workspace instructions

This workspace lets people and AI agents write, inspect, split, and package SillyTavern character cards locally. Start with the user's conversation and actual card. No completed brief or pasted startup instruction is required. Load only the skills and documentation needed for the current task.

## Starting paths

| Path | Start | Work next |
| --- | --- | --- |
| Simple card | `pnpm card new <name>` | Edit `src/index.yaml` and `src/text/*.md`; add worldbook entries if useful. Settings may live in traditional fields or a worldbook. |
| Complex card | `pnpm card new <name> --modules "worldbook,mvu,vue"` | Read [Complex cards](docs/COMPLEX-CARDS.md) before changing linked worldbook, variables, regexes, scripts, or interfaces. |
| Imported card | `pnpm card split <PNG-or-JSON> --name <name>` | First confirm preservation with `pnpm card diff <name>`, then edit `src/`. Do not split the original again over existing edits. |

## Agent entry points

- Resolve routine details from the conversation and files. Ask only for missing information that materially changes the goal or outcome. Existing creative notes are references, not forms the user must complete.
- When installation is requested or first startup fails because of the environment, follow [Installation](docs/INSTALL.md): inspect and prepare Node.js, pinned pnpm, and project dependencies, then verify startup. Ordinary setting discussions do not need environment checks first.
- Read this file, the relevant skill below, then the documentation needed for the task. Do not load every skill or all reference sources.
- Before editing a card, locate its content with `pnpm card map <name>` and generated `CONTENTS.md`.
- Worldbook organization is part of a whole-card import. Use `card map` to identify pending entries, read their necessary bodies in batches, set their local `category`, then run `organize`. See [Worldbook files](docs/WORLDBOOK-FILES.md) for scope and preservation boundaries.
- After editing, run `pnpm card check <name>` and `pnpm card build <name>`. When references, modules, or build bindings change, also run `pnpm card diff <name>`. Report static checks, packaging, and real-host verification separately.

## Task-specific skills

Repository skills live in `.agents/skills/`; do not install them globally. Agents supporting that directory can select by description. Other agents can read the linked SKILL.md directly. Upstream template skills are research sources rather than instructions for this repository.

| Task | Skill |
| --- | --- |
| New cards, substantial redesign, complex-card research | [Card authoring](.agents/skills/tavern-card-authoring/SKILL.md) |
| Prompt prose, card fields, rules, output contracts, initialization/update instructions | [Prompt style](.agents/skills/tavern-prompt-style/SKILL.md) |
| Activation, keywords, categories, order, depth, worldbook prose | [Worldbooks](.agents/skills/tavern-worldbook/SKILL.md) |
| MVU initialization, standard entries, rules, protocol | [MVU](.agents/skills/tavern-mvu/SKILL.md) |
| Zod 4 structure, defaults, transforms, registration | [MVU Zod](.agents/skills/tavern-mvu-zod/SKILL.md) |
| Display/prompt regexes, streaming blocks, depth | [Regexes](.agents/skills/tavern-regex/SKILL.md) |
| Tavern Helper scripts and EJS | [Scripting](.agents/skills/tavern-scripting/SKILL.md) |
| HTML/Vue interfaces | [Frontend](.agents/skills/tavern-frontend/SKILL.md) |

Distinguish **runtime requirements** established by pinned implementations, **repository conventions** for consistent new cards, and **reference-card design** that applies only when useful. Preserve an existing card's protocols and data model during migration.

## Hard constraints, conventions, and preferences

- Tool constraints prevent invalid output: dependencies must be credential-free HTTPS URLs containing their declared fixed version; entry keys must be allowed; references stay inside `src/`; `project.name` matches the directory; `.card/` and `original/` are maintained by tools.
- Repository conventions are defaults: choose the experience before modules, prefer worldbooks for new setting content, and update actual entries and dependencies when modules change. Follow explicit user goals and explain any deliberate deviation.
- Creative preferences include genre, voice, numerical systems, entry boundaries, UI layout, and opening count. Follow the current user's goals rather than imposing a sample card or personal preference.

Runtime behavior and explicit user requirements settle conflicts. When uncertain, use the documented default and identify it as a default in the report.

## Editing boundaries

- Complete originals are archived in `imports/`, editable projects in `cards/<name>/src/`, and outputs in `dist/<name>/`. Studio and CLI split share archival behavior: reuse identical names/content, suffix different content, never overwrite an existing import. People and agents edit the same source and then build it.
- Personal `cards/` are ignored by Git. Only official examples explicitly listed in `.gitignore` and `maintenance/public-release.json` are tracked. `dist/`, `imports/`, `work/`, and reference caches are also excluded. See [Updates](docs/UPDATING.md) to version personal cards.
- `project.original.importPath` records the archived original's location; it is not build input. Deleting that archive does not remove the independent verified copy in `original/`.
- Authors edit source prose/code and readable configuration under `src/`. JSON cards, PNGs, pointers, compatibility state, and packaged outputs are generated.
- `src/index.yaml` is the entry point: `character`, `text`, `alternate_greetings`, `group_only_greetings`, `worldbook`, `regex`, and `scripts` reference content. Text values point to `src/...` files. New projects use English keys; legacy Chinese keys remain accepted at authoring boundaries.
- Each worldbook, regex, or script entry has a YAML configuration. Preserve generated `link` identities; do not edit or renumber them. New entries may omit `link`. Existing entries can be recovered by their original paths if the link is absent, but moving/renaming requires retaining it. Use `file` for worldbook/script bodies and `replacement_file` for regex replacement bodies.
- Optional worldbook `category: geography/northlands` controls local placement by `organize`, not activation or exported card data. Without it, retain the current directory.
- `project.json` records modules, dependencies, avatar, `runtimeVerified`, `original`, and tool-maintained `source`/`state`. Index/entry YAML controls actual content and order.
- Generated `CONTENTS.md` is navigation, not an editing entry point. `.card/state.json` stores compatibility data and link mappings with SHA-256 verification. Preserve unknown/legacy data, unreferenced-entry records, and migration snapshots in `.card/migration-v1/`. Back up/commit these with the project; do not read or alter them during ordinary authoring.
- `modules` records template selections, not runtime feature switches. Maintain actual entries, settings, and dependencies to change an existing card's functionality.
- `original/` is read-only and each file's SHA-256 is verified. `dist/` is rebuilt. `references/` is read-only research, never executed or automatically packaged. Public packages omit reference bodies; restore pinned copies with `pnpm refs restore`.
- Create projects with `card new` or `card split` (both generate v2). Migrate older projects with `card migrate`. Adding/removing/reordering references takes effect on the next build; unreferenced files may remain without being packaged.

Worldbooks use category subdirectories and meaningful names without global filename numbering. Existing paths remain supported. Read [Worldbook files](docs/WORLDBOOK-FILES.md) for organization and [Dynamic worldbooks](docs/WORLDBOOK-TEMPLATING.md) for macros/EJS.

## Commands

Use `Open-TavernCardStudio.cmd` (Windows), `sh Open-TavernCardStudio.sh`, or `pnpm studio`. Studio shares the split/check/build implementation and adds rename, copy, and cover operations. It listens only on 127.0.0.1. UI: `tools/studio-ui/`; server: `tools/studio.mjs`; operations: `tools/lib/studio-operations.mjs`. See [Studio](docs/STUDIO.md).

| Command | Purpose |
| --- | --- |
| `pnpm setup:workspace` | Check environment; install once with `--frozen-lockfile` if dependencies are missing or drifted. Print guidance and exit 1 if prerequisites are unmet. |
| `pnpm doctor:workspace` | Read-only Node/pnpm/dependency/lockfile/tool diagnosis. |
| `pnpm card new <name> [--modules worldbook,regex,script,mvu,html,vue]` | Create a skeleton; plain text by default. |
| `pnpm card split <PNG-or-JSON> [--name name]` | Archive and split an existing card. |
| `pnpm card check <name\|all>` | Static validation. |
| `pnpm card build <name\|all>` | Check and package into `dist/<name>/`. |
| `pnpm card diff <name\|all>` | Compare source with the original baseline. |
| `pnpm card migrate <name\|all>` | Migrate v1 in place, preserving snapshots in `.card/migration-v1/`. |
| `pnpm card organize <name\|all>` | Back up, move worldbook files by category, update references, verify unchanged semantics. |
| `pnpm card arrange <name\|all> [--order prompt\|index]` | Back up, reorder the index, renumber `order`, synchronize `display_index`. Default: usual prompt layout. |
| `pnpm card map <name>` | Locate source/settings/bodies/build bindings/unreferenced entries and worldbook classification work. |
| `pnpm card help` | Usage, defaults, modules. |
| `pnpm inspect-card <JSON-or-PNG>` | Read-only summary; use `--entries` and `--entry <id>` for targeted inspection. |
| `pnpm refs restore [--source <id>]` | Restore pinned complete commits/files and verify hashes without changing the lockfile. |
| `pnpm refs search <keyword>` / `pnpm refs check` | Search restored references / verify cache integrity. |
| `pnpm refs update` | Intentionally upgrade sources and rewrite the lockfile; maintainers only. |
| `pnpm verify` | Offline tests, official-example builds, release checks. |
| `pnpm verify:refs` | Verify restored references against the lockfile. |
| `pnpm release:check` | Check public allowlist, documentation links, common credential patterns. |

Quote comma-separated module lists in PowerShell. Command results are JSON; summaries do not replace reading errors and warnings. Back up full card directories before upgrading; run setup, doctor, check all, and build all afterward. Migrate only cards that need editing rather than migrating every project. See [Updates and backup](docs/UPDATING.md).

## Facts and evidence

Use the pinned implementation and actual card YAML to establish fields, triggers, and APIs; see [Sources](docs/SOURCES.md). Declare external resources in `dependencies` as credential-free HTTPS URLs containing their fixed `version`. Embed private assets; undeclared external links fail validation. `runtimeVerified: null` means unverified, not supported or unsupported.

Static checks/builds do not prove real-host compatibility. Do not execute imported scripts, EJS, or interfaces. JavaScript is parsed with acorn, TypeScript is syntax-transformed, Vue SFCs are parsed/compiled, and EJS compilation failures currently produce warnings. Workspace content is for non-commercial use; see [LICENSE](LICENSE).

## Card-authoring rules

- Establish whether the card names a single interactive character. `{{char}}` expands to the card name, not an arbitrary NPC; use explicit names/roles for world or multi-character cards.
- Prefer concise YAML-style setting prose. Choose a small always-active overview and keyword-triggered details where useful. Trees can describe peoples, politics, customs, organizations, relationships, or geography; categories and layers follow the work.
- Design category, activation, position, and parent/child arrival independently. Before-character content often holds world foundations; after-character content can hold relationships/current circumstances, but neither is restricted to those topics. Use `at_depth` for rules needing recent context, with `role: system` unless a different message role is deliberate.
- New entries default to `exclude_recursion: true` and `prevent_recursion: true`. These are predictable authoring defaults, not host requirements. Deliberate recursion needs both global and entry-level design.
- Worldbooks mainly carry facts, characters, and mechanics. General narrative person, voice, and length normally belong to the preset. Scope keywords can express trees without recursion; variable state does not enter scans automatically.
- Choose main-output versus extra-request MVU updates first; see [MVU modes](docs/MVU-MODES.md). Standard status UIs consume MVU's automatic `<StatusPlaceHolderImpl/>`; do not also ask the model to emit it. Special layouts need an explicit producer/consumer chain.
- Load [Prompt style](.agents/skills/tavern-prompt-style/SKILL.md) before writing prompts. Distinguish rules, settings, dialogue examples, and narration. Preserve intentional voice while checking facts, conditions, and injection dependencies. Synchronize repeated representations of the same fact.
- Choose modules after the experience. Plain-text cards need none. Initial templates choose either `html` or `vue`; independent interfaces can be added later.
- Settings may live in worldbooks (recommended for new cards) or traditional `description`, `personality`, `scenario`, `mes_example` fields. Reference only useful nonempty fields under `text`; avoid duplicating the same prose. Always reference `first_mes`. Unreferenced text files can remain on disk. Preserve imported nonempty fields.
- New-card references: `cards/example-worldbook-authoring/`, `cards/example-fogharbor-bureau/` for a complete complex chain, and `cards/example-mvu-zod-vue/` for MVU. Older migrated examples remain compatible without defining current defaults.
- Models can rely only on information actually injected into the request. Every variable/macro/entry needs a reliable write/injection path before being read; otherwise use unknown/default behavior.
- Embed custom assets by default. Public hosting at fixed versions is optional; see [Remote assets](docs/REMOTE-ASSETS.md). Declare dependencies. Base64 HTML packaging prevents host capture/macro substitution; it is encoding, not encryption.
- Regex/script list order is execution/loading order. For new worldbooks, align the index and global consecutive `order` values: `before_character` → `after_character` → `at_depth` deepest first; enabled entries use 1..N, disabled entries form a maintenance tail. Do not reserve large number gaps. Host position/depth/role and budget still determine actual injection.
- Use `card arrange` for explicit renumbering with a full backup; split/build/organize do not change budget priority automatically. For author notes, example messages, or outlets, inspect the preset, arrange the index manually, then use `--order index`. Verify changed budget priority in the host.
- `build` may attach to text references (`{ file, build }`), worldbook, regex, or script entries. Inline small script `data`; use exclusive `data_file` for a same-name `.data.yaml` when larger than 2000 characters. Preserve tool-bound `attachments` for irregular imported nested text.
- New MVU cards use the repository's four-entry/Zod template. Variable-list and output-protocol assets are fixed; ordinary authoring changes structure, initialization, and update rules. Protocol changes require parser/adapter/regex review together.
- Research sample cards through metadata summaries and targeted reads. Imported samples are optional research data, never executable tooling or required fixtures.

## Subagents

Independent research, local reviews, checks, and reporting may be delegated. Keep simple or sequential steps local. State the goal, boundaries, and evidence; retain the current runtime model/reasoning configuration. Do not edit the same file or card output concurrently. Return changes outside scope or design decisions to the main agent. Prompt review may be delegated using `tavern-prompt-style`, but delegation is optional and reviewers should not presume another draft is defective.

## Documentation conventions

Document scope, behavior, interfaces, and workflows for users/maintainers, not temporary progress or abandoned plans. Link to lockfiles/originals/command output for drifting quantities and legal details. Identify uncertainty and verification steps; do not describe plans as completed work. `package.json` and tool behavior are authoritative; fix documentation/implementation mismatches. Follow [English localization principles](docs/LOCALIZATION.md).
