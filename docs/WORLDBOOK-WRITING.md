# Writing worldbook prompts

This page concerns prose the model actually receives. Fields and activation are in [Worldbooks](WORLDBOOK.md); MVU formats are in [Variables](VARIABLES.md). JSON, YAML, XML, or paragraphs can carry prompts; YAML-looking prose is not executed by the host.

## Metadata and prose

Comment is the entry name, used for search and sometimes plugin markers; content is the injected prose. Keep names short and categories in directories. Prefixes are optional. Give each entry one independently activatable responsibility; combine tightly coupled small facts when they must arrive together. Do not over-split a tiny card.

Avoid editing instructions such as “change this entry” or “see the repository.” The model sees only injected text and cannot infer a missing neighbor, filename, or editor order. `{{char}}` expands to card name, not an arbitrary NPC. `{{user}}` is the player macro; a literal <user> tag has no automatic meaning without an explicit prompt/script contract.

General viewpoint, address, sentence rhythm, and length normally belong to presets/card fields. If a card requires its own narration policy, maintain it once and check conflicts.

## Concise YAML-style prose

Use short meaningful keys, coherent indentation, and complete list sentences. Preserve deeper relationships when useful; do not impose a fixed depth. Keep each entry self-contained. Retain numbers only when facts/mechanics/goals require them, with units and scope.

```yaml
Mist Ridge trade route:
  route: North from Mist Ridge Town through Gray Ferry to the northern plateau
  travel: About three days by caravan; longer in rain, closed in winter
  risk: Landslides south of Gray Ferry; fog obscures markers
  trade: Salt and iron northbound, furs on the return
```

Static character prose should identify role, current goal, knowledge limits, and observable behavior rather than stacking synonyms. Distinguish facts, beliefs, rumors, and secrets; author knowledge is not universal character knowledge.

Rules need a subject, trigger, action, and missing-information behavior. Record only new/changed injuries or other events this round rather than inventing facts from a numerical state. Let Schema constrain value shape and let prompts explain when/why values change. Do not create competing formulas or unrequested limits.

## Output contracts

Specify spelling, fields, location, count, and empty behavior for every tag consumed by code. Separate narration, structured data, and UI markers. Identify examples as format examples, not current events. Ellipses or descriptive placeholders are not legal JSON values.

| Marker | Producer | Consumer/history |
| --- | --- | --- |
| `<UpdateVariable>` / `<JSONPatch>` | fixed MVU model-output protocol | parser, display/prompt regexes; preserve raw message |
| `<StatusPlaceHolderImpl/>` | MVU automatically | display renderer, prompt cleanup; hide without UI |
| `<CardStatus/>` | independent non-MVU UI opening/output contract | independent rendering regex and history cleanup |

Custom markers need explicit consumers. “Output a status panel” alone does not create a UI.

## Conditional content

Keywords determine candidate activation; EJS can choose text inside content when Prompt Template is installed/enabled. Read actual request-available state and use default/omission for unknown values. Do not infer missing facts.

Prefer self-contained templates. Cross-entry wrappers require matching enabled/trigger/probability/budget/position/order so half a block cannot arrive. Review whether each entry makes sense alone, depends only on observable inputs, distinguishes examples from events, excludes irrelevant tool instructions, and has all protocol consumers. Preserve the current creative goal rather than imposing reference-card style or numerical conventions.
