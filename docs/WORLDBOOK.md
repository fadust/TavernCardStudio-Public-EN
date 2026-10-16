# Worldbooks

Worldbook entries determine what content becomes a prompt candidate and under which conditions. Authoring YAML maps into simplified card fields and complete host extension fields; see [Field mapping](ARCHITECTURE.md#authoring-field-mapping). Write the actual prose using [Worldbook writing](WORLDBOOK-WRITING.md).

## Activation, enabled state, and category

| Concept | Native field | Meaning |
| --- | --- | --- |
| Constant (blue light) | constant: true | no keyword requirement; enabled state, probability, budget, delay, and filtering still apply |
| Keyword (green light) | constant: false, not vectorized | any primary keyword must match before optional secondary logic |
| Vector | extensions.vectorized: true | host vector support required |
| Enabled | enabled | independent of activation; plugins such as MVU can read disabled entries specially |
| Secondary logic | selective | enables secondary-keyword conditions; does not mean keyword activation |
| Local category | authoring category/directories/title conventions | file organization only |
| Runtime group | extensions.group | candidate selection by group weight/scoring, not a folder label |

New entries do not combine constant and vectorized. Preserve unusual imported combinations until their meaning is reviewed. Empty disabled separators are optional; small cards do not need artificial empty entries.

## Recommended new-card layout

Use a small constant overview for essential world foundations, geography, institutions, or relationships; use keyword entries for topical details. Before-character often suits background, while after-character can suit current circumstances/relationships, but content type does not mandate position. Rules needing recent context can use at_depth with explicit depth and role: system by default. Choose depth by useful proximity, not a fixed number from another card.

General narration person, voice, rhythm, and length normally belong to the preset. Keep card-level requirements once and check for conflicts. Worldbook versus traditional description/personality/scenario/mes_example is an authoring choice; avoid duplicating prose. See [Creation](CREATION.md) and [World design](WORLD-DESIGN.md).

The worldbook template emits a small starter set; the generated YAML is authoritative. MVU adds its four standard entries. Check warns about enabled nonconstant, nonvector entries with no keys, since ordinary scans cannot activate them; script-forced activation needs separate evidence.

Embedded worldbooks live in data.character_book and travel with the card. Standalone worldbooks are separately bound by the player. Duplicate names do not automatically deduplicate content across books.

## Native entry fields

| Field | Meaning |
| --- | --- |
| id | stable entry ID, unrelated to filename |
| keys / secondary_keys | primary/secondary keywords |
| comment | entry name, normally not prompt content; may contain plugin markers |
| content | injected prose |
| enabled / constant / selective | independent switches described above |
| insertion_order | prompt order and budget priority |
| position | simplified before_char/after_char value |
| use_regex | specification field; pinned matching implementation does not read it to recognize regex keywords |
| extensions | full position/depth/role, probability, scanning, recursion, grouping, timing, and display settings |

Common extensions include position, depth, role, probability/useProbability, group/group_weight/group_override/use_group_scoring, prevent_recursion, exclude_recursion, delay_until_recursion, scan_depth, case_sensitive, match_whole_words, vectorized, sticky, cooldown, delay, automation_id, and display_index. Full authoring names are documented in Architecture.

## Primary and secondary keywords

Primary keywords are OR: any matching primary permits secondary checks. With selective enabled, selective_logic applies only to secondary keywords:

| English YAML | Numeric JSON | Logic |
| --- | --- | --- |
| any | 0 | AND ANY: at least one secondary matches |
| not_all | 1 | NOT ALL: at least one secondary does not match |
| none | 2 | NOT ANY: no secondary matches |
| all | 3 | AND ALL: every secondary matches |

For a clockmaker scoped to Night Harbor, use primary keys such as clockmaker/old shopkeeper and secondary Night Harbor with any. For two required scope terms use all. Do not treat primary keys as an AND list. Regex keywords must include slash delimiters/flags, such as /Night Harbor(?: Tower| Docks)/u; setting use_regex alone does not turn a bare string into a regex in the pinned implementation.

Scope combinations can represent geography, peoples, institutions, technologies, or social relationships. Primary keys include actual topic/child names; secondary keys restrict the parent scope. They match independently within the same scan window, potentially across different messages. Parent activation does not guarantee a child, nor does child activation guarantee its parent. A directory tree adds no runtime dependency.

```yaml
name: Geography - Mist Ridge
enabled: true
activation: keyword
position: before_character
keys: [geography, climate, terrain, trade route, Gray Ferry, Mist Ridge Town]
secondary_keys: [Mist Ridge]
selective: true
selective_logic: any
order: 3
exclude_recursion: true
prevent_recursion: true
file: src/worldbook/geography/mist-ridge.md
```

## Scanning and state

WorldInfoBuffer.get scans chat messages within scan_depth, explicitly selected card fields (description, personality, depth prompt, scenario, creator notes), scannable extension injections, and recursive buffers. Variables, UI state, and unchecked fields are not automatically included.

A location stored in stat_data cannot activate a location entry by itself. A variable-list macro can make state visible to the model without making it available before keyword scanning. State-driven activation needs a reliable pre-scan injection or another reviewed activation path. Document that path and test movement between regions. See [Scope scan reference](../.agents/skills/tavern-worldbook/references/location-scan.md).

## Position and order

Position enum values 0–7 are before_character, after_character, before_author_note, after_author_note, at_depth, before_example_messages, after_example_messages, and outlet. Extensions.position takes precedence over simplified position on import. At_depth requires depth and role; role values 0/1/2 are system/user/assistant. Depth 0 is near newest context; larger depths move into history. Scan_depth is a separate scanning range; null inherits host settings.

Insertion_order has two effects. The pinned implementation processes descending order for probability/budget, so larger values normally claim budget sooner. It then prepends into each injection block, making final block text ascending: lower values read first. This applies only within the same position and, at depth, the same depth/role. Constant/sticky/source/group strategy also affects selection; equal order should not enforce strict dependencies.

New cards align the index with continuous global order 1..N: before_character → after_character → at_depth, deepest first. Disabled entries form a maintenance tail. Within a shared depth the pinned host's final role order is assistant → user → system, based on doChatInject/populationInjectionPrompts; cached documentation differs, so recheck after upgrades. Default depth entries still use system.

The index controls storage/display; display_index is not prompt priority. Use `pnpm card arrange <name>` to deliberately update index/order/display together with a backup. Split/build/organize do not renumber. For custom author-note/example/outlet layouts, inspect the actual preset, arrange the index manually, then use --order index. Renumbering changes budget priority; validate in the host.

## Recursion

Exclude_recursion prevents this entry from being activated by recursive content. Prevent_recursion prevents its body from activating others. Both default true for predictability. Deliberate chains require the host's global recursive scan, necessary entry switches, depth/budget/cycle review, and real activation checks.

Pinned checkWorldInfo enters recursion only when the global world_info_recursive switch is enabled (default false). The card specification's worldbook.recursive_scanning field is retained by convertCharacterBook but is not itself used to control that global runtime path. Do not infer runtime support from a preserved JSON field.

## Activation verification

Test no keywords, a parent scope name, a child name, two scopes/topics in one round, variable-driven state with/without injection, global recursion off/on, aliases, exclusions, competing group members, and insufficient budget. Old scope terms remaining in history can activate multiple branches. Inspect actual activated entries and final prompts; static check cannot prove matches, macro values, or budgets.

Keep constant content small, names separate from prose, and depth entries aware that same-depth/same-role content merges into one text block. Review MVU-specific layout before changing initialization/list/rule entries.

Implementation evidence: pinned sillytavern/public/scripts/world-info.js, especially convertCharacterBook, originalWIDataKeyMap, matchKeys, getScore, checkWorldInfo, sortFn, WorldInfoBuffer.get, world_info_position, and WIDepthEntries. Worldbook prompt regexes (placement 5, isPrompt=true) run before injection and can change body text; display-only regexes do not alter that path. Pins are in maintenance/references.lock.json.
