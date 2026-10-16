---
name: tavern-prompt-style
description: Write or review character-card prompts, distinguishing rules, setting, dialogue examples, and player narration; check consistency and executability while respecting the user's intended style.
---

# Prompt prose and style

Read [AGENTS.md](../../../AGENTS.md), then use the current conversation, actual text, and any optional author notes. Preserve existing structure and load only necessary entries.

| Text purpose | Review focus |
| --- | --- |
| mechanics/update rules/output protocol | clear conditions, actions, scope, exceptions, fields, and numerical meaning |
| characters/world setting | consistent facts/relationships and reliable injection when needed |
| dialogue examples | character voice and interaction, explicitly examples rather than past events |
| openings/player narration | appropriate viewpoint, pacing, scenes, and dialogue rather than mechanical rule prose |
| creator notes/brief | useful maintainer/player guidance, not assumed model knowledge unless injected |

## General checks

Preserve user-defined facts, genre, boundaries, values, and format. Do not import another card's personality codes, numerical limits, or mechanics. Conditional instructions can rely only on actually injected information; unknown-state behavior must not invent events. Synchronize repeated facts across fields, worldbooks, state, rules, and openings.

Remove repetition without abbreviating important concepts. Keep required numerical mechanics/history intact. Tags, macros, JSON Pointers, enum names, and variable names must match real consumers; protocol changes require parser/display-chain review.

`{{char}}` expands to the card name, not any NPC. Prefer explicit names/roles except for a same-named single character. Confirm the intended player identity for user. General narration person/voice/length normally belongs to the preset. Keep worldbook facts/behavior/mechanics and add card-level narrative rules only when requested, checking preset conflicts. Distinguish subjective beliefs from world facts and avoid choosing the player's unchosen actions/thoughts unless explicitly part of the design.

## Default prose format

Prefer concise YAML-style setting/rule text with meaningful short keys and readable indentation, without repeating facts to fill a form. This body is separate from entry configuration YAML. Actual initial data must parse as JSON/YAML and patches must remain legal JSON.

```yaml
Archivist:
  role: Verify submissions and record sources
  conflicting records: Note differences before changing the register
  missing original: Keep an unverified marker
```

This helps readability/deduplication, not a guaranteed token reduction for every model. Avoid decorative layers/tags and duplicate keys. Openings/dialogue retain natural prose; preserve user-specified formats.

For mechanics, default to observable conditions/actions: “When records conflict, the archivist records the differences and checks originals before amending the register; missing originals remain unverified.” This is a style recommendation, not a runtime requirement. Preserve requested narration, first-person dossiers, or deliberate rhetoric. Actions, dialogue, and cognition verbs are not inherently errors.

## Review and edit

Determine purpose/style; identify concrete contradictions, absent conditions/injection dependencies, duplication, or protocol errors; make the smallest correction; then synchronize cross-file facts/paths/initial values/output. Do not presume another author's/model's draft is defective. Optional independent review can be delegated, but the primary agent can perform the same checks. Use [Worldbooks](../tavern-worldbook/SKILL.md) for triggers and [MVU](../tavern-mvu/SKILL.md) for variable contracts.
