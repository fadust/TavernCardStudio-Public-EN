# Tavern Helper scripts and EJS

Helper scripts run JavaScript in browser iframes and can handle events, variables, and UI. EJS is evaluated by Prompt Template to produce text at generation/render stages. Use scripts for persistent runtime behavior and EJS for conditional text.

## Authoring structure

Card scripts export under data.extensions.tavern_helper.scripts; saved Helper variables live alongside them. Each src/scripts/*.yaml contains type (script/folder), stable id via link, name, enabled, info, button, data or data_file, export_with, and a file reference for code. Folders add icon/color/scripts child references. Preserve identity and ordering; network initialization can still be asynchronous.

Inline small data, and use same-name .data.yaml via data_file for data above 2000 characters. These forms are mutually exclusive. Index helper_variables and legacy_helper_variables retain their respective storage locations; additional imported groups use legacy_script_groups with their links. See [Field mapping](ARCHITECTURE.md#authoring-field-mapping).

Build a script with `build: { type: script, entry: src/... }`; esbuild emits one browser ESM file into the bound output content. The script template supplies a message-event example that does not modify chat history. Players need Tavern Helper and enabled card scripts.

## Runtime and lifecycle

Scripts run in unsandboxed browser iframes without Node.js. Script iframe jQuery can point at the parent host document while document remains the iframe document. Create a host mount before mounting Vue there; copied host styles and mounts must be removed on unload. Message UI iframes have their own document/jQuery scope.

Use a reliable dynamic-load entry such as $(() => {...}); DOMContentLoaded may already have fired. Clean timers, subscriptions, DOM, and styles on pagehide. Keep repeated loading/swipe/edit/chat switch idempotent. `eventOn` subscriptions auto-dispose with iframe closure, but explicit stop helps controlled cleanup. Recoverable errors can warn; fatal errors should throw through the project's error handling rather than silently continuing.

## APIs, events, and buttons

Prefer Helper APIs over host internals or generated slash-command strings. API groups include messages, scoped variables, worldbooks, generation, regex formatting, injection, macros, import, shared initialization, and iframe utilities. Consult pinned @types/function and @types/iframe; check ListenerType for event signatures rather than guessing. MESSAGE_RECEIVED includes message kind; CHAT_CHANGED supplies a chat filename, not a stable old-message context. Custom inter-script events should have custom names rather than impersonating host events.

```js
appendInexistentScriptButtons([{ name: 'Restart', visible: true }]);
eventOn(getButtonEvent('Restart'), () => console.info('Restart clicked'));
```

Keep button names stable. AppendInexistent adds missing entries; replaceScriptButtons replaces a whole group. Exported button lists must not grow indefinitely.

Use script-scoped settings with { type: 'script', script_id: getScriptId() }, validate missing/default values, and keep them separate from player world state. Before replacing variables preserve unrelated keys and choose the correct scope/message target.

## MVU

Consumers await waitGlobalInitialized('Mvu') before API calls; list order is insufficient. Message UI uses getCurrentMessageId, ordinary scripts specify an ID/latest. Read Mvu.getMvuData and retain the complete table when writing with replaceMvuData. Parse independently generated/unparsed text only; never double-apply a framework-parsed delta.

Schema registration subscribes early and is separate from consumer waiting; see [Zod](MVU-ZOD.md). Current-value normalization belongs in Schema; old/new comparisons belong in update events. Direct helper/Mvu writes do not automatically traverse all model-patch constraints. `display_data`/`delta_data` may be absent and are deprecated in the Zod flow. UI should provide its own wait timeout because waitGlobalInitialized has none.

## Public scripts

Embed custom scripts by default. For optional hosting, build a reviewed single file, publish it at a complete commit, declare its exact URL/version, then load it through ESM import. ESM needs JavaScript MIME and CORS; classic script/getScript loaders cannot execute static import syntax. Build/check neither upload nor publish. See [Remote assets](REMOTE-ASSETS.md).

## EJS stages and safety

Prompt Template must be installed/enabled. RunType can be generate, preparation, render, or render_permanent, with different available fields. Message_id/swipe_id are render-stage data; do not presume them in generation. Code highlighting can alter template fragments inside code blocks depending on extension settings. EJS can run more than once.

Read variables as data and handle absent values. During rendering use escaped <%= output for variable values; raw <%- can insert HTML and must not interpolate untrusted content. Avoid concatenating macro-expanded values into executable JavaScript/template strings. Check only compiles EJS and records failures as warnings; it never executes templates.

For dynamic worldbook text/activation, scope APIs, decorators, and independent examples, see [Dynamic worldbooks](WORLDBOOK-TEMPLATING.md). Variables in stat_data do not automatically enter keyword scanning; use an explicit pre-scan path if needed. Runtime details and troubleshooting are in [Script runtime](../.agents/skills/tavern-scripting/references/script-runtime.md).
