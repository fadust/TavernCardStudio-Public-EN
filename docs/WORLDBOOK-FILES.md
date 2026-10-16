# Worldbook directories, names, and packaging

Organize entries into meaningful category subdirectories. Filenames do not need ordering numbers: entry settings determine injection. Categories and depth are open-ended author choices; politics, peoples, customs, organizations, geography, and cross-cutting structures are all valid. Small cards need no empty directory taxonomy.

```text
src/worldbook/
  setting/world-rules.yaml
  setting/world-rules.md
  geography/old-bookshop.yaml
  geography/old-bookshop.md
  characters/shopkeeper.yaml
  characters/shopkeeper.md
  rules/information-boundaries.yaml
  rules/information-boundaries.md
```

YAML contains activation/keyword/position settings. The file it references contains the model-facing prose, which may itself use YAML-style indentation. Macros/EJS remain text during split/build; tools do not expand/execute them. See [Dynamic worldbooks](WORLDBOOK-TEMPLATING.md).

## Local category metadata

```yaml
name: Northlands
category: geography/northlands
file: src/worldbook/geography/northlands/northlands.md
```

Category is an optional slash-separated safe relative directory. It is not exported, does not affect activation/injection, and must not change card semantics. Organize moves the entry's settings/movable body there; without category it retains the current directory. Invalid path segments fail load/check. The tool does not infer categories from prose.

Only files explicitly referenced in worldbook.entries participate in packaging. Comments can segment the list while retaining its sequence. Do not create empty runtime entries for folders or use mutually exclusive runtime groups as categories.

## Ordering and identity

For normal new-card layout, index/order follow before_character → after_character → at_depth deepest first; same-depth role groups follow pinned assistant → user → system, and prior order is ascending inside groups. Enabled entries receive consecutive global 1..N values; disabled entries stay in a maintenance tail. Host budgets, timing, grouping, depth, and role still control actual placement.

Use `pnpm card arrange <name>` for explicit index/order/display_index changes with a full backup. Split/build/organize never silently renumber. For author notes, example messages, outlets, or invalid/missing imported orders, inspect the host preset, arrange the index manually, then use --order index. Renumbering is not lossless organization: it changes budget priority and needs host review.

Preserve link when moving/renaming. Plugin markers remain in entry name; filenames are not runtime protocols. For newly added entries without link, manually changing paths before first organization can alter path-derived IDs. The organizer records identity before moving them.

## Import and classify

New templates carry explicit categories. Imported cards have no local authoring category; split infers only clear title prefixes/overview/protocol conventions. Unknown titles go to unclassified. Names, bodies, and host settings remain unchanged. It does not assume every after-character entry is a character.

Whole-card import includes agent-led classification:

1. Run card map for worldbook inventory and classification.pending, without dumping all bodies.
2. Read necessary pending bodies in batches sized to entry length.
3. Set category by responsibility, preserving entry boundaries, keywords, position, and prose.
4. Organize, check, and diff.

For a targeted edit, classify only involved entries; for a whole-card import/redesign, classify the whole worldbook. Mixed topics can use their main responsibility or a custom cross-topic directory without splitting content. Only unresolved/unfinished entries remain pending, explicitly reported. Resolve routine classification autonomously; ask only if ambiguity changes the creative direction.

Windows filename cleanup removes invalid/reserved names. Local suffixes such as Name (2) resolve collisions, including case-insensitive collisions, without overwriting. Author-supplied numbers are retained; old numbered paths remain valid.

## Organize an existing project

```sh
pnpm card organize my-card
pnpm card check my-card
pnpm card diff my-card
pnpm card build my-card
```

Organize touches referenced worldbook entries only, uses category or the current directory, removes tool-generated global filename numbers, creates semantic filenames, and updates references. Unknown extensions, unreferenced files, originals, and user settings are preserved. It works on a temporary copy, verifies complete card data/build bindings, then replaces the project. Do not edit concurrently.

Movable bodies are unbuilt .md/.txt files inside src/worldbook. Bound build output, executable sources, and relative import trees stay in place; only settings move and retain those references. Literal paths mentioned in prose are not rewritten and may need separate maintenance.

A complete pre-operation backup is returned under work/layout-backups. Keep it until review and move long-term backups elsewhere because work is not distributed. Unchanged repeat runs create no edits/backups. Migrate v1 before organization; see [Updates](UPDATING.md).

## Manual moves

Prefer category + organize. If manual moves are necessary, inspect the index/configuration/body/build first, retain link, update index and file paths, and verify relative imports/assets. When uncertain, leave executable code in place. Run map/check/diff/build. Directory moves should not change content, activation, or injection order. Do not resplit originals over existing edits to change a directory.
