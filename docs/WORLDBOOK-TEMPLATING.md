# Worldbook macros, EJS, and variables

Start with static entries/keywords. Use dynamic text only when state needs to change injected fields or rules. See [Worldbooks](WORLDBOOK.md), [Writing](WORLDBOOK-WRITING.md), and [Scripts](SCRIPTS.md).

## Workflow and processors

Initialize state through MVU or an explicit script; read it through a macro/EJS; select fields/rules with a default for absent state; render player text with correct escaping. State-driven activation is a separate injection/preprocessing decision.

Host/Helper macros replace values with strings. EJS executes through Prompt Template at configured generation/render stages. Helper scripts run in iframes at load/event time. These systems are independent. Prefer read-only macros for simple values; conditional shorthand depends on macro engine/version and must be checked against pinned docs.

Host substitutes macros in primary/secondary keywords before matching and in body content during injection. A variable macro in keys changes the keyword being searched; it does not add that value to scan text.

## Variable scopes

| Storage | Read | Write | Scope |
| --- | --- | --- | --- |
| Host local | getvar macro | setvar macro | chat |
| Host global | getglobalvar macro | setglobalvar macro | user storage |
| Helper | getVariables({type}) | replaceVariables / insertOrAssignVariables | global, preset, character, chat, message, script, extension |
| MVU | format_message_variable::stat_data | MVU patches | message |

Character scope requires an open character. Pinned Helper types make message_id optional with latest default; negative IDs count from the end, and out-of-range access throws. A documentation page disagrees about whether it is required: use types as evidence. Equal variable names across scopes are not equivalent.

Helper prompt macros include get_xxx_variable and format_xxx_variable; format produces YAML and is preferred for structured state. Get produces serialized JSON values, including quotes for strings; do not wrap serialized output in more quotes. Missing-path output is not fully documented and needs host verification. Helper macros skip dollar-prefixed keys, useful for data that should not reach the model.

Unwritten Helper storage reads as {}. Test paths explicitly. EJS getvar/getMessageVar accept defaults; without defaults, missing values are undefined. Message selection defaults to a message filter (assistant, searching from the end), not every other API's scope. Use explicit scopes when needed: EJS setvar defaults to message while getvar defaults to cache. Missing information is unknown, not automatically false or an established event.

## Stages, rendering, and decorators

Prompt Template separately controls generation processing and message rendering. An overall disabled extension leaves template text literal. Another setting can hide message templates before generation. RunType values are generate, preparation, render, render_permanent. Render supplies message_id, swipe_id, is_user, is_system, is_last. GENERATE decorators can supply world_info, generateBuffer, generateData in their own contexts.

Rendering normally changes display HTML only. Permanent rendering writes raw chat text when enabled; treat it as a data-changing feature. Use escaped <%= for rendered variables; raw <%- inserts HTML. For generation, serialize values as plain prompt data rather than splicing expanded macros into EJS JavaScript strings. Decorator names are exact; unknown @@ lines are discarded. Escape a literal leading @@ as @@@.

## Content versus activation

| Goal | Method | Boundary |
| --- | --- | --- |
| Change already-injected prose | read-only macro/EJS branch | keyword conditions do not change |
| State-dependent preprocessing | @@preprocessing or [Preprocessing] | happens before normal activation order; body can be processed again |
| Add state to scans | injectPrompts with position:none, should_scan:true | current chat only; handle retries/chat switches/swipes |
| Direct activation/read | activewi / getwi | activewi needs the appropriate GENERATE:BEFORE stage; getwi bypasses normal worldbook logic |

Decorators also include @@activate (constant-like activation) and @@dont_activate (blocks even activewi). Scan text contains selected chat/card/injection/recursive material, not arbitrary variables or visible UI. See [Scope scanning](../.agents/skills/tavern-worldbook/references/location-scan.md).

At_depth requires depth and role; system is the pinned default. Same-depth/same-role entries merge into one text block.

## Independent examples

Use the fixed current-state macro without extra quotation:

```text
<status_current_variable>
{{format_message_variable::stat_data}}
</status_current_variable>
```

For generation-time permission-based fields, assume the card explicitly initializes stat_data.permission; absent state follows the read-only branch:

```text
<% if (getMessageVar('stat_data.permission', { defaults: 'read-only' }) === 'admin') { %>
output_fields: [id, summary, audit_log]
<% } else { %>
output_fields: [id, summary]
<% } %>
```

For a read-only projection, clone first rather than mutating the returned reference:

```text
<%
const view = _.pick(_.cloneDeep(getMessageVar('stat_data', { defaults: {} })), ['id', 'status', 'region']);
%>
Current state:
<%= JSON.stringify(view, null, 2) %>
```

`getvar`/getMessageVar also support clone:true. For rendering:

```text
@@render_after
@@if !is_user && !is_system
Permission: <%= variables.stat_data?.permission ?? 'read-only' %>
```

Is_user/is_system belong to render time. @@if accepts one JavaScript condition line and excludes the entry when false.

## Prerequisites and evidence

Host macros require the host; Helper macros/scripts require Tavern Helper and applicable script permissions; stat_data requires MVU. EJS, decorators, GENERATE/RENDER/INJECT entries, and InitialVariables require Prompt Template and the correct stage settings. InitialVariables additionally needs immediate worldbook loading. Special-entry enabled/disabled handling depends on the extension setting that treats disabled special entries as enabled; @@always_enabled is explicit. Record actual requirements/dependencies.

Pinned evidence: sillytavern/public/scripts/world-info.js (substitution, WorldInfoBuffer, role default); macro variable definitions/macros.js; Helper @types/function/variables.d.ts; Prompt Template docs/reference_cn.md and features_cn.md. Keep upstream paths unchanged. These are source/document conclusions, not host evidence. Verify actual expansion order, preprocessing/reprocessing, escaping, and extra-request processing with prompt previews; runtimeVerified stays null until tested.
