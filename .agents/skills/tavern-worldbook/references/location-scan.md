# Scope keywords and state-driven scanning

Load only when the card needs multi-level scope relationships or reliable activation from current variable state. Ordinary cards can use chat keywords. Geography is an example; the same design can cover organizations, phases, relationships, peoples, technologies, religions, or timelines.

## Three distinct paths

Direct keyword matching independently activates parent/child entries against the same scan window, without recursion. Recursion uses one injected body's text to activate another and depends on global settings, layers, budgets, and cycle handling. Scan injection supplies state before scanning. They can combine, but a parent being present never guarantees its child.

| Entry | Primary keys | Secondary keys (any) | Relative block order |
| --- | --- | --- | --- |
| Mist Ridge overview | Mist Ridge, Gray Ferry, Mist Ridge Town | none | first |
| Mist Ridge geography | geography, climate, trade route, Gray Ferry, Mist Ridge Town | Mist Ridge | after overview |
| Gray Ferry detail | Gray Ferry | Mist Ridge | after topic |

With “Mist Ridge / Gray Ferry,” all three can match. With only Gray Ferry, only the unrestricted overview matches; with only Mist Ridge, children do not automatically load. A constant overview mentioning the parent does not supply the missing scan term when recursion is disabled. Let arrange choose actual numbering instead of fixing arbitrary values here.

Secondary any is AND ANY after a primary match. All terms come from one scan window and can occur in different messages, so it does not express exclusive current state. Old historical scopes can coexist with new topics. Test two areas/factions/topics at once. Strict current-state selection requires deliberate scan-depth/scope/activation design.

Keep bodies self-contained. Cross-entry YAML/XML wrappers require matching triggers, positions, order, indentation, and readable budget truncation. Directory trees have no runtime tree semantics.

## Scan-only Helper injection

Read actual initialized state, then inject the current value and necessary parent scope/aliases before this request's worldbook scan. UI display and variable-list macros are not guarantees of scan availability.

Pinned Helper @types/function/inject.d.ts provides position:none (not sent to the model), should_scan:true, and once:

```js
const stateText = 'Mist Ridge / Gray Ferry'; // Read the actual initialized state here.
const { uninject } = injectPrompts([{
  id: 'card-state-scan',
  position: 'none',
  depth: 0,
  role: 'system',
  content: stateText,
  should_scan: true,
}], { once: true });
// Call uninject on cancellation/teardown or when no longer needed.
```

This is an integration fragment, not a complete event lifecycle. MVU readers first wait for Mvu and read the correct current-chat message stat_data. Do not hardcode another card's paths or invent missing child scopes. Use an explicit state index for full paths/aliases when needed.

## Required integration checks

Injection is current-chat scoped. Pinned docs mention CHAT_CHANGED and GENERATION_AFTER_COMMANDS, but verify the selected event happens before the target request's scan and awaits asynchronous state reads. Cancel old-chat async results and clean prior injections after move/regenerate/swipe/chat switch. Main/extra requests may use distinct generation routes; one once injection need not cover both, especially concurrently.

Scan injection does not remove old history keywords or bypass budgets/other conditions. Do not permanently pollute chat prose with mechanical location strings just to activate entries. Clean failure/cancel paths too.

Inspect actual activated entries and final prompts for initial state, cross-region moves, old history, unknown location, two topics, regeneration, chat switches, and extra requests. Without host evidence, do not claim reliable state-driven activation.
