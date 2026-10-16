# MVU variables and output protocol

MVU stores state in message variables under stat_data, parses model update blocks, and writes the new message state. Tavern Helper supplies variable storage APIs; MVU is a separate framework using them. Plain-text cards do not need MVU. Choose [main-output or extra-request updates](MVU-MODES.md) first.

## Standard template and editing boundaries

`pnpm card new my-card --modules "mvu"` supplies pinned framework/registration scripts, schema.ts, four worldbook entries, complete/streaming display/prompt regexes, and fixtures. Status-marker regexes render a UI when selected or hide the marker otherwise. Custom content is embedded by default; [public pinned hosting](REMOTE-ASSETS.md) is optional. Template updates do not migrate old cards automatically.

| Entry | Default settings | Responsibility |
| --- | --- | --- |
| `[initvar]` initial variables | constant, disabled, before_character | Schema-aligned JSON/YAML initial values |
| Variable list | constant, enabled, at_depth 0/system | fixed current-state macro |
| `[mvu_update]` update rules | constant, enabled, at_depth 0/system | card-specific field change conditions |
| `[mvu_update]` output format | constant, enabled, at_depth 0/system | fixed repository protocol asset |

Within the shared block, list → rules → format is the intended order. Both recursion directions are disabled. Actual generated names/order are in templates/modules/mvu/module.json. D0/system and descriptive suffixes are repository conventions, not parser identifiers. Schema, initial state, update paths, rules, and UI must align. JSON Schema alone does not register runtime constraints; see [Zod](MVU-ZOD.md).

## Runtime name contracts

`[initvar]` marker matching is case-insensitive inside comment; update/plot markers select request phases. These markers can retain descriptive suffixes/prefixes. `[config_override]` is different: it requires a disabled entry with its exact standalone name, ignoring case/outer whitespace, and JSON content. Variable list is a consistent display name rather than a parser requirement. Never translate the bracketed markers.

In main-output mode, the phase filter returns early: update markers do not mean “only sent to the extra model.” In extra mode, stage markers and title filters determine availability alongside enabled/activation/budget settings. Inspect actual requests.

## Initialization

MVU reads `[initvar]` entries from enabled/bound worldbooks without filtering the entry's own enabled state. Keeping the entry disabled prevents repeated prompt injection while still allowing initialization. Its body is plain JSON/YAML data, without a stat_data wrapper or explanatory prose.

An opening's `<initvar>` block can override worldbook initialization for alternate starts. Check every opening against Schema. Do not depend on accidental merge order among duplicate initializers. Source: pinned mvu/src/function/initvar/variable_init.ts.

## Fixed list and format assets

Use templates/modules/mvu/variables.md unchanged:

```text
<status_current_variable>
{{format_message_variable::stat_data}}
</status_current_variable>
```

This reads current message state through a host macro. Do not replace it with initial values or a manually maintained snapshot. Verify correct message scope in the host.

Templates/modules/mvu/format.md defines an `<UpdateVariable>` block after narration, containing a brief Analysis of state changes and a `<JSONPatch>` array; no change uses []. Analysis is a short update justification, not a request for private reasoning. Preserve tags/operation fields; explanatory style conventions are not parser-enforced constraints.

The pinned implementation borrows JSON Pointer syntax but is not a full RFC 6902 implementation:

| Operation | Example | Meaning |
| --- | --- | --- |
| replace | {"op":"replace","path":"/character/mood","value":"relaxed"} | replace an existing field |
| delta | {"op":"delta","path":"/character/trust","value":2} | numerical increment/decrement |
| insert | {"op":"insert","path":"/inventory/brass-key","value":{"quantity":1}} | add to an initialized container |
| remove | {"op":"remove","path":"/inventory/brass-key"} | remove a member |
| move | {"op":"move","from":"/inventory/brass-key","to":"/inventory/old-key"} | move/rename |

These are independent format examples requiring matching Schema/state. Runtime also accepts add as an insert alias and move.path as destination, but new prompts use the table's spelling. Copy/test are unsupported; shape checking does not strictly enumerate every op, so typos can silently do nothing.

Paths start inside stat_data, without /stat_data. Escape ~ as ~0 and / inside field names as ~1. Array append uses -. Commands are handled sequentially rather than atomically: an earlier success may remain after a later failure. Create containers first and keep every intermediate state valid. Delta values are JSON numbers, not strings.

## Card-specific update rules

Use nested YAML with field-level type/check descriptions. Explain when a field changes, when it does not, evidence required, and deliberate bounds. Count only new events from this round. Omit type for strings. Shared fixed-key rules may use descriptive placeholders, but output must use actual paths. Dynamic keys belong at their container with an index-signature type description rather than a few example keys pretending to be exhaustive.

```yaml
variable_update_rules:
  scene:
    location:
      check:
        - Update after actually arriving; planning travel is not arrival.
  character:
    trust:
      type: number
      check:
        - Change only for established help, kept promises, or harm.
        - Do not count an earlier event twice.
```

Do not assign model update duties to derived underscore fields. Read-only path handling belongs to the pinned adapter and is not a full permission system: parent replacement and direct UI/helper writes need separate constraints. Add numerical bounds only when the card requires them.

## Scripts, UI, events

```js
await waitGlobalInitialized('Mvu');
const variables = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() });
const state = variables?.stat_data;
```

`getCurrentMessageId` is for message iframes; ordinary scripts specify a message ID or latest. Render only after checking state, refresh snapshots, and clean up on unmount. Display defaults must not mutate game state.

For independently generated text that has not created/been parsed as a message, parseMessage can parse against old data before replaceMvuData writes the explicit target. Do not apply the same framework-parsed delta twice.

COMMAND_PARSED can adjust commands; VARIABLE_UPDATE_ENDED can compare old/new state for per-round limits. Put current-value normalization/derived formulas in Schema and cross-round logic in events. Registration takes over command execution, so do not assume identical executors before/after registration.

## Evidence and checks

Pins are in module.json and maintenance/references.lock.json. A protocol upgrade requires parser, fixed prompt, adapter, and regex review together. Check initial values, empty patches, numeric deltas, dynamic add/remove, escaping, repeated parse, streaming and complete blocks, and raw-message preservation.

Arbitrary imported Schema is never executed by card check/build. Real-host verification covers new openings, update, regenerate/swipe, editing, and chat switching. Without it, runtimeVerified remains null. Key sources: mvu/src/util.ts isJsonPatch, src/function/update_variables.ts extractJsonPatch, and tavern-resource/util/mvu_zod.ts.
