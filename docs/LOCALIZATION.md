# English localization principles

The English edition provides English defaults for the maintained interface, CLI diagnostics/help, generated authoring files, documentation, repository skills, templates, and official examples. The repository is [fadust/TavernCardStudio-Public-EN](https://github.com/fadust/TavernCardStudio-Public-EN); the upstream project and contributors retain their attribution and license.

## Authoring format and compatibility

New authoring files use the canonical English keys documented in [Architecture](ARCHITECTURE.md). Existing projects using legacy Chinese keys and enum values remain loadable. Card JSON continues to use the SillyTavern and Tavern Helper field names expected by their consumers. Local labels must never change stored protocol identifiers or silently drop compatibility fields.

Translate repository-owned sample stories, labels, and prompts consistently across their schemas, initial state, update rules, regex fixtures, and UI readers. Keep historical .card state and original baselines byte-identical during localization; translated source is projected over those preserved snapshots. Verify their existing hashes. Normal tool operations update managed-state hashes only when that managed state actually changes.

## User content and runtime boundaries

Importing a card is a preservation operation. Do not automatically translate an imported character's prose, names, keywords, variable paths, scripts, EJS, or unknown extension data. Authors can request a separate content translation, with all affected producers and consumers updated together.

Preserve exact runtime contracts: `[initvar]`, `[mvu_update]`, `[mvu_plot]`, `[config_override]`, `<UpdateVariable>`, `<JSONPatch>`, `<StatusPlaceHolderImpl/>`, host macros, JSON Pointer syntax, UUIDs, and native card JSON fields. Localized display suffixes are allowed only where the consumer matches the unchanged marker. Keep upstream URLs, pinned commits, versions, SHA-256 values, and license/source records intact. Do not rewrite fetched reference caches as part of localization.

Retain original legal text and third-party attribution. The English license translation is for reference and does not grant additional rights or remove the non-commercial restriction.

## Verification

Run unit tests, official-example checks/builds, and public-release checks. Add focused coverage for English generation and legacy-key loading. For UI changes, use the existing browser checks when the environment permits. Check maintained files for untranslated prose and distinguish intentional compatibility tokens or legal originals from omissions.

Static validation and a successful build establish local structure, syntax, and packaging only. They do not verify model behavior, MVU timing, worldbook activation, or rendering in a real host. Leave `runtimeVerified` unset/`null` unless a real installation was tested, and state any unavailable browser or host checks explicitly in the delivery report.
