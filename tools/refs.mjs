// Search, verify, restore, and update pinned workspace references (references/).
// Configuration: maintenance/reference-sources.json; lockfile: maintenance/references.lock.json.
// Output: each command prints a JSON object with ok, command, and result fields.
// Scope: read and write only references/, maintenance/references.lock.json, and references/index.json.
// Treat downloads as reference text: read bytes and hashes; never import or execute them.
// refs restore only reads the lockfile: fetch pinned commits and files without changing its bytes or timestamps.
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, jsonText, readJSON, sha256 as hash } from './lib/files.mjs';

export { ROOT };
export const CONFIG_FILE = 'maintenance/reference-sources.json';
export const LOCK_FILE = 'maintenance/references.lock.json';
export const INDEX_FILE = 'references/index.json';
export const UPSTREAM_DIR = 'references/upstream';
const MAX_FILES = 180;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const CONCURRENCY = 6;
const FETCH_TIMEOUT = 30000;
const USER_AGENT = 'tavern-card-studio-refs';

export const sha256 = hash;
export const toPosix = value => String(value).replaceAll('\\', '/');

export function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.includes('\0')) throw new Error('Use a project-relative path: ' + relative);
  if (relative.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) throw new Error('Path escapes the workspace: ' + relative);
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw new Error('Path escapes the workspace: ' + relative);
  return resolved;
}

export function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const output = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
      else if (entry.isFile()) output.push(relative);
    }
  };
  walk(dir, '');
  return output.sort();
}

const normalize = value => toPosix(String(value)).replace(/\/+$/, '');
const isUnder = (prefix, file) => { const p = normalize(prefix); return file === p || file.startsWith(p + '/'); };
/** include/exclude accepts 're:pattern', literal substrings, or RegExp (for tests). */
export function toMatcher(pattern, id) {
  if (pattern instanceof RegExp) return value => pattern.test(value);
  if (typeof pattern !== 'string' || !pattern) throw new Error(id + ': include/exclude must be a nonempty string or regular expression.');
  if (pattern.startsWith('re:')) {
    let regexp;
    try { regexp = new RegExp(pattern.slice(3), 'i'); }
    catch (error) { throw new Error(id + ': Invalid include/exclude regular expression ' + JSON.stringify(pattern) + ' (' + error.message + ')'); }
    return value => regexp.test(value);
  }
  return value => value.includes(pattern);
}
const matchAny = (patterns, value) => patterns.some(pattern => pattern(value));

/** Validate critical paths as safe workspace-relative paths. */
function assertRelative(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(label + ': A nonempty relative path is required.');
  if (path.isAbsolute(value) || value.includes('\\') || value.includes('\0')) throw new Error(label + ': Use a project-relative path: ' + value);
  if (value.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) throw new Error('Path escapes the workspace: ' + value);
  return value;
}

/** Resolve workspace-relative reference paths inside the staging directory. */
const stagedPath = local => {
  const prefix = UPSTREAM_DIR + '/';
  return local.startsWith(prefix) ? local.slice(prefix.length) : local;
};

/** Compile maintenance/reference-sources.json. files accepts repository paths, directory prefixes, or 'upstream-prefix:-> local-prefix' mappings. */
export function compileSources(config) {
  if (config?.schemaVersion !== 1) throw new Error('reference-sources.json: schemaVersion must be 1.');
  if (!Array.isArray(config.sources) || !config.sources.length) throw new Error('reference-sources.json: sources must be a nonempty array.');
  const seen = new Set();
  return config.sources.map(raw => {
    const source = raw ?? {};
    const { id, repository, ref } = source;
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('Invalid source id: ' + JSON.stringify(id));
    if (seen.has(id)) throw new Error('Duplicate source id: ' + id);
    seen.add(id);
    if (typeof repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(id + ': repository must be owner/name.');
    if (typeof ref !== 'string' || !ref.trim()) throw new Error(id + ': ref must not be empty.');
    if (source.pinCommit !== undefined && !/^[a-f0-9]{40}$/.test(source.pinCommit)) throw new Error(id + ': pinCommit must be a full 40-character commit hash.');
    const dest = source.dest === undefined ? id : normalize(source.dest);
    assertRelative(dest, id + ' dest');
    if (!Array.isArray(source.files) || !source.files.length) throw new Error(id + ': files must be a nonempty array.');
    const file = source.files.map(raw => {
      const text = String(raw); const at = text.indexOf(':->');
      if (at === -1) { const from = normalize(text); if (!from) throw new Error(id + ': Empty repository path.'); return { from, to: null }; }
      const from = normalize(text.slice(0, at).trim()); const to = normalize(text.slice(at + 3).trim());
      if (!from || !to) throw new Error(id + ': Invalid file mapping: ' + text);
      inside(UPSTREAM_DIR, from);
      assertRelative(to, id + ' file mapping destination');
      return { from, to };
    });
    for (const item of file) assertRelative(item.to ?? UPSTREAM_DIR + '/' + dest + '/' + item.from, id + ' reference path');
    return {
      id, repository, ref,
      pinCommit: source.pinCommit,
      note: typeof source.note === 'string' ? source.note : undefined,
      license: source.license === undefined ? null : source.license,
      dest, file,
      include: (source.include ?? []).map(pattern => toMatcher(pattern, id)),
      exclude: (source.exclude ?? []).map(pattern => toMatcher(pattern, id)),
      includePatterns: (source.include ?? []).map(String),
      excludePatterns: (source.exclude ?? []).map(String),
      required: (source.required ?? []).map(normalize),
      maxFiles: source.maxFiles ?? MAX_FILES,
      maxFileBytes: source.maxFileBytes ?? MAX_FILE_BYTES,
      maxTotalBytes: source.maxTotalBytes ?? MAX_TOTAL_BYTES,
    };
  });
}

export async function loadConfig(root = ROOT) { return compileSources(await readJSON(path.join(root, CONFIG_FILE))); }

export async function loadLock(root = ROOT) {
  const file = path.join(root, LOCK_FILE);
  if (!fs.existsSync(file)) return { schemaVersion: 1, sources: {} };
  const lock = await readJSON(file);
  if (lock?.schemaVersion !== 1 || !lock.sources || typeof lock.sources !== 'object') throw new Error('references.lock.json: Unsupported structure or version.');
  return lock;
}

/** Upstream file destination relative to the workspace root. */
export function targetPath(source, upstreamPath) {
  const file = toPosix(upstreamPath);
  for (const item of source.file) {
    if (item.to === null) { if (isUnder(item.from, file)) return UPSTREAM_DIR + '/' + source.dest + '/' + file; continue; }
    if (isUnder(item.from, file)) {
      const tail = file.slice(item.from.length).replace(/^\/+/, '');
      return tail ? item.to + '/' + tail : item.to;
    }
  }
  return UPSTREAM_DIR + '/' + source.dest + '/' + file;
}

/** Select files required by a source from the GitHub tree. */
export function selectFiles(source, tree) {
  if (tree?.truncated) throw new Error(source.id + ': The upstream tree is truncated; cannot safely select files.');
  const candidates = (tree?.tree ?? []).filter(entry => entry.type === 'blob').filter(entry => {
    const file = toPosix(entry.path);
    if (!source.file.some(item => isUnder(item.from, file))) return false;
    if (matchAny(source.exclude, file)) return false;
    return !source.include.length || matchAny(source.include, file);
  });
  const seen = new Set();
  const selected = candidates.sort((a, b) => (a.path < b.path ? -1 : 1)).map(entry => ({ path: toPosix(entry.path), local: targetPath(source, entry.path) }));
  for (const item of selected) {
    if (seen.has(item.path)) throw new Error(source.id + ': Duplicate upstream path: ' + item.path);
    seen.add(item.path); inside(UPSTREAM_DIR, item.local);
  }
  for (const required of source.required) if (!selected.some(item => item.path === required)) throw new Error(source.id + ': Required upstream file was not selected: ' + required);
  if (!selected.length) throw new Error(source.id + ': No upstream files selected.');
  if (selected.length > source.maxFiles) throw new Error(source.id + ': Too many selected files (' + selected.length + ' > ' + source.maxFiles + ').');
  const locals = new Set();
  for (const item of selected) {
    if (locals.has(item.local)) throw new Error(source.id + ': Two upstream files map to the same path: ' + item.local);
    locals.add(item.local);
  }
  return selected;
}

/** Offline seed: infer selected files from existing local repository paths. */
export function offlineSelection(source, available) {
  const selected = [...available].map(toPosix).sort().filter(file => {
    if (!source.file.some(item => isUnder(item.from, file))) return false;
    if (matchAny(source.exclude, file)) return false;
    return !source.include.length || matchAny(source.include, file);
  }).map(file => ({ path: file, local: targetPath(source, file) }));
  for (const required of source.required) if (!selected.some(item => item.path === required)) throw new Error(source.id + ': Offline references lack a required file: ' + required);
  if (!selected.length) throw new Error(source.id + ': Offline references matched no files.');
  return selected;
}

export function licenseUpstreamPath(source, selected) {
  if (typeof source.license === 'string') return source.license;
  const found = selected.filter(item => /(^|\/)(LICENSE|LICENCE|COPYING)(\.|$)/i.test(item.path));
  return found.length ? found[0].path : null;
}

export function guessSpdx(bytes) {
  const head = bytes.toString('utf8', 0, 6000);
  if (/Aladdin Free Public License/i.test(head)) return 'AFPL';
  // Untitled MIT-style text starts with copyright; retain the full grant and disclaimer.
  if (/Permission is hereby granted, free of charge/i.test(head) && /THE SOFTWARE IS PROVIDED "AS IS"/i.test(head)) return 'MIT';
  if (/Apache License\s*\n?\s*Version 2\.0/i.test(head)) return 'Apache-2.0';
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(head)) return 'AGPL-3.0';
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(head)) return 'LGPL-3.0';
  if (/GNU GENERAL PUBLIC LICENSE/i.test(head)) return 'GPL-3.0';
  if (/BSD 3-Clause/i.test(head)) return 'BSD-3-Clause';
  if (/BSD 2-Clause/i.test(head)) return 'BSD-2-Clause';
  if (/ISC License/i.test(head)) return 'ISC';
  return 'NOASSERTION';
}

export function githubHeaders(token = process.env.GITHUB_TOKEN) {
  const headers = { 'user-agent': USER_AGENT, accept: 'application/vnd.github+json' };
  if (token) headers.authorization = 'Bearer ' + token;
  return headers;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Default fetch: GitHub API for JSON; raw.githubusercontent for binary and text. */
export async function request(url, { json = false, token = process.env.GITHUB_TOKEN, attempts = 3 } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const headers = json ? githubHeaders(token) : { 'user-agent': USER_AGENT, ...(token ? { authorization: 'Bearer ' + token } : {}) };
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
      if (!response.ok) {
        const error = new Error('Upstream request failed, HTTP ' + response.status + ': ' + url);
        if (!(response.status === 429 || response.status >= 500) || attempt === attempts) throw error;
        last = error;
      } else {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (json) return JSON.parse(bytes.toString('utf8'));
        // Some upstream template .ts/.css files are intentionally empty.
        // assertPayload applies source/path-aware validation after downloading.
        return bytes;
      }
    } catch (error) { last = error; if (attempt === attempts) throw error; }
    await wait(400 * attempt);
  }
  throw last;
}

export function rawUrl(source, commit, upstreamPath) {
  return 'https://raw.githubusercontent.com/' + source.repository + '/' + commit + '/' + upstreamPath.split('/').map(encodeURIComponent).join('/');
}
export function treeUrl(source, commit) {
  return 'https://api.github.com/repos/' + source.repository + '/git/trees/' + commit + '?recursive=1';
}
export async function resolveCommit(source, fetcher = request) {
  if (source.pinCommit) return source.pinCommit;
  const url = 'https://api.github.com/repos/' + source.repository + '/commits/' + encodeURIComponent(source.ref);
  const head = await fetcher(url, { json: true });
  if (!/^[a-f0-9]{40}$/.test(head?.sha ?? '')) throw new Error(source.id + ': Did not receive a full commit hash.');
  return head.sha;
}

export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length); let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, async () => {
    for (;;) { const index = cursor++; if (index >= items.length) return; results[index] = await worker(items[index]); }
  }));
  return results;
}

/** Validate downloads: nonempty, bounded size, no HTML or binary, and parseable JSON. */
export function assertPayload(source, upstreamPath, bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error(source.id + ': Expected bytes: ' + upstreamPath);
  // Structured files must be nonempty; source text may be a valid empty placeholder such as .ts/.css.
  if (!bytes.length && !/\.(md|txt|js|mjs|cjs|ts|tsx|vue|html|css)$/i.test(upstreamPath)) throw new Error(source.id + ': Upstream file is empty: ' + upstreamPath);
  if (bytes.length > source.maxFileBytes) throw new Error(source.id + ': Upstream file is too large: ' + upstreamPath);
  const head = bytes.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) throw new Error(source.id + ': Upstream returned an HTML page: ' + upstreamPath);
  if (bytes.includes(0) && /\.(md|txt|js|mjs|cjs|ts|tsx|json|yaml|yml)$/i.test(upstreamPath)) throw new Error(source.id + ': Upstream file appears to be binary: ' + upstreamPath);
  if (/\.json$/i.test(upstreamPath)) {
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
    if (!/^\s*[[{"\dntf-]/.test(text)) throw new Error(source.id + ': Unexpected upstream JSON format: ' + upstreamPath);
    try { JSON.parse(text); } catch { throw new Error(source.id + ': Cannot parse upstream JSON: ' + upstreamPath); }
  }
  return bytes;
}

function symbolsOf(file, bytes) {
  if (!/\.(md|txt|js|mjs|cjs|ts|tsx|json|yaml|yml|vue|html)$/i.test(file)) return [];
  const text = bytes.toString('utf8'); const found = new Set();
  const patterns = [
    /^#{1,4}\s+(.+)$/gm,
    /^\s*(?:export\s+)?declare\s+(?:function|const|class|interface|type)\s+([\w$]+)/gm,
    /^\s*export\s+(?:async\s+)?function\s+([\w$]+)/gm,
    /^\s*export\s+(?:const|class|interface|type)\s+([\w$]+)/gm,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
    const value = (match[1] ?? '').trim();
    if (value && value.length <= 80) found.add(value);
    if (found.size >= 40) break;
  }
  return [...found].slice(0, 40);
}

/** Generate the index manifest from the lockfile only for structural comparison during publishing. */
function manifestIndex(lock, sources) {
  const known = new Set(sources.map(source => source.id)); const files = [];
  for (const [id, entry] of Object.entries(lock.sources ?? {})) {
    if (!known.has(id)) continue;
    for (const [upstream, record] of Object.entries(entry.files ?? {})) {
      files.push({ source: id, repository: entry.repository, commit: entry.commit, upstreamPath: upstream, local: record.local, sha256: record.sha256, bytes: record.bytes });
    }
  }
  files.sort((a, b) => (a.local < b.local ? -1 : a.local > b.local ? 1 : 0));
  const view = Object.entries(lock.sources ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, entry]) => ({
    id, repository: entry.repository, ref: entry.ref, commit: entry.commit, fetchedAt: entry.fetchedAt,
    license: entry.license ?? null, licenseFile: entry.licenseFile ?? null, note: entry.note ?? null, files: Object.keys(entry.files ?? {}).length,
  }));
  return { schemaVersion: 1, sources: view, files };
}

/** Generate references/index.json from the lockfile and disk content. */
export function buildIndex(root, lock, sources) {
  const known = new Set(sources.map(source => source.id)); const files = [];
  for (const [id, entry] of Object.entries(lock.sources ?? {})) {
    if (!known.has(id)) continue;
    for (const [upstream, record] of Object.entries(entry.files ?? {})) {
      // Use reference paths for a workspace root, or staging paths with direct-copy fallback for a staging root.
      const live = path.join(root, record.local);
      const staged = path.join(root, stagedPath(record.local));
      const full = fs.existsSync(live) ? live : fs.existsSync(staged) ? staged : null;
      if (!full) continue;
      const bytes = fs.readFileSync(full);
      files.push({ source: id, repository: entry.repository, commit: entry.commit, upstreamPath: upstream, local: record.local, sha256: record.sha256, bytes: bytes.length, symbols: symbolsOf(record.local, bytes) });
    }
  }
  files.sort((a, b) => (a.local < b.local ? -1 : a.local > b.local ? 1 : 0));
  const view = Object.entries(lock.sources ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, entry]) => ({
    id, repository: entry.repository, ref: entry.ref, commit: entry.commit, fetchedAt: entry.fetchedAt,
    license: entry.license ?? null, licenseFile: entry.licenseFile ?? null, note: entry.note ?? null, files: Object.keys(entry.files ?? {}).length,
  }));
  return { schemaVersion: 1, sources: view, files };
}

/** The index must match the lockfile regardless of whether files are staged or live. */
export function indexMatchesManifest(root, lock, sources, liveRoot = root) {
  const file = path.join(liveRoot, INDEX_FILE);
  if (!fs.existsSync(file)) return false;
  try {
    const actual = JSON.parse(fs.readFileSync(file, 'utf8'));
    const expected = manifestIndex(lock, sources);
    if (actual?.schemaVersion !== 1 || !Array.isArray(actual.files) || !Array.isArray(actual.sources)) return false;
    if (jsonText(actual.sources) !== jsonText(expected.sources)) return false;
    if (actual.files.length !== expected.files.length) return false;
    return actual.files.every((item, index) => {
      const want = expected.files[index];
      return item.source === want.source && item.upstreamPath === want.upstreamPath && item.local === want.local
        && item.sha256 === want.sha256 && item.bytes === want.bytes && item.commit === want.commit && item.repository === want.repository;
    });
  } catch { return false; }
}

export function indexMatches(root, lock, sources, liveRoot = root) {
  const file = path.join(liveRoot, INDEX_FILE);
  if (!fs.existsSync(file)) return false;
  try {
    const expected = jsonText(buildIndex(root, lock, sources));
    const actual = fs.readFileSync(file, 'utf8');
    if (actual === expected) return true;
    // During publishing the root is staged but the index is live; retry comparison with live paths.
    return actual === jsonText(buildIndex(liveRoot, lock, sources));
  } catch { return false; }
}

function sourceFilter(only) {
  if (!only) return null;
  if (typeof only === 'string') return new Set([only]);
  if (only instanceof Set) return only;
  if (Array.isArray(only)) return new Set(only);
  throw new Error('Source filter must be a source id or list of ids.');
}

/** Suggest restoring when the lockfile lists files but live references/upstream/ is empty. */
function restoreHint(live, lock) {
  const locked = Object.values(lock.sources ?? {}).some(entry => Object.keys(entry?.files ?? {}).length);
  if (!locked) return null;
  if (listFiles(path.join(live, UPSTREAM_DIR)).length) return null;
  return 'Local references have not been restored: ' + UPSTREAM_DIR + '/ is empty or missing; cannot verify. Run pnpm refs restore to restore pinned commits and files with sha256 verification (use --source <id> for one source). The lockfile and source configuration remain in the repository.';
}

/** Verify the lockfile, per-file sha256, required files, and index.
 * root locates configuration, lockfile, and index; liveRoot locates reference files (the real workspace during publishing). */
export async function checkReferences(root = ROOT, { sources: only, liveRoot = null } = {}) {
  const live = liveRoot ?? root;
  const sources = await loadConfig(live); const lock = await loadLock(live); const filter = sourceFilter(only);
  const selected = filter ? sources.filter(source => filter.has(source.id)) : sources;
  if (filter && !selected.length) throw new Error('Unknown source: ' + [...filter].join(', '));
  const restore = restoreHint(live, lock);
  if (restore) throw new Error(restore);
  const result = { sources: 0, files: 0, bytes: 0, items: [] };
  for (const source of selected) {
    const entry = lock.sources[source.id];
    if (!entry) throw new Error(source.id + ': Missing lock record. Run refs update first.');
    if (!/^[a-f0-9]{40}$/.test(entry.commit ?? '')) throw new Error(source.id + ': Invalid commit in lock record.');
    if (entry.repository !== source.repository) throw new Error(source.id + ': Lock record repository differs from configuration.');
    if (entry.ref !== source.ref) throw new Error(source.id + ': Lock record ref differs from configuration.');
    if (source.pinCommit && entry.commit !== source.pinCommit) throw new Error(source.id + ': Lock record commit differs from pinCommit.');
    if (!entry.fetchedAt || Number.isNaN(Date.parse(entry.fetchedAt))) throw new Error(source.id + ': Lock record lacks a valid fetchedAt.');
    if (!entry.license || typeof entry.license !== 'object' || !entry.license.spdx || !entry.license.source) throw new Error(source.id + ': Lock record must declare license spdx and source.');
    if (entry.licenseFile && !entry.files?.[entry.licenseFile]) throw new Error(source.id + ': licenseFile is not among the locked files.');
    const locals = new Set();
    for (const [upstream, record] of Object.entries(entry.files ?? {})) {
      if (record.local !== targetPath(source, upstream)) throw new Error(source.id + ': Lockfile path mapping has drifted: ' + upstream);
      if (locals.has(record.local)) throw new Error(source.id + ': Duplicate lockfile path: ' + record.local);
      locals.add(record.local);
      const full = inside(live, record.local);
      if (!fs.existsSync(full)) throw new Error(source.id + ': Missing reference file: ' + record.local + '. Run pnpm refs restore to restore from the lockfile.');
      const bytes = fs.readFileSync(full);
      if (sha256(bytes) !== record.sha256) throw new Error(source.id + ': Reference content was modified: ' + record.local);
      result.files++; result.bytes += bytes.length;
    }
    for (const required of source.required) if (!entry.files?.[required]) throw new Error(source.id + ': Missing required reference: ' + required);
    result.items.push({ id: source.id, commit: entry.commit, files: Object.keys(entry.files ?? {}).length, license: entry.license.spdx });
    result.sources++;
  }
  if (!filter && !indexMatches(root, lock, sources, live) && !indexMatchesManifest(root, lock, sources, live)) throw new Error('references/index.json is missing or stale. Run pnpm refs restore (restore pinned files and rebuild the local index) or pnpm refs update (refresh sources and rewrite the lockfile).');
  return result;
}

/** Search local references and return file paths, line numbers, and context. */
export function searchReferences(root = ROOT, query, { limit = 80, context = 0, sources: only = null } = {}) {
  const needle = String(query ?? '').trim();
  if (!needle) throw new Error('refs search requires a keyword.');
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer.');
  if (!Number.isInteger(context) || context < 0) throw new Error('--context must be a nonnegative integer.');
  const available = listFiles(path.join(root, UPSTREAM_DIR));
  if (!available.length) throw new Error('Local references have not been restored: ' + UPSTREAM_DIR + '/ is empty or missing; nothing to search. Run pnpm refs restore to restore pinned files (use --source <id> for one source).');
  const filter = sourceFilter(only);
  let selectedFiles = null;
  if (filter) {
    const lock = JSON.parse(fs.readFileSync(path.join(root, LOCK_FILE), 'utf8'));
    selectedFiles = new Set();
    for (const id of filter) {
      if (!lock.sources?.[id]) throw new Error('Unknown source: ' + id);
      for (const record of Object.values(lock.sources[id].files)) selectedFiles.add(record.local);
    }
  }
  const lower = needle.toLowerCase(); const results = []; let matched = 0;
  for (const relative of available) {
    if (selectedFiles && !selectedFiles.has(UPSTREAM_DIR + '/' + relative)) continue;
    if (!/\.(md|txt|js|mjs|cjs|ts|tsx|json|yaml|yml|vue|html|css)$/i.test(relative)) continue;
    const full = path.join(root, UPSTREAM_DIR, relative);
    if (fs.statSync(full).size > MAX_FILE_BYTES) continue;
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index].toLowerCase().includes(lower)) continue;
      matched++;
      if (results.length >= limit) continue;
      results.push({
        file: UPSTREAM_DIR + '/' + relative, line: index + 1, text: lines[index].trim().slice(0, 240),
        before: context ? lines.slice(Math.max(0, index - context), index).map(line => line.slice(0, 240)) : [],
        after: context ? lines.slice(index + 1, index + 1 + context).map(line => line.slice(0, 240)) : [],
      });
    }
  }
  return { query: needle, matched, shown: results.length, limit, results };
}

function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp-' + process.pid + '-' + Math.random().toString(16).slice(2);
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, file);
}

function swapDirectory(next, live, backup) {
  fs.rmSync(backup, { recursive: true, force: true });
  const had = fs.existsSync(live);
  if (had) fs.renameSync(live, backup);
  try { fs.renameSync(next, live); }
  catch (error) { if (had && fs.existsSync(backup) && !fs.existsSync(live)) fs.renameSync(backup, live); throw error; }
  return had;
}

function restoreDirectory(live, backup, had) {
  fs.rmSync(live, { recursive: true, force: true });
  if (had && fs.existsSync(backup)) fs.renameSync(backup, live);
}

function licenseRecord(source, selection, payload, stagingRoot) {
  const upstream = licenseUpstreamPath(source, selection);
  if (!upstream) {
    if (source.license && typeof source.license === 'object') {
      if (!source.license.spdx || !source.license.source) throw new Error(source.id + ': license requires spdx and source.');
      return { license: source.license, licenseFile: null };
    }
    throw new Error(source.id + ': No license file selected, and configured license is not an object.');
  }
  const record = payload.get(upstream);
  if (!record) throw new Error(source.id + ': License file is not selected: ' + upstream);
  let license = source.license;
  if (license && typeof license === 'object') {
    if (!license.spdx || !license.source) throw new Error(source.id + ': license requires spdx and source.');
  } else if (typeof license === 'string') license = { spdx: license, source: upstream };
  else license = { spdx: guessSpdx(fs.readFileSync(inside(stagingRoot, stagedPath(record.local)))), source: upstream };
  return { license, licenseFile: upstream };
}

async function downloadSource(source, commit, selection, fetcher) {
  const files = new Map(); let total = 0;
  await mapLimit(selection, CONCURRENCY, async item => {
    const bytes = assertPayload(source, item.path, await fetcher(rawUrl(source, commit, item.path)));
    files.set(item.path, { sha256: sha256(bytes), local: item.local, bytes: bytes.length, data: bytes });
    total += bytes.length;
  });
  if (total > source.maxTotalBytes) throw new Error(source.id + ': Selected content is too large (' + total + ' bytes).');
  return files;
}

/** Read bytes from --seed directory <seed>/<id>/<repository-path>; verify sha256 when a manifest record exists. */
export function seedReader(seedDir, manifest) {
  const dir = path.resolve(seedDir);
  const entries = manifest?.sources ?? null;
  return (source, commit) => {
    const base = path.join(dir, source.id);
    if (!fs.existsSync(base)) return null;
    const declared = entries?.[source.id];
    if (declared?.commit && commit && declared.commit !== commit) throw new Error(source.id + ': Offline reference commit differs from pinned commit (' + declared.commit + ' ≠ ' + commit + ').');
    const files = {};
    for (const relative of listFiles(base)) {
      const bytes = fs.readFileSync(path.join(base, relative));
      const expected = declared?.files?.[relative]?.sha256;
      if (expected && expected !== sha256(bytes)) throw new Error(source.id + ': Offline reference hash differs from manifest: ' + relative);
      files[relative] = bytes;
    }
    return Object.keys(files).length ? { commit: declared?.commit ?? commit, files } : null;
  };
}

/**
 * Refresh references using source configuration.
 * Stage all content first; switch only after every source passes verification.
 * Roll back references and lockfile if publishing (writing lock/index or external validation) fails.
 */
export async function updateReferences({ root = ROOT, fetcher = request, only = null, readOffline = null, validate = () => {}, now = () => new Date().toISOString() } = {}) {
  const sources = await loadConfig(root); const previous = await loadLock(root); const filter = sourceFilter(only);
  const selected = filter ? sources.filter(source => filter.has(source.id)) : sources;
  if (filter && !selected.length) throw new Error('Unknown source: ' + [...filter].join(', '));
  const token = process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  const lockFile = path.join(root, LOCK_FILE);
  const indexFile = path.join(root, INDEX_FILE);
  const lockBefore = fs.existsSync(lockFile) ? fs.readFileSync(lockFile) : null;
  const indexBefore = fs.existsSync(indexFile) ? fs.readFileSync(indexFile) : null;
  const staging = path.join(root, 'references', '.staging-' + token);
  const backup = path.join(root, 'references', '.backup-' + token);
  const live = path.join(root, UPSTREAM_DIR);
  const stagedRoot = path.join(staging, 'upstream');
  let swapped = false; let had = false;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(stagedRoot, { recursive: true });
    if (fs.existsSync(live)) fs.cpSync(live, stagedRoot, { recursive: true });
    const lock = { schemaVersion: 1, sources: { ...(previous.sources ?? {}) } };
    const changed = [];
    for (const source of selected) {
      // Offline seeds use the snapshot commit without upstream access; online updates resolve refs to current commits.
      let commit = source.pinCommit ?? null;
      let offline = null;
      if (readOffline) {
        offline = await readOffline(source, commit);
        if (!offline) throw new Error(source.id + ': Offline references contain no content for this source.');
        if (offline.commit) commit = offline.commit;
      }
      if (!commit) commit = await resolveCommit(source, fetcher);
      let selection; let payload = null;
      if (offline) {
        selection = offlineSelection(source, Object.keys(offline.files));
        payload = new Map(); let total = 0;
        for (const item of selection) {
          const bytes = assertPayload(source, item.path, offline.files[item.path]);
          payload.set(item.path, { sha256: sha256(bytes), local: item.local, bytes: bytes.length, data: bytes });
          total += bytes.length;
        }
        for (const required of source.required) if (!payload.has(required)) throw new Error(source.id + ': Offline references lack a required file: ' + required);
        if (total > source.maxTotalBytes) throw new Error(source.id + ': Offline references are too large (' + total + ' bytes).');
        for (const item of selection) {
          const full = inside(stagedRoot, stagedPath(item.local));
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, payload.get(item.path).data);
        }
      }
      if (!payload) {
        selection = selectFiles(source, await fetcher(treeUrl(source, commit), { json: true }));
        payload = await downloadSource(source, commit, selection, fetcher);
      }
      const files = {}; let total = 0;
      for (const [upstream, record] of [...payload.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
        files[upstream] = { sha256: record.sha256, local: record.local, bytes: record.bytes };
        total += record.bytes;
      }
      const before = previous.sources?.[source.id];
      if (before?.commit === commit && jsonText(before.files ?? {}) === jsonText(files)) continue;
      const fetchedAt = before && before.commit === commit ? before.fetchedAt : now();
      const staged = new Map();
      for (const [upstream, record] of Object.entries(files)) {
        const full = inside(stagedRoot, stagedPath(record.local));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        const entry = payload.get(upstream);
        const data = entry?.data ?? (before?.files?.[upstream] ? fs.readFileSync(inside(root, before.files[upstream].local)) : null);
        if (!data) throw new Error(source.id + ': No downloaded or previous reference content: ' + upstream);
        fs.writeFileSync(full, data);
        staged.set(record.local, true);
      }
      for (const record of Object.values(before?.files ?? {})) if (!staged.has(record.local)) fs.rmSync(inside(stagedRoot, stagedPath(record.local)), { force: true });
      const { license, licenseFile } = licenseRecord(source, selection, payload, stagedRoot);
      lock.sources[source.id] = { repository: source.repository, ref: source.ref, commit, fetchedAt, license, licenseFile, ...(source.note ? { note: source.note } : {}), files };
      changed.push({ id: source.id, commit, files: Object.keys(files).length, bytes: total });
    }
    if (!changed.length) {
      // Keep index and lockfile consistent even if sources are unchanged; rebuild missing or stale indexes.
      const expectedIndex = buildIndex(root, lock, sources);
      if (!indexMatchesManifest(root, lock, sources, root) && expectedIndex.files.length) {
        writeFileAtomic(indexFile, jsonText(expectedIndex));
        return { changed: 0, sources: selected.length, files: 0, bytes: 0, updated: [], indexRepaired: true };
      }
      return { changed: 0, sources: selected.length, files: 0, bytes: 0, updated: [] };
    }
    // Staging layout: upstream/ is the staging root; locked local paths are workspace-relative.
    const index = buildIndex(stagedRoot, lock, sources);
    had = swapDirectory(stagedRoot, live, backup);
    swapped = true;
    try {
      writeFileAtomic(lockFile, jsonText(lock));
      writeFileAtomic(indexFile, jsonText(index));
      await checkReferences(staging, { liveRoot: root });
      await validate();
    } catch (error) {
      const failures = [error];
      try { restoreDirectory(live, backup, had); } catch (restoreError) { failures.push(restoreError); }
      swapped = false;
      try {
        if (lockBefore === null) fs.rmSync(lockFile, { force: true }); else writeFileAtomic(lockFile, lockBefore);
        if (indexBefore === null) fs.rmSync(indexFile, { force: true }); else writeFileAtomic(indexFile, indexBefore);
      } catch (restoreError) { failures.push(restoreError); }
      if (failures.length > 1) throw new AggregateError(failures, 'Update failed and rollback was incomplete');
      throw error;
    }
    fs.rmSync(backup, { recursive: true, force: true });
    return { changed: changed.length, sources: selected.length, files: changed.reduce((sum, item) => sum + item.files, 0), bytes: changed.reduce((sum, item) => sum + item.bytes, 0), updated: changed };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    if (!swapped) fs.rmSync(backup, { recursive: true, force: true });
  }
}

/* ------------------------------ refs restore ------------------------------ */
// Restore references to references/upstream/ from full pinned commits and file lists only.
// Do not use the GitHub tree API or resolve branch heads; verify sha256 and reuse verified local files.
// Write in staging and switch after all checks pass; roll back failures to preserve the old cache.
// Treat downloads as data: write bytes and hashes only; never import or execute. The lockfile is read-only.

function lstatOrNull(file) {
  try { return fs.lstatSync(file); } catch { return null; }
}

/** Reuse only regular local files (skip symlinks) whose size and sha256 match. */
function reuseLive(root, local, sha, size) {
  const full = inside(root, local);
  const stat = lstatOrNull(full);
  if (!stat || !stat.isFile() || stat.size !== size) return null;
  const data = fs.readFileSync(full);
  return sha256(data) === sha ? data : null;
}

/** Prepare one restore file: validate its lock record and destination, then reuse verified local bytes if possible. */
function restoreItem(root, source, entry, upstream, record) {
  assertRelative(upstream, source.id + ' locked upstream path');
  const local = String(record?.local ?? '');
  assertRelative(local, source.id + ' locked local path');
  if (local !== targetPath(source, upstream)) throw new Error(source.id + ': Lock record path mapping has drifted: ' + upstream + ' (run pnpm refs update to regenerate the lockfile)');
  if (!isUnder(UPSTREAM_DIR, local)) throw new Error(source.id + ': Lock record local must be under ' + UPSTREAM_DIR + '/: ' + local);
  const sha = String(record?.sha256 ?? '');
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error(source.id + ': Invalid lock record sha256: ' + upstream);
  if (!Number.isInteger(record?.bytes) || record.bytes < 0) throw new Error(source.id + ': Invalid lock record byte count: ' + upstream);
  return { source, entry, upstream, local, sha, bytes: record.bytes, cached: reuseLive(root, local, sha, record.bytes) };
}

/** Create safe staging paths: remove obstructing symlinks/directories and ensure every segment is a real directory. */
function stagedFile(stagedRoot, local) {
  const prefix = UPSTREAM_DIR + '/';
  if (!local.startsWith(prefix)) throw new Error('Lock record local must be under ' + UPSTREAM_DIR + '/: ' + local);
  const relative = local.slice(prefix.length);
  const segments = relative.split('/');
  if (!relative || segments.some(segment => !segment || segment === '.' || segment === '..')) throw new Error('Path escapes the workspace: ' + local);
  let current = stagedRoot;
  for (const segment of segments.slice(0, -1)) {
    const next = path.join(current, segment);
    const stat = lstatOrNull(next);
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) fs.rmSync(next, { recursive: true, force: true });
    fs.mkdirSync(next, { recursive: true });
    current = next;
  }
  const file = path.join(current, segments[segments.length - 1]);
  const stat = lstatOrNull(file);
  if (stat && (stat.isSymbolicLink() || stat.isDirectory())) fs.rmSync(file, { recursive: true, force: true });
  return file;
}

/** Stage one file: reuse verified bytes or download and verify the pinned commit before writing. */
async function materializeItem(stagedRoot, item, fetcher) {
  const target = stagedFile(stagedRoot, item.local);
  const data = item.cached ?? await fetcher(rawUrl(item.source, item.entry.commit, item.upstream));
  if (!Buffer.isBuffer(data)) throw new Error(item.source.id + ': Fetch function did not return bytes: ' + item.upstream);
  if (data.length !== item.bytes) throw new Error(item.source.id + ': Restored byte count differs from lock record: ' + item.upstream + ' (' + data.length + ' ≠ ' + item.bytes + ')');
  if (sha256(data) !== item.sha) throw new Error(item.source.id + ': Restored sha256 differs from lock record: ' + item.upstream + ' (discarded, not written)');
  writeFileAtomic(target, data);
  return data.length;
}

/** Bound concurrency: stop scheduling on failure, drain in-flight tasks, then throw the first error. */
async function runBounded(items, limit, worker) {
  const width = Math.max(1, Math.min(Number.isInteger(limit) && limit > 0 ? limit : CONCURRENCY, items.length));
  let cursor = 0; let firstError = null;
  await Promise.all(Array.from({ length: width }, async () => {
    for (;;) {
      if (firstError) return;
      const index = cursor++;
      if (index >= items.length) return;
      try { await worker(items[index]); }
      catch (error) { if (!firstError) firstError = error; return; }
    }
  }));
  if (firstError) throw firstError;
}

/** After switching, read back every file and verify it contains the pinned bytes. */
function verifyRestored(root, selected, lock) {
  for (const source of selected) {
    for (const [upstream, record] of Object.entries(lock.sources[source.id].files ?? {})) {
      const full = inside(root, record.local);
      const stat = lstatOrNull(full);
      if (!stat || !stat.isFile()) throw new Error(source.id + ': Missing file after restore: ' + record.local);
      if (sha256(fs.readFileSync(full)) !== record.sha256) throw new Error(source.id + ': Verification failed after restore: ' + record.local);
    }
  }
}

/**
 * Restore pinned references for clones without references/ or to rebuild a damaged cache.
 * When only selects sources, ignore missing others; keep lockfile bytes and timestamps unchanged.
 */
export async function restoreReferences({ root = ROOT, fetcher = request, only = null, concurrency = CONCURRENCY } = {}) {
  const referenceRoot = path.join(root, 'references');
  if (lstatOrNull(referenceRoot)?.isSymbolicLink()) throw new Error('The references directory cannot be a symlink.');
  const sources = await loadConfig(root);
  const lock = await loadLock(root);
  const filter = sourceFilter(only);
  const selected = filter ? sources.filter(source => filter.has(source.id)) : sources;
  if (filter) for (const id of filter) if (!sources.some(source => source.id === id)) throw new Error('Unknown source: ' + id);
  if (filter && !selected.length) throw new Error('Unknown source: ' + [...filter].join(', '));
  if (!fs.existsSync(path.join(root, LOCK_FILE))) throw new Error('Missing ' + LOCK_FILE + ': cannot restore pinned references. Obtain the lockfile from the maintenance configuration first.');
  const items = [];
  for (const source of selected) {
    const entry = lock.sources?.[source.id];
    if (!entry) throw new Error(source.id + ': Lockfile lacks this source. Run pnpm refs update to create lock records before restoring.');
    if (entry.repository !== source.repository) throw new Error(source.id + ': Lock record repository differs from configuration. Run pnpm refs update.');
    if (!/^[a-f0-9]{40}$/.test(String(entry.commit ?? ''))) throw new Error(source.id + ': Lock record commit is not a full 40-character hash. Cannot restore; run pnpm refs update.');
    if (source.pinCommit && entry.commit !== source.pinCommit) throw new Error(source.id + ': Lock record commit differs from configured pinCommit. Run pnpm refs update.');
    const records = Object.entries(entry.files ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    if (!records.length) throw new Error(source.id + ': Lock record has no file list. Run pnpm refs update.');
    for (const [upstream, record] of records) items.push(restoreItem(root, source, entry, upstream, record));
  }
  const indexFile = path.join(root, INDEX_FILE);
  const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
  if (items.every(item => item.cached)) {
    // All files are reusable; leave references intact and rebuild the local index only if missing or stale.
    let indexRebuilt = false;
    if (!indexMatches(root, lock, sources, root)) { writeFileAtomic(indexFile, jsonText(buildIndex(root, lock, sources))); indexRebuilt = true; }
    return { changed: 0, reused: items.length, fetched: 0, sources: selected.length, files: items.length, bytes, indexRebuilt, updated: [] };
  }
  const token = process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  const staging = path.join(root, 'references', '.staging-restore-' + token);
  const backup = path.join(root, 'references', '.backup-restore-' + token);
  const live = path.join(root, UPSTREAM_DIR);
  const stagedRoot = path.join(staging, 'upstream');
  const indexBefore = fs.existsSync(indexFile) ? fs.readFileSync(indexFile) : null;
  let swapped = false; let had = false;
  let preserveBackup = false;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(stagedRoot, { recursive: true });
    if (fs.existsSync(live)) fs.cpSync(live, stagedRoot, { recursive: true, dereference: false });
    let fetched = 0;
    await runBounded(items, concurrency, async item => {
      if (!item.cached) fetched++;
      await materializeItem(stagedRoot, item, fetcher);
    });
    const index = buildIndex(stagedRoot, lock, sources);
    preserveBackup = true;
    had = swapDirectory(stagedRoot, live, backup);
    swapped = true;
    try {
      writeFileAtomic(indexFile, jsonText(index));
      verifyRestored(root, selected, lock);
    } catch (error) {
      const failures = [error];
      try { restoreDirectory(live, backup, had); preserveBackup = false; } catch (restoreError) { failures.push(restoreError); }
      swapped = false;
      try { if (indexBefore === null) fs.rmSync(indexFile, { force: true }); else writeFileAtomic(indexFile, indexBefore); } catch (restoreError) { failures.push(restoreError); }
      if (failures.length > 1) throw new AggregateError(failures, 'Restore failed and rollback was incomplete. Keep the backup directory: ' + backup);
      throw error;
    }
    fs.rmSync(backup, { recursive: true, force: true });
    preserveBackup = false;
    const updated = selected.map(source => {
      const own = items.filter(item => item.source.id === source.id);
      const ownFetched = own.filter(item => !item.cached).length;
      return { id: source.id, commit: lock.sources[source.id].commit, files: own.length, bytes: own.reduce((sum, item) => sum + item.bytes, 0), fetched: ownFetched, reused: own.length - ownFetched };
    });
    return { changed: fetched, reused: items.length - fetched, fetched, sources: selected.length, files: items.length, bytes, indexRebuilt: true, updated };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    if (!swapped && !preserveBackup) fs.rmSync(backup, { recursive: true, force: true });
  }
}

export function parseArgs(argv) {
  const args = argv.filter(value => value !== '--');
  const command = args[0] ?? 'check'; const rest = args.slice(1);
  const options = { sources: [], positional: [], limit: 80, context: 0, seed: null };
  for (let index = 0; index < rest.length; index++) {
    const value = rest[index];
    if (value === '--source' || value === '-s') { const next = rest[++index]; if (!next) throw new Error('--source requires a source id.'); options.sources.push(next); }
    else if (value.startsWith('--source=')) options.sources.push(value.slice(9));
    else if (value === '--limit') options.limit = Number(rest[++index]);
    else if (value.startsWith('--limit=')) options.limit = Number(value.slice(8));
    else if (value === '--context') options.context = Number(rest[++index]);
    else if (value.startsWith('--context=')) options.context = Number(value.slice(10));
    else if (value === '--seed') options.seed = rest[++index] ?? null;
    else if (value.startsWith('--seed=')) options.seed = value.slice(7);
    else options.positional.push(value);
  }
  return { command, ...options };
}

/** CLI entry point: print JSON on success and failure; return exit code 1 on failure. */
export async function main(argv = process.argv.slice(2)) {
  const { command, sources, positional, limit, context, seed } = parseArgs(argv);
  const only = sources.length ? new Set(sources) : null;
  if (command === 'check') return { ok: true, command: 'check', ...(await checkReferences(ROOT, { sources: only })) };
  if (command === 'search') return { ok: true, command: 'search', ...searchReferences(ROOT, positional.join(' '), { limit, context, sources: only }) };
  if (command === 'restore') return { ok: true, command: 'restore', ...(await restoreReferences({ root: ROOT, only })) };
  if (command === 'update') {
    let readOffline = null;
    if (seed) {
      const manifestFile = path.join(path.resolve(seed), 'manifest.json');
      readOffline = seedReader(seed, fs.existsSync(manifestFile) ? await readJSON(manifestFile) : null);
    }
    return { ok: true, command: 'update', ...(await updateReferences({ only, readOffline })) };
  }
  if (command === 'verify-sources') {
    return { ok: true, command: 'verify-sources', sources: (await loadConfig(ROOT)).map(source => ({ id: source.id, repository: source.repository, ref: source.ref, pinCommit: source.pinCommit ?? null, dest: source.dest })) };
  }
  throw new Error('refs supports check, search <keyword>, restore [--source <id>], update [--seed <directory>], and verify-sources.');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().then(result => { process.stdout.write(jsonText(result)); }).catch(error => {
    process.stdout.write(jsonText({ ok: false, command: process.argv[2] ?? 'check', error: error?.message ?? String(error) }));
    process.exitCode = 1;
  });
}
