# Frontend runtime and build details

Supplement to [Frontend skill](../SKILL.md) and [Frontend workflow](../../../../docs/FRONTEND.md).

## Generated source and target

The html/vue module creates index.html, main.js, style.css, and App.vue for Vue. A rendering regex owns build {type:html/vue, entry:src/ui/<kind>/index.html}; a second prompt-only rule cleans the marker. MVU supplies `<StatusPlaceHolderImpl/>` automatically. Independent UI uses an opening `<CardStatus/>` and an output-position rule. With mvu+vue, App.mvu.vue replaces App.vue and the unused variant is removed. No separate UI script entry is needed.

Additional interfaces need a complete marker/producer/regex/build chain. Distinct markers or a combined renderer avoid competing consumers.

## Compilation and transport

Script: esbuild bundle=true, format=esm, platform=browser, target=es2022. More than one output file (such as separate CSS) errors; use HTML/Vue for an interface.

HTML/Vue: tool-supplied Vite configFile=false, root at entry directory, publicDir=false, base=./, plus singlefile and inline assets. Exactly one HTML output is required. Card-local Vite configs are not executed.

EmbedHTML wraps the page in a fenced html block and complete doctype/head/body loader. It decodes Base64 with TextDecoder/Uint8Array and document.open/write/close. Base64 protects capture/macro-like characters, not confidentiality. Preserve fences/body tags for Helper rendering.

Build checks first and audits bundled resources afterward. Relative resources/bare imports remaining in output error. Dist scripts/ui copies are inspection artifacts; numbering is not a stable identity. YAML build bindings determine targets.

## Resource checks

Dependencies require nonempty url/purpose/version, credential-free HTTPS, a decoded URL containing the declared version, and no latest/main/master/beta/dev/head. File/drive/UNC/private-network URLs, undeclared links, and unsupported protocols fail. Dynamic/template/computed URLs warn and appear in build-report for manual review. See [Remote assets](../../../../docs/REMOTE-ASSETS.md).

## Runtime APIs and globals

Helper function APIs (events, messages, variables, worldbooks, generation, injection, macros) are in pinned @types/function. Iframe-specific IDs/reload/events are in @types/iframe. `initializeGlobal`/waitGlobalInitialized share interfaces. MVU provides getMvuData/replaceMvuData/parseMessage/events.

Helper may supply $, _, toastr, Vue, VueRouter, YAML, z, PIXI, Markdown helpers, and tailwindcss as runtime globals. They are extension capabilities, not repository auto-imports, and their availability depends on target version/iframe type. Syntax checks cannot detect an absent/misspelled global.

In a script iframe, jQuery may be the parent's jQuery, selecting the host body. In a message UI iframe, document and jQuery target its own page. Confirm the target before attaching DOM/styles.

## Upstream build environment differs

The upstream Helper template uses webpack, auto-imports, externals/CDN conversion, Sass/PostCSS/Tailwind, and additional loaders. This repository uses esbuild/Vite, explicit imports or verified globals, installed packages, and native Vite CSS/raw/url support. Default output is embedded rather than remotely hosted.

Upstream util helpers such as defineMvuDataStore, teleportStyle/createScriptIdIframe, and mountStreamingMessages depend on Pinia/VueUse/klona/raw/HTML-loader support. Adapt them or install justified dependencies before reuse; they are not available here automatically.

## Troubleshooting

Undeclared URL: declare the exact pinned dependency or embed it. Invalid version: make URL/version match a real fixed commit. Bare output import: resolve/bundle the package or use a verified global. Relative output asset: static-import/inline it. Multiple script files: use HTML/Vue. Missing host display: check body/fence shape, enabled regexes, frontend rendering, marker producer, and actual runtime state.

Local build success does not establish host compatibility. Record real-version evidence only after testing.
