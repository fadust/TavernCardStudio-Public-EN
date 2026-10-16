# Frontend resources

Tavern Helper renders message interfaces inside an iframe. Start with one html or vue module, for example `pnpm card new my-card --modules "mvu,vue"`.

The template supplies src/ui/<kind>/index.html, main.js, style.css, and App.vue for Vue. The renderer regex has `build: { type: vue, entry: src/ui/vue/index.html }`, plus display-only replacement and prompt-only marker cleanup. With MVU, App.mvu.vue becomes App.vue and the framework supplies `<StatusPlaceHolderImpl/>` automatically. Without MVU, `<CardStatus/>` is produced through the opening/output contract. A UI does not need its own script entry.

## Builds and transport

Script builds use esbuild to make one browser ESM file. HTML/Vue use Vite plus singlefile and then Base64 wrapping. Build binds to its target, typically a rendering regex replacement_file, but can also bind worldbook/script/text/greeting/legacy-text references.

The packaged replacement is a complete HTML page with doctype, body, and a fenced html code block. Its loader decodes UTF-8 Base64 and uses document.open/write/close. Encoding prevents host regex capture substitution and macro processing from corrupting UI source. It is not encryption. Tavern Helper rendering requires both the code fence and body tags; keep both.

## Resources and runtime

Bundle local code, styles, images, and fonts into the page. Tool-provided Vite configuration does not execute card-local config files. There are no upstream webpack automatic imports, @util aliases, Sass/Tailwind pipeline, or automatic CDN conversions. Explicitly import installed dependencies or use verified host globals. A script importing separate CSS produces multiple files and must use an HTML/Vue build instead.

Dependencies must be declared, pinned, credential-free HTTPS. Local/private paths, unknown protocols, unresolved bundled resources/modules, and undeclared URLs fail validation. Dynamic URLs need manual review. Optional public fixed-version hosting is described in [Remote assets](REMOTE-ASSETS.md); a declared URL is not evidence of reachability or runtime success.

Players need Tavern Helper frontend rendering, enabled card regexes, and the marker in the message. MVU markers/state also require enabled/initialized MVU scripts. Do not ask the model to produce the standard MVU placeholder. Multiple interfaces need distinct producers/consumers or one combined replacement.

## MVU UI state

Wait for waitGlobalInitialized('Mvu') with a UI timeout/failure state. In a message iframe, bind to getCurrentMessageId instead of latest so old panels show their own message state. Read Mvu.getMvuData(options)?.stat_data, validate existence/shape, and display without writing UI defaults back into game state. Snapshots need an event-driven reread or cleaned-up polling. Prevent late async completions after unmount from restarting timers. Preserve the complete variable table and correct message target for intentional user writes; do not reapply already-parsed deltas. Clean timers/listeners/mounts on Vue unmount and pagehide.

## Layout and verification

Design for chat-container width and content-based height. Test narrow widths, overflow, different message heights, and light/dark themes. Viewport height units, forced min-height, nested scrolling, and absolute positioning can fight iframe sizing; use them only deliberately with an actual height source.

Run check/build and inspect the single HTML copy under dist/<name>/ui. Inspection filenames are not stable build identities; the YAML binding is authoritative. Local browser behavior cannot prove host rendering, macro values, MVU timing, or historical-message refresh. Leave runtimeVerified null unless the real host was tested. Detailed APIs/build settings are in [Frontend runtime](../.agents/skills/tavern-frontend/references/iframe-runtime.md).
