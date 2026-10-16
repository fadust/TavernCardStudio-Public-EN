# MVU update modes and stage markers

This guide describes the pinned MVU implementation. Choose the intended experience first. Project modules records template choices, and entry markers filter stages; neither changes the player's MVU mode setting automatically.

| Mode | Narration and state | Authoring requirements |
| --- | --- | --- |
| Main output | main response contains narration and update block | state, rules, and text patch contract reach the main model together |
| Extra model analysis | main response narrates; another request computes state from new events and prior state | divide plot/update content and provide the extra request with facts, state, rules, and selected response contract |

The extra request can reuse the current connection or a player-selected model; a second provider is not required. The player normally chooses in the MVU panel. Cards must not carry credentials, and workspace tools do not change connections or enable calls. Account for latency, retries, failures, and refresh timing.

## Runtime prerequisites

The pinned version requires the current character's readable primary worldbook with at least one title containing `[mvu_update]` or `[mvu_plot]` markers. Markers only in additional/global books are insufficient. Multiple NPCs inside one card are different from a host group chat. Do not assume extra analysis works without a valid primary character worldbook, including some group-chat cases. State the binding/mode requirements in creator notes or provide a main-output path, and verify actual binding after import.

Text responses use the fixed UpdateVariable/JSONPatch contract. Tool calling requires pinned implementation/provider review; do not request both forms and apply the same update twice.

## Stage filtering in extra mode

| Name marker | Main request | Extra request | Typical content |
| --- | --- | --- | --- |
| none | eligible | eligible | shared facts, variable list, common constraints |
| only `[mvu_update]` | removed | eligible | update rules/format/material |
| only `[mvu_plot]` | eligible | removed | plot-only mechanics |
| both | neither stage filter removes it | neither stage filter removes it | deliberate shared special case |

Eligible does not bypass enabled state, activation, budget, or other filtering. In main-output mode this stage filter returns immediately, so both marker types can reach the main model. `[initvar]` is an initialization marker, not an extra-API marker.

## Optional character configuration override

Only when the author explicitly needs to override the player's mode, add one **disabled** entry whose name is exactly `[config_override]`, ignoring case/outer whitespace. No category prefix or suffix is allowed. Its body must be valid JSON. Upstream MVU configuration keys/values are runtime API tokens and remain in their original spelling:

```json
{
  "更新方式": "额外模型解析",
  "额外模型解析配置": { "启用自动请求": true }
}
```

This sets extra analysis and automatic requests, overriding the player's choice. Explain it in usage instructions. Connections/credentials remain player-managed. Omitted properties inherit global settings; an empty string is not inheritance. Keep one valid override and synchronize panel-edited changes back into local source before distribution.

Unlike substring stage markers, `[config_override]` uses exact-name matching and reads disabled entries. Supported fields/precedence come from pinned src/function/character_override/schema.ts, index.ts, and src/store.ts. Other controls include primary/additional-book support and title allow/denylists. `[mvu_update]` entries bypass title allow/deny filtering but are not unconditional injection. Concurrent/nonblocking requests have request-specific scan ownership; do not use one global boolean to guess the stage.

## Authoring and switching

Keep the same Schema, initialization, variable list, and field rules. Main mode sends narration/update contract together. Extra mode avoids duplicate main-output patches and receives actual current input/reply plus old state. Add special materials only when the selected request chain lacks them, not to duplicate chat history from another card.

Switch in the MVU panel and check overrides, auto/manual trigger, and text/tool response style. Inspect both actual prompts/results for complete facts, duplicate deltas, and correct old-state display after failure. Test retry, regenerate, swipe, and chat switch.

Variables such as current location are not automatically worldbook scan material. State visible in a prompt may still arrive after scanning; use a reviewed pre-scan injection path where needed. See [Worldbooks](WORLDBOOK.md).

## Standard status placeholder

When stat_data exists, MVU's update path appends a missing `<StatusPlaceHolderImpl/>` to non-user messages without repeatedly adding it. User messages, uninitialized state, and disabled/failed scripts are not guaranteed to contain it. Default display regexes consume it; no model-output instruction or manual opening marker is required.

MVU without UI only hides/removes the marker in display/prompt paths, retaining raw messages. Independent non-MVU interfaces retain `<CardStatus/>` with their own producer. Existing custom chains do not auto-migrate; synchronize openings, rules, regexes, and producers to avoid duplicate panels.

## Implementation evidence

Pins: maintenance/references.lock.json, mvu. Sources: src/store.ts; src/function/request/filter_entries.ts; worldinfo_scan.ts/worldinfo_request.ts for request ownership; filter_prompts.ts; update_variables.ts handleVariablesInMessage; function_call.ts; is_extra_model_supported.ts; character_override/. These are source-level conclusions, not real-host tests. Leave runtimeVerified null without host evidence.
