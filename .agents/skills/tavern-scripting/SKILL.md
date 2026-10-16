---
name: tavern-scripting
description: Maintain Tavern Helper scripts and EJS, including events, buttons, variable scopes, MVU reads/writes, lifecycle, and dynamic worldbook macros; use tavern-frontend for layout.
---

# Helper scripts and EJS

Read the current index/script YAML and [Scripts](../../../docs/SCRIPTS.md). Use [Runtime reference](references/script-runtime.md) and pinned types for signatures/events/troubleshooting rather than loading all upstream material. English/native mappings are in [Architecture](../../../docs/ARCHITECTURE.md#authoring-field-mapping).

## Environment and lifecycle

Script bodies compile to one browser ESM file. Type is script/folder; small data is inline and larger data uses exclusive data_file. Helper variables live in index.helper_variables. Preserve link/IDs. There are no auto-imports: symbols must be resolvable imports or verified host globals; syntax check does not find undefined names.

Embed custom code by default. For [public hosting](../../../docs/REMOTE-ASSETS.md), publish reviewed single-file output at a full commit, declare the exact URL, and use a matching loader. ESM requires JavaScript MIME/CORS; classic getScript/script-src loaders cannot accept static import syntax. Registration uses host z rather than a second bundled Zod.

Use reliable dynamic-load initialization such as $(() => {...}), and pagehide cleanup for DOM/styles/timers/listeners. Keep reload/swipe/edit/chat-switch effects idempotent. Script iframe jQuery may target the host while document is local; choose the intended document explicitly.

## Events, buttons, and scopes

Check event signatures in @types/iframe/event.d.ts. `eventOn` returns a stoppable listener; use custom event names for inter-script communication. Old/new comparisons belong in events; current-value normalization belongs in Schema.

Keep button names stable. AppendInexistent adds missing buttons, while replaceScriptButtons replaces a group. Script settings use {type:'script',script_id:getScriptId()}, separate from game state. Validate scope and missing values before writes.

## MVU

Consumers waitGlobalInitialized('Mvu'); list order is not initialization completion. Ordinary scripts choose message_id/latest; getCurrentMessageId belongs to message iframes. Preserve unrelated variables on replacement. Manually parse only independently generated text not already handled by the framework. Registration subscribes early enough for initialization and is separate from consumer waiting. Direct Helper/Mvu writes do not necessarily traverse every model-patch constraint; validate explicitly where needed. See [Zod skill](../tavern-mvu-zod/SKILL.md).

## EJS

Use EJS for conditional prompt text and Helper scripts for persistent listeners/buttons/writes. Prompt Template controls generate/preparation/render/render_permanent stages; EJS may run repeatedly. Host macros are separate. Treat user text as data rather than executable template fragments, choose correct escaping, and handle stage-specific variables. See [Dynamic worldbooks](../../../docs/WORLDBOOK-TEMPLATING.md).

Variables do not automatically enter keyword scanning. State-driven activation needs a reviewed pre-scan injection path. Check/build parse/audit/package only; test trusted custom logic appropriately and verify events, chat switches, reloads, and teardown in a real host before claiming runtime compatibility.
