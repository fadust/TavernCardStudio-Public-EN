---
name: tavern-mvu
description: Configure MVU initialization, standard worldbook entries, fixed current-state/output assets, field update rules, and `<JSONPatch>` without automatically converting ordinary variable/text cards to MVU.
---

# MVU protocol and prompts

Read [Variables](../../../docs/VARIABLES.md); for structure changes also load [Zod](../tavern-mvu-zod/SKILL.md). Use the pinned parser's protocol rather than mixing old _.set tutorials, other template dialects, and full RFC 6902.

Choose [main-output versus extra-request mode](../../../docs/MVU-MODES.md). `[mvu_update]` identifies update rules/protocol; `[mvu_plot]` identifies narration-only mechanics; shared facts/state may remain unmarked. Actual injection still depends on activation/budget/filters. Markers do not configure mode or API connections.

Extra analysis requires a valid primary character worldbook and stage marker. Host group chat is not one multi-character card. Only explicit author requirements justify a disabled exact-name `[config_override]` entry with upstream JSON keys; no suffix or credentials. See the mode guide.

Use MVU's automatic `<StatusPlaceHolderImpl/>` marker for standard UI. Do not additionally instruct the model to emit it or invent a parallel `<CardStatus/>` chain. For special layouts define an explicit producer and verify duplicate display. Fix failed initialization/loading rather than hiding it with model-generated markers.

## New-card chain

Schema → initial state → current-state macro → field update rules → fixed output protocol → MVU parser → registered Zod constraints → UI readers.

Start with card new --modules mvu. The four responsibilities are disabled `[initvar]` data, fixed current-state macro, card-specific `[mvu_update]` rules, and fixed `[mvu_update]` output format. Bracketed markers are runtime contracts; descriptive suffixes/layout/order are repository conventions.

Write nested YAML field rules with type/check. Omit type for strings. Shared fixed-key explanations may use descriptive placeholders; dynamic-key rules live at the parent container with an index-signature explanation. Explain when state changes/stays, required evidence, and deliberate limits. Count only new events; do not assign model updates to derived underscore fields or invent numerical limits for completeness. Follow the prompt-style skill while preserving user intent.

## Verification

Align Schema, initialization, rules, output paths, and UI. Cover Pointer escaping, dynamic add/remove, move.to, empty patch arrays, legal JSON values, numeric delta, and valid intermediate states. Preserve raw messages for parsing; display/prompt regexes must not rewrite them first. Test complete and unfinished streaming blocks with [Regexes](../tavern-regex/SKILL.md). Static check/build success is not evidence of a real MVU update in SillyTavern.
