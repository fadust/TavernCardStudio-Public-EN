# Authoring brief: Fogharbor Bureau

## Experience

The player is a newly registered investigator with Trainee clearance, partnered with recorder Dahlia Crane. Accept cases, inspect scenes, register leads, verify physical evidence, and submit findings. The card's name denotes the institution. Narrative voice and viewpoint are supplied by the Tavern preset. Exclude supernatural explanations, cultivation terminology, and dialogue written for the player.

The first message starts case WG-07, Missing dockworker. Alternate openings cover a lighthouse outage, fish market accounts, and a drydock repair schedule.

## World and characters

Moran Weiss directs the Bureau; Otto Lamb is the coroner; Heidi is a dock broker; Perry Dawn keeps the lighthouse. Constant entries establish independent institutions, fog season and tides, geography, character roles, and Bureau procedures. Keyword entries supply places, supporting characters, incidents, and slang. A location in variables alone does not trigger worldbook scanning.

Cases track identifiers, names, phases, and clue/people/evidence records. Fogharbor state tracks time, weather, and fog density. Investigator state tracks energy, clearance, and renown. `bureau._progress` is read-only and derived by the schema.

## Modules and layout

- Worldbook: constant world/geography before the character, constant partner/character overview after it; details use keywords. Procedures are system depth 1. Recursion is disabled.
- MVU and Zod: persistent state with the source schema in `src/schema.ts`.
- Vue: bundled panel reads current-message state and uses MVU's automatically appended `<StatusPlaceHolderImpl/>`.
- Regex: fold update blocks, remove them from prompts, hide greeting initial values, and render/clean the panel placeholder.
- Scripts: two read-only buttons for case and fog summaries.
- Dependencies: public MVU and schema registrar imports pinned by commit in `project.json`.

## Delivery

Build `example-fogharbor-bureau` as JSON without an avatar. Require successful `pnpm card check example-fogharbor-bureau` and `pnpm card build example-fogharbor-bureau`; output goes to `dist/example-fogharbor-bureau/`.

No real Tavern verification is recorded. Injection, activation, placeholder timing, rendering, and variable updates need a host test; keep `runtimeVerified` as `null` until evidence exists.
