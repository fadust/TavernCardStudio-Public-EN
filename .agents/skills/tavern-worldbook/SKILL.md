---
name: tavern-worldbook
description: Design or edit SillyTavern worldbook activation, keywords, categories, order, depth, recursion, and injected prose.
---

# Worldbook design

Read [Fields and mechanics](../../../docs/WORLDBOOK.md) and, when writing prose, [Worldbook writing](../../../docs/WORLDBOOK-WRITING.md) plus [Prompt style](../tavern-prompt-style/SKILL.md). Load [Scope scanning](references/location-scan.md) only for multi-level scopes/state-driven activation, [Dynamic worldbooks](../../../docs/WORLDBOOK-TEMPLATING.md) for macros/EJS, and [Files](../../../docs/WORLDBOOK-FILES.md) for organization/order. Do not load all upstream references. [World design](../../../docs/WORLD-DESIGN.md) is an optional content checklist.

## Design each entry's responsibility

Category is a local directory; position is a prompt region; activation is a candidate condition; parent/child relationships govern context arrival. Decide these independently. Directory types/levels are author choices. Runtime group is a mutually exclusive selection mechanism, not a folder.

Before prose, choose enabled state, activation, primary/secondary keys and logic, position, order, depth/role, and both recursion directions. Constant entries still face budget/probability. Keyword does not mean selective. Insertion depth differs from scan depth. English keys/enums and native mappings are in [Architecture](../../../docs/ARCHITECTURE.md#authoring-field-mapping).

Keep always-active content to essentials; details usually use keywords. Choose traditional fields or worldbooks for the same prose, avoiding duplicates. Let presets handle general narration style. Entry names identify content but bodies must be self-contained; runtime marker names are exceptions with exact consumers.

For new cards, align the index and consecutive global 1..N order with before_character → after_character → at_depth deepest first; disabled entries form a maintenance tail. Higher order normally competes for budget sooner and reads later within a block. Position/depth/role and host strategy still govern placement; numbering cannot cross position boundaries or guarantee every preset.

Secondary logic values are any (0), not_all (1), none (2), all (3), applied only after a primary match. Numeric imported values remain supported. Cross-entry wrappers require matching activation/enabled/probability/budget/position so both halves arrive; editor adjacency is insufficient.

## Default layout and scope keywords

A small constant overview with keyword details is a useful default. Before-character often holds world foundations/institutions; after-character can hold relationships/current circumstances, but neither is restricted to those topics. At-depth mechanics need explicit depth and default role system; choose proximity by purpose. Document deliberate deviations as creative choices rather than host requirements.

Trees can describe peoples, factions, organizations, or geography. Primary keys include topics/child names; secondary any restricts the parent scope. These are independent matches in one scan window, not recursion chains. Parent activation does not guarantee children. Historical old scope names and current topics may match together, so test two topics/factions/regions in one request.

Variables/UI state are not scan text. Current location needs reliable pre-scan injection if it must drive activation. Default both exclude_recursion and prevent_recursion true; deliberate recursion also needs the host's global switch and budget/cycle review.

## Delivery

Each src/worldbook/**/*.yaml is explicitly referenced by worldbook.entries; file points to prose. Preserve link. Categorize imported entries after reading necessary bodies and use organize for backed-up moves. For deliberate renumbering, use arrange; for author-note/example/outlet layouts inspect the host then use --order index. Split/build/organize do not renumber automatically.

Test no keys, aliases, scope/child names, exclusions, two groups/topics, variable state, recursion on/off, competing group members, and insufficient budget. Check/build only validate fields/syntax/packaging; actual injection/macros/budget need host previews. For version questions, search pinned world-info.js and trace import, activation, sorting, and injection rather than guessing.
