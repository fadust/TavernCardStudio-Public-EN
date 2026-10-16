# Public remote assets

Embed custom scripts/interfaces by default. Public fixed-version hosting is optional when several cards share code, updates are frequent, or assets are large. Check/build only validate and package locally; they do not create repositories, upload, push, or publish.

## Build before publishing

Publish a directly loadable single JavaScript ESM file or single HTML page, built through the existing script/html/vue binding or an equivalent reviewed pipeline. A GitHub blob webpage returns HTML navigation rather than executable code. A browser blob: URL exists only in its creating session. Local file/drive/UNC/private-network URLs are invalid. Unbuilt multi-file sources may require dependencies the workspace cannot see remotely.

Declare each exact resource once in project.json.dependencies:

```json
{
  "url": "https://cdn.jsdelivr.net/gh/<owner>/<repo>@<full-commit>/dist/panel.js",
  "purpose": "Card message script at a fixed public commit.",
  "version": "<full-commit>"
}
```

All fields are nonempty strings. URLs must be credential-free HTTPS; embedded user/password or credential query parameters such as token/access_token/authorization/key/secret are rejected. The decoded URL must contain version. Latest/main/master/beta/dev/head are disallowed case-insensitively. Other mutable branches/tags might pass string checks but still violate the fixed-version convention. A query version on a mutable file does not pin bytes. Prefer a complete commit and keep published files available.

## Loader choices

| Loader | Requirements |
| --- | --- |
| ESM import | module syntax, JavaScript MIME, CORS; strict mode, top-level this undefined, same module URL normally evaluated once per context |
| classic script src | classic-script syntax; host MIME/CSP/crossorigin rules |
| jQuery getScript | classic script; static import/export is unsuitable |
| jQuery load | cross-origin HTML text insertion; CORS and actual script/style startup must be verified |
| ajax/get/post/getJSON | literal URLs are audited; variable/relative addresses require manual review |

Do not assume window globals cross iframe boundaries. Use Helper global initialization for inter-script sharing. Protocol-relative links are compared as HTTPS, but author full URLs consistently.

## Audit scope

Source text and assembled card strings are scanned for resource-tag attributes/srcset, CSS url/import, module imports/exports/dynamic import, fetch, load/getScript, Worker, WebSocket, EventSource, resource setAttribute/assignments, and jQuery requests. Bundled output is audited again.

HTTPS resources must match a dependency; data: and anchors are self-contained. Blob warns, local/private/unknown protocols error. Source-relative resources must exist inside src; output-relative resources error. Bare package imports are left to the bundler during source checks and error if still present afterward. Computed/template addresses warn and need review. A static audit cannot discover all transitive dependencies of a remote artifact.

## Hosting requirements

Inspect the actual pinned URL response. JavaScript modules need suitable MIME and CORS; a text/plain raw file is unsuitable for direct module execution. HTML navigation needs HTML MIME and embedding permission. jQuery load reads text into the current iframe rather than navigating, so its behavior differs and may still depend on CSP/script handling. Headers/caches vary by file/platform; do not generalize from a domain name.

```powershell
curl.exe -sS -I "https://cdn.jsdelivr.net/gh/<owner>/<repo>@<full-commit>/dist/panel.js"
```

## HTML loaders

Keep the entire fenced html block and body tags so Tavern Helper recognizes it. Replace owner/repo/commit placeholders and declare the exact URL. A message-iframe loader may run:

```js
$(() => {
  $('body').load('https://cdn.jsdelivr.net/gh/<owner>/<repo>@<full-commit>/dist/panel.html', function (_response, status) {
    if (status === 'error') $(this).text('Interface loading failed. Check the resource URL and network.');
  });
});
```

The target must be reviewed self-contained HTML. This code belongs in a message UI iframe, where body is the interface document; a script iframe can target the host body instead. Load is not full navigation and may treat head elements differently. Adding a selector suffix can strip scripts; verify module startup/styles/cleanup. See [jQuery.load](https://api.jquery.com/load/).

A self-mounting ESM asset can instead use a body containing its mount div and script type=module src; it is not interchangeable with an ordinary HTML artifact. Nested cross-origin iframe navigation creates another context without guaranteed Mvu/getCurrentMessageId/Helper APIs and is also constrained by X-Frame-Options/frame-ancestors. Prefer the Helper-provided context for host-connected panels. Standard MVU marker remains `<StatusPlaceHolderImpl/>`; do not add a model-output requirement.

## Switch an embedded build to hosting

1. Build with the original bindings. Use build-report to locate the actual HTML/JS artifact; inspection numbering is not a stable identity.
2. Copy only reviewed assets into your publishing repository, commit them, obtain the complete commit, and verify the public fixed URL. Do not upload a private workspace. Dist is ignored by default.
3. Retain local source. Replace the consuming regex body with a loader and remove its old build binding, or the next build will overwrite the loader. For scripts, point file and any retained build.entry at the import loader.
4. Update dependencies and all references, then check/build. To rebuild the original asset later, restore its source binding or use a separate asset project before publishing a new commit.

Changing remote content requires a new immutable URL. Update URL/version and every reference together, rebuild the card, and verify the actual new asset in the host. Keeping the old URL keeps old bytes. Deleting files, privatizing repositories, or moving tags can break distributed cards.

## Troubleshooting and limits

Undeclared-resource errors require identical dependency/reference URLs. Unresolved modules need bundling or a declared full URL. Relative output resources must be embedded or publicly pinned. MIME/CORS errors require suitable hosting or embedding. “Cannot use import statement outside a module” means a classic loader received ESM. A 404 usually means path/case/commit mismatch. Unchanged behavior after an upgrade may mean the URL still pins the old commit.

Private assets must be embedded, not exposed through credentials or expiring signed URLs. Check/build do not request network assets and cannot verify reachability, MIME, CORS, CSP, or host iframe behavior. Source of truth: tools/lib/resources.mjs validateDependencies/auditResources. Report real-host verification separately.
