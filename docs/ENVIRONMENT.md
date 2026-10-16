# Runtime environment and syntax

Before writing content, identify which component processes it and at what stage.

| Component | Responsibility |
| --- | --- |
| SillyTavern | Prompt assembly, character cards, worldbooks, and chat history |
| Tavern Helper | Extension providing scripts, frontend rendering, and host APIs |
| Prompt Template (EJS) | Template evaluation at generation preparation, request building, and message rendering; APIs depend on runType |
| Regex extension | Replacements on user input, model output, prompt text, and display text |
| MVU | Independently loaded pinned script maintaining message variables and parsing update blocks |
| Workspace tools | Local splitting, validation, and packaging; no chat runtime role |

A card can use any subset. Each extra runtime component is an installation requirement for the player; record external resources accurately in `project.json.dependencies`.

## Syntax and evaluation

| Syntax | Location | Evaluation |
| --- | --- | --- |
| Host macros such as `{{user}}`, `{{char}}` | Prompts, worldbooks, messages | Host substitution during assembly/display; char is the card name |
| STScript slash commands | Input, quick replies, presets | Player/script invocation |
| EJS `<% %>`, `<%- %>` | Prompts, card fields, worldbooks, messages | Prompt Template generation or render stage |
| Tavern Helper JavaScript | Browser iframe | Load/event time |
| MVU update blocks | Model output/message text | New-message processing or explicit parsing |
| HTML/Vue frontend | Message iframe | After message rendering |

Macros, EJS, Helper scripts, STScript, and MVU data are separate systems. EJS requires Prompt Template; without it the template may remain literal text. Helper scripts can listen, update state, and mount UI; EJS can run repeatedly at several stages. Prefer host APIs over assembling slash-command strings. MVU update syntax is ordinary text without the MVU parser.

## Load order

Wait for `waitGlobalInitialized('Mvu')` before reading/writing MVU. Script list order is useful for organization but cannot guarantee completion of network imports or asynchronous initialization. Card scripts need Tavern Helper and enabled card scripting; interfaces also need frontend rendering and their regexes enabled.

Generation-time EJS runs before the model request, so required state must already exist. Render-time message context is not necessarily available during generation. See [Scripts](SCRIPTS.md) and [Variables](VARIABLES.md).

## Trigger choices

Always-active entries are scan candidates regardless of keywords but still subject to enabled state, probability, and budget. Keywords activate topical facts; insertion depth controls proximity to messages; probability supports random/optional content. Helper events handle message/chat changes and buttons support manual actions. See [Worldbooks](WORLDBOOK.md) and [Regexes](REGEX.md).

## Versions and evidence

Use restored pinned sources and types under `references/upstream/`, not remembered APIs. Different host/extension versions may differ. `runtimeVerified` records real host/version evidence; null means unverified. Check/build only establish local validation and packaging.

```sh
pnpm refs restore
pnpm refs search <keyword>
pnpm refs check
```

Restore retrieves only locked complete commits/files and verifies SHA-256 without upgrading. Types are under `tavern-helper/@types/`, MVU sources under `mvu/`, and host sources under `sillytavern/`. The generated index is `references/index.json`. `refs update` intentionally rewrites source locks and is a maintenance operation.

Research the current card YAML, then pinned sources, then public documentation. See [Sources](SOURCES.md). If evidence is missing, describe the uncertainty and how to verify it. Offline `pnpm verify` needs no reference cache; `pnpm verify:refs` requires restore first.
