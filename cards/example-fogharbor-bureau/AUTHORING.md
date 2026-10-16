# Authoring notes

This file is for maintainers; it is not packaged or sent to the model.

Fogharbor Bureau is an ensemble investigation example. Its card name is an institution, not an individual. The player is a newly registered investigator partnered with recorder Dahlia Crane. Cases proceed through intake, field inspection, evidence verification, and findings submitted to City Hall.

The example connects worldbook entries, regex, Tavern Helper scripts, MVU state, and a Vue panel. It includes a first message and three alternate greetings: a lighthouse outage, fish market accounts, and a drydock schedule discrepancy. Each alternate greeting has an `<initvar>` block overriding the worldbook's initial values; two regex rules hide that block from display and prompts.

## Worldbook layout

World setting and geography overview are constant entries before the character definition; specific locations, events, and harbor slang activate by keyword there. Dahlia's profile and the character overview are constant entries after the definition; other people activate by keyword. Bureau procedures use system depth 1. Both recursion switches are disabled for every entry. Related facts belong together or activate through explicit keyword combinations.

Overviews give scope, roles, and aliases. Individual entries provide details. Narrative perspective, voice, and pace belong to the Tavern preset.

The missing-person event combines a primary keyword (missing or report) with any scope keyword (fog season or harbor). The lighthouse event uses a `/pattern/i` keyword. Keywords match the host's scan text: a location held only in variables does not activate a location entry. This example does not inject variable locations into scan text.

## State and consumers

`src/schema.ts` is the source schema. `src/variables/schema.json` is its input projection for readers and editors, not runtime validation. Keep schema fields/defaults, the initial-variable entry and greeting overrides, update rules, and panel read paths consistent. The variable-list entry is the fixed MVU macro template.

State contains `fogharbor` (time, weather, fog density), `bureau` (case, clues, people, evidence), and `investigator` (energy, clearance, renown). `bureau._progress` is derived from clue statuses on every schema parse; the model, panel, and scripts must not write it.

Clue statuses are Pending, Verified, RuledOut. Stances are Partner, Cooperative, Neutral, Evasive, Hostile, Unknown. Case phases are Standby, Intake, Inspection, Verification, Closed. Clearance is Trainee, Officer, Special. Keep these values aligned with procedures, rules, schema, CSS, and interface reads.

## Rendering and lifecycle

MVU appends `<StatusPlaceHolderImpl/>` after processing assistant messages. The card does not ask the model to output it. The display regex replaces it with the bundled Vue panel; a prompt-only regex removes it from prompts without editing stored messages. Whether the opening message gets a panel depends on MVU processing that message.

The panel under `src/ui/vue/` reads the current message's `stat_data`. Missing fields display “Not recorded” and empty lists get useful messages; the panel never writes defaults back.

`src/scripts/001-fogharbor-bureau-buttons.js` adds View current case and Fog report buttons. They read MVU and display summaries. Registration occurs in `$()`; `pagehide` stops listeners. Stable names and a registration guard prevent duplicates. Reads wait for MVU with a timeout.

## Verification and extensions

Static checks and local builds do not establish real host compatibility. `runtimeVerified` remains `null`. Host verification must cover actual injection order and activation, streamed folding, placeholder timing/rendering, MVU initialization/regeneration, and button events.

Prompt Template/EJS is not enabled. To add it, document the dependency and distinguish generation/render phases with `runType`. To make buttons update state, use `Mvu.replaceMvuData(data, { type: 'message', message_id })` or update events while preserving the complete variable table; direct variable writes bypass the registrar's completion and validation.
