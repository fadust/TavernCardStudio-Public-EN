---
name: tavern-frontend
description: Build card-embedded HTML/Vue message interfaces, connect regex markers and MVU state, and manage single-file builds, iframe layout, and lifecycle.
---

# Message interfaces

Read the current index/configuration and [Frontend](../../../docs/FRONTEND.md). Load [Runtime details](references/iframe-runtime.md) for build/dependency/API questions and [Variables](../../../docs/VARIABLES.md) only for MVU.

## Display chain

MVU automatically supplies `<StatusPlaceHolderImpl/>`; independent non-MVU UI uses a deliberate opening/output `<CardStatus/>` producer. A display-only regex replaces the marker with fenced HTML, Helper creates the iframe, a loader decodes the complete embedded Base64 page, and a separate prompt-only rule removes history markers without rewriting raw messages.

Bind build to the rendering regex (or supported explicit target) using type/entry. Do not paste built pages into raw chat text. Multiple panels need distinct producers/consumers or a combined replacement; avoid two renderers fighting for one marker.

## Repository environment

HTML/Vue use Vite + singlefile, scripts esbuild. There are no upstream webpack auto-imports, @util aliases, or automatic CDN transforms. Import resolvable local packages explicitly or use verified host globals. Host $, _, z are not repository auto-imports. Schema registration uses the shared host z. Upstream defineMvuDataStore depends on additional packages and is not available automatically.

Embed custom UI by default. Optional [pinned hosting](../../../docs/REMOTE-ASSETS.md) publishes a built single page, with loader and declared dependencies. GitHub blob pages and Vue/TS sources are not executable runtime assets. The tool supplies Vite config rather than executing card-local configuration.

## MVU readers

Wait for Mvu with timeout/failure UI. Bind to getCurrentMessageId in message iframes rather than latest. Validate stat_data before displaying; never write fallback UI values into game state. State is a snapshot: reread on appropriate events or use cleaned-up polling. Schema fields are actual values; do not unwrap every array as a legacy value/description pair.

Intentional writes preserve the complete variable table and explicit target; never double-apply parsed patches. Clean intervals, listeners, and mounts on Vue unmount/pagehide, and prevent late async completion from restarting work after teardown.

## Verify

Fit the actual container width with no horizontal overflow. Content determines height; use vh/absolute positioning/nested scroll only deliberately. Match the user's visual goal rather than imposing a theme. Check/build should produce one self-contained page. Local interaction tests do not prove host rendering, macros, MVU timing, or historical refresh; leave runtimeVerified null without host evidence.
