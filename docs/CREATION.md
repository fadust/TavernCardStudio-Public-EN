# Creating cards

Start by describing your goal in the workspace conversation. A brief and startup prompt are optional. See [Getting started](../README.md#getting-started) and [Complex cards](COMPLEX-CARDS.md).

| Path | Command | Work |
| --- | --- | --- |
| Simple | `pnpm card new my-card` | index and text files; worldbook if useful |
| Complex | `pnpm card new my-card --modules "worldbook,regex,script,mvu,vue"` | connect modules in dependency order |
| Imported | `pnpm card split <PNG-or-JSON> --name my-card` | preserve/diff, edit, classify/organize worldbook, check/build |

## Choose the experience before modules

Dialogue alone needs an opening. Dialogue with setting needs traditional fields or worldbook entries. Persistent state/UI may need variables, regexes, scripts, or frontend; state can use native variables, MVU, or custom logic. Do not add unrelated modules. No modules means a plain-text card. Quote the comma-separated list in PowerShell and choose only one initial frontend, html or vue.

| Module | Contribution |
| --- | --- |
| worldbook | constant/keyword/vector setting injection; YAML settings plus file body under src/worldbook |
| regex | prompt/display replacement; replacement_file plus tests/regex.json |
| script | browser JavaScript, host events, variables, and custom interactions |
| EJS (no separate module) | conditional prompt text evaluated by Prompt Template |
| mvu | pinned framework/adapter, schema.ts, four standard entries, complete/streaming update regexes and fixtures |
| html/vue | message iframe source built into a single page and rendered through regex replacement |

Read the matching skill before implementing a module. A frontend need not use MVU; MVU need not have a frontend. JSON Schema is editing reference rather than runtime registration.

## Place setting content deliberately

Worldbook entries are recommended for new cards because they can be conditionally injected and maintained separately. Traditional description/personality/scenario/mes_example fields are simpler for small settings but consume context and can be disabled/changed by presets. Use one main location for each piece of prose. Reference only useful fields under text. Unreferenced source files can remain without being packaged. Preserve imported nonempty fields.

For a large world, choose content using [World design](WORLD-DESIGN.md). Category (local directory), activation (candidate conditions), position (prompt region), and parent/child arrival are separate decisions. Trees can describe peoples, politics, customs, organizations, or geography. A category does not fix a position or activation mode.

## Suggested sequence

1. Establish single-character versus multi-character/world scope, card name, player role, and opening. `{{char}}` is the card name; use explicit NPC names where needed.
2. Write the setting in worldbook entries or traditional fields.
3. If state is required, choose its writer/storage, define structure and initial values, then choose [MVU update mode](MVU-MODES.md) if applicable.
4. Write field-specific update conditions for the model.
5. Add regexes to hide update blocks and render UI markers.
6. Add scripts/frontend last, after their input contracts are clear.

Load [Prompt style](../.agents/skills/tavern-prompt-style/SKILL.md) before model-facing prose. Synchronize repeated facts, state, and openings across files.

## Card fields

Edit the source referenced by src/index.yaml rather than generated JSON. Character name is required and may name a world/scenario rather than an NPC. Always reference text.first_mes. Other traditional fields are optional; do not fill them with meaningless placeholders. The first message enters chat history and strongly demonstrates intended voice/length. Alternate/group greetings are path lists.

System_prompt and post_history_instructions only apply when the player enables the corresponding host preferences. Creator, character_version, creator_notes, and tags are metadata; they generally do not enter prompt assembly by default. See [Architecture](ARCHITECTURE.md#authoring-field-mapping).

## Prompt principles

Each instruction must be self-contained in the actually injected request, state an observable condition/action, and provide unknown/default behavior for missing inputs. Initialize/inject values before reading them. Mark format examples as examples rather than past events. Remove duplication instead of abbreviating concepts. Prefer concise YAML-style settings/mechanics, while preserving natural prose for openings/dialogue and the user's intentional style. General narration requirements usually belong to the preset.

## Delivery checks

- Referenced text has real content; setting prose is maintained once.
- Worldbook activation, position, order, depth, role, and local category are deliberate. Imported whole-card worldbooks are classified/organized or unresolved entries are reported.
- Index/order follows intended prompt reading order; custom positions have host evidence. Static numbering is not runtime verification.
- State initializes before reads, with consistent Schema/initial/rule/output/UI paths and types.
- Every regex has meaningful fixtures; replacements preserve adjacent prose and JSON/Markdown structure.
- External dependencies are public, declared, and pinned. Interfaces fit narrow containers without overflow.
- Check/build pass, imported-card diff is reviewed, and build-report warnings are read.
- Report actual files, commands/results, outputs, dependencies, and missing host tests. Leave runtimeVerified null without host evidence.
