# Script runtime details

Supplement to [Scripting skill](../SKILL.md) and [Scripts](../../../../docs/SCRIPTS.md).

## Native script structure

Data.extensions.tavern_helper contains scripts (ordered tree) and variables. Script/folder fields: type, stable id, name, enabled, content, info, button {enabled, buttons:[{name,visible}]}, data, export_with {data,button}. Folders also have icon/color/scripts. Source is entry YAML plus file; legacy root-extension entries may have legacy-prefixed paths. Preserve generated link and IDs. List order does not prove async initialization completion.

## API groups

| Topic | Functions | Pinned type file under tavern-helper |
| --- | --- | --- |
| messages | getChatMessages, setChatMessages, createChatMessages, deleteChatMessages, rotateChatMessages | @types/function/chat_message.d.ts |
| display | formatAsDisplayedMessage | @types/function/displayed_message.d.ts |
| variables | getVariables, replaceVariables, updateVariablesWith, registerVariableSchema | @types/function/variables.d.ts |
| worldbooks | getWorldbook, replaceWorldbook | @types/function/worldbook.d.ts |
| generation | generate, generateRaw | @types/function/generate.d.ts |
| regex | formatAsTavernRegexedString | @types/function/tavern_regex.d.ts |
| injection | injectPrompts, uninjectPrompts | @types/function/inject.d.ts |
| macros | registerMacroLike, unregisterMacroLike | @types/function/macro_like.d.ts |
| sharing | initializeGlobal, waitGlobalInitialized | @types/function/global.d.ts |
| utility | substitudeMacros, getLastMessageId, errorCatched | @types/function/util.d.ts |
| iframe | getScriptId, getCurrentMessageId, getIframeName, reloadIframe, buttons | @types/iframe/util.d.ts and script.d.ts |
| events | eventOn, eventOnce, eventMakeFirst/eventMakeLast, eventEmit, eventClearAll | @types/iframe/event.d.ts |

Function APIs also export to host window.TavernHelper; iframe APIs only exist in the appropriate iframe. `eventOn` listeners auto-dispose at closure. MESSAGE_RECEIVED includes a message-kind second parameter; CHAT_CHANGED supplies the chat filename. Use ListenerType rather than assuming arguments.

## MVU reads/writes

Await waitGlobalInitialized('Mvu') before consumer APIs. `getMvuData` reads the variable table; replaceMvuData asynchronously replaces it. `parseMessage` returns parsed state or undefined for manual processing. `isDuringExtraAnalysis` indicates the current extra-analysis path; events include VARIABLE_INITIALIZED, VARIABLE_UPDATE_STARTED, COMMAND_PARSED, VARIABLE_UPDATE_ENDED, BEFORE_MESSAGE_UPDATE.

Pinned update_variables.ts writes initialized_lorebooks, stat_data, schema, and optional display_data/delta_data into message variables, then refreshes affected messages as needed. Preserve the complete table and target; use supported MVU writes/events rather than bypassing refresh paths. Display/delta fields are deprecated for Zod and may be absent.

`waitGlobalInitialized` has no timeout; UIs need a timeout/failure state and late-result teardown guards.

## Lifecycle

```js
$(() => {
  const listener = eventOn(tavern_events.MESSAGE_RECEIVED, messageId => { /* handle message */ });
  const panel = $('<div>').appendTo('body');
  window.addEventListener('pagehide', () => {
    listener.stop();
    panel.remove();
  }, { once: true });
});
```

Top-level code can reload. Event listeners may auto-dispose but timers/DOM/copied styles need explicit cleanup. Script jQuery can target the host while document stays iframe-local. Copy intended styles to the host head and remove them later. ReloadIframe invalidates shared initialized interfaces; persistent state needs explicit initialization/teardown design.

## Troubleshooting and evidence

Iframe-only IDs fail in the wrong context. Empty variables usually mean absent state/wrong scope/script ID. Growing button lists need stable names or whole-group replacement. Lingering UI needs paired teardown. Missing MVU events need enabled/load-order/dependency checks and initialization waiting with timeout feedback.

Check only parses syntax/audits resources; build only packages. Execute reviewed trusted tests, never arbitrary imported scripts. Real host behavior/version evidence belongs in runtimeVerified.
