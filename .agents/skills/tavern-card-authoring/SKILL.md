---
name: tavern-card-authoring
description: Create, redesign, or research SillyTavern cards in TavernCardStudio; select modules and coordinate text, worldbooks, variables, regexes, scripts, and interfaces. Use a specialist skill for a single-module edit.
---

# Card authoring and research

Read [AGENTS.md](../../../AGENTS.md). Choose modules from the user's desired experience, existing editing boundaries, and delivery scope. A reference card's features are not mandatory for a new card.

## New cards

1. Establish single-character/multi-character/world scope, player participation, and opening conflict. `{{char}}` is the card-name macro, so use explicit NPC names where appropriate. Infer routine details and ask only questions that materially change the result.
2. Follow [Creation](../../../docs/CREATION.md) and create the needed skeleton with card new. Default to plain text; add MVU for persistent state and a frontend for visual interaction. Current references are example-worldbook-authoring and example-mvu-zod-vue; older migrated examples do not define defaults.
3. Load [Prompt style](../tavern-prompt-style/SKILL.md), write the opening/setting, and reference meaningful traditional fields under text or entry YAML under worldbook.entries. Maintain each piece of setting prose once. With variables, define structure first, then initialization/rules/UI, and finally tags/regexes.
4. Load only involved specialist skills. Choose [MVU mode](../../../docs/MVU-MODES.md); standard UI uses its automatic marker. Embed custom code by default and use [remote hosting](../../../docs/REMOTE-ASSETS.md) only when needed.
5. Run check/build; for edits to imported cards also inspect diff. Deliver local artifacts and import instructions, distinguishing static/build evidence from host/model tests.

Generated CONTENTS.md is navigation, not source. Tools maintain card JSON/PNG, pointers, .card, and originals. Worldbook filenames/categories do not determine prompt order. Optional category controls local organization only; use organize for backed-up moves. Trees may describe peoples, politics, customs, organizations, or geography. See [World design](../../../docs/WORLD-DESIGN.md) and [Worldbook files](../../../docs/WORLDBOOK-FILES.md).

For cross-module edits, first run card map and follow [Complex cards](../../../docs/COMPLEX-CARDS.md): worldbook rules → MVU/Zod → output tags → regex → UI → scripts. For isolated exercises, use explicit roots through [exported tool functions](../../../docs/ARCHITECTURE.md#isolated-tests), not the default CLI on real cards.

| Work | Read as needed |
| --- | --- |
| activation, keywords, depth, prose | [Worldbook skill](../tavern-worldbook/SKILL.md) |
| initialization/list/rules/protocol | [MVU skill](../tavern-mvu/SKILL.md) |
| Zod structure/defaults/registration | [Zod skill](../tavern-mvu-zod/SKILL.md) |
| display/prompt/streaming routing | [Regex skill](../tavern-regex/SKILL.md) |
| Helper events/EJS | [Scripting skill](../tavern-scripting/SKILL.md) |
| message HTML/Vue | [Frontend skill](../tavern-frontend/SKILL.md) |

## Imported cards and compatibility

Preserve legacy_text, legacy_regex, legacy_script_groups, helper_variables, legacy_helper_variables, and bound attachments in their original structures/order. Do not merge them into standard entries merely for consistency. English authoring keys are the default; legacy Chinese keys remain supported. User prose/keys/data are not automatically translated. Source/state/.card are tool-maintained.

Build may attach to a text reference ({ file, build }) or any supported entry. Large script data uses data_file and a same-name .data.yaml rather than inline data; the forms are mutually exclusive.

## Classify and organize after import

Split only infers directories from clear titles/protocol conventions. For whole-card work, organization is part of delivery:

1. Card map identifies the worldbook inventory and pending classification without reading all prose.
2. Read necessary bodies in sensible batches.
3. Set category by responsibility, preserving boundaries, keywords, positions, and prose. Do not split a trigger protocol merely to fit a folder.
4. Organize, check, and diff.

Targeted edits only require involved entries; whole-card import/design requires the whole book. Mixed topics can use a main/custom category without splitting prose. Only genuinely unresolved entries remain pending and must be reported. Resolve ordinary classifications autonomously; ask only if ambiguity changes creative direction.

New indexes/order follow the usual before_character → after_character → at_depth deepest-first layout with global 1..N numbering. Use arrange explicitly for old-card renumbering and retain backups. For author-note/example/outlet positions, inspect the host preset, arrange the index, then use --order index. Order changes budget priority and needs host review.

## Research cards safely

Use inspect-card summaries, --entries, and targeted --entry <id> reads for worldbooks/scripts/regexes. Never execute reference-card code to inspect effects. Record SHA-256, IDs, relevant settings, and small necessary excerpts. Study structure/responsibility/constraints rather than copying plots, names, private values, obsolete designs, or an entire UI.

Separate runtime requirements, repository conventions, and sample-card choices. A field's presence does not prove the runtime reads it; trace the pinned source. Research conclusions must remain useful without the private sample. Imports can be removed; templates, skills, and tests must not depend on them.
