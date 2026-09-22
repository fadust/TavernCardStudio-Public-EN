// 工作区参考资料（references/）的检索、校验、按锁还原与固定版本刷新。
// 配置：maintenance/reference-sources.json；锁文件：maintenance/references.lock.json。
// 输出：每条命令打印一个 JSON 对象，包含 ok、command 与结果字段。
// 边界：只读写 references/、maintenance/references.lock.json 与 references/index.json；
// 下载内容一律当作资料文本，只做字节读取与哈希，绝不导入或执行。
// refs restore 只读取锁文件：按锁定的完整提交与文件清单取字节，不改锁文件内容与时间。
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
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.includes('\0')) throw new Error('必须使用项目内相对路径: ' + relative);
  if (relative.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) throw new Error('路径越界: ' + relative);
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw new Error('路径越界: ' + relative);
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
/** include/exclude 支持 're:正则'、普通子串，或 RegExp（测试用）。 */
export function toMatcher(pattern, id) {
  if (pattern instanceof RegExp) return value => pattern.test(value);
  if (typeof pattern !== 'string' || !pattern) throw new Error(id + ': include/exclude 只能是非空字符串或正则。');
  if (pattern.startsWith('re:')) {
    let regexp;
    try { regexp = new RegExp(pattern.slice(3), 'i'); }
    catch (error) { throw new Error(id + ': include/exclude 正则无效 ' + JSON.stringify(pattern) + '（' + error.message + '）'); }
    return value => regexp.test(value);
  }
  return value => value.includes(pattern);
}
const matchAny = (patterns, value) => patterns.some(pattern => pattern(value));

/** 校验关键路径是相对工作区的安全路径。 */
function assertRelative(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(label + ': 需要非空相对路径。');
  if (path.isAbsolute(value) || value.includes('\\') || value.includes('\0')) throw new Error(label + ': 必须使用项目内相对路径: ' + value);
  if (value.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) throw new Error('路径越界: ' + value);
  return value;
}

/** 把工作区相对资料路径换算成暂存目录里的路径。 */
const stagedPath = local => {
  const prefix = UPSTREAM_DIR + '/';
  return local.startsWith(prefix) ? local.slice(prefix.length) : local;
};

/** 编译 maintenance/reference-sources.json。files 项可以是仓库内路径、目录前缀，或 '上游前缀:-> 本地前缀' 映射。 */
export function compileSources(config) {
  if (config?.schemaVersion !== 1) throw new Error('reference-sources.json: schemaVersion 必须为 1。');
  if (!Array.isArray(config.sources) || !config.sources.length) throw new Error('reference-sources.json: sources 必须是非空数组。');
  const seen = new Set();
  return config.sources.map(raw => {
    const source = raw ?? {};
    const { id, repository, ref } = source;
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('无效的来源 id: ' + JSON.stringify(id));
    if (seen.has(id)) throw new Error('重复的来源 id: ' + id);
    seen.add(id);
    if (typeof repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(id + ': repository 必须是 owner/name。');
    if (typeof ref !== 'string' || !ref.trim()) throw new Error(id + ': ref 不能为空。');
    if (source.pinCommit !== undefined && !/^[a-f0-9]{40}$/.test(source.pinCommit)) throw new Error(id + ': pinCommit 必须是完整的 40 位提交哈希。');
    const dest = source.dest === undefined ? id : normalize(source.dest);
    assertRelative(dest, id + ' 的 dest');
    if (!Array.isArray(source.files) || !source.files.length) throw new Error(id + ': files 必须是非空数组。');
    const file = source.files.map(raw => {
      const text = String(raw); const at = text.indexOf(':->');
      if (at === -1) { const from = normalize(text); if (!from) throw new Error(id + ': 空的仓库内路径。'); return { from, to: null }; }
      const from = normalize(text.slice(0, at).trim()); const to = normalize(text.slice(at + 3).trim());
      if (!from || !to) throw new Error(id + ': 文件映射格式错误: ' + text);
      inside(UPSTREAM_DIR, from);
      assertRelative(to, id + ' 的文件映射目标');
      return { from, to };
    });
    for (const item of file) assertRelative(item.to ?? UPSTREAM_DIR + '/' + dest + '/' + item.from, id + ' 的资料路径');
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
  if (lock?.schemaVersion !== 1 || !lock.sources || typeof lock.sources !== 'object') throw new Error('references.lock.json: 结构或版本不受支持。');
  return lock;
}

/** 上游文件在资料库中的落点（相对工作区根）。 */
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

/** 从 GitHub 目录树里挑选该来源需要的文件。 */
export function selectFiles(source, tree) {
  if (tree?.truncated) throw new Error(source.id + ': 上游目录树被截断，无法安全挑选文件。');
  const candidates = (tree?.tree ?? []).filter(entry => entry.type === 'blob').filter(entry => {
    const file = toPosix(entry.path);
    if (!source.file.some(item => isUnder(item.from, file))) return false;
    if (matchAny(source.exclude, file)) return false;
    return !source.include.length || matchAny(source.include, file);
  });
  const seen = new Set();
  const selected = candidates.sort((a, b) => (a.path < b.path ? -1 : 1)).map(entry => ({ path: toPosix(entry.path), local: targetPath(source, entry.path) }));
  for (const item of selected) {
    if (seen.has(item.path)) throw new Error(source.id + ': 上游路径重复: ' + item.path);
    seen.add(item.path); inside(UPSTREAM_DIR, item.local);
  }
  for (const required of source.required) if (!selected.some(item => item.path === required)) throw new Error(source.id + ': 必需的上游文件未被选中: ' + required);
  if (!selected.length) throw new Error(source.id + ': 没有选中任何上游文件。');
  if (selected.length > source.maxFiles) throw new Error(source.id + ': 选中的文件过多（' + selected.length + ' > ' + source.maxFiles + '）。');
  const locals = new Set();
  for (const item of selected) {
    if (locals.has(item.local)) throw new Error(source.id + ': 两个上游文件映射到同一路径: ' + item.local);
    locals.add(item.local);
  }
  return selected;
}

/** 离线播种：用本地已有的仓库内路径推导选中集合。 */
export function offlineSelection(source, available) {
  const selected = [...available].map(toPosix).sort().filter(file => {
    if (!source.file.some(item => isUnder(item.from, file))) return false;
    if (matchAny(source.exclude, file)) return false;
    return !source.include.length || matchAny(source.include, file);
  }).map(file => ({ path: file, local: targetPath(source, file) }));
  for (const required of source.required) if (!selected.some(item => item.path === required)) throw new Error(source.id + ': 离线资料缺少必需文件: ' + required);
  if (!selected.length) throw new Error(source.id + ': 离线资料没有命中任何文件。');
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
  // 无标题的 MIT 风格文本（以版权行开头，仍保留授权与免责声明全文）。
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

/** 默认取数：JSON 走 GitHub API，二进制与文本走 raw.githubusercontent。 */
export async function request(url, { json = false, token = process.env.GITHUB_TOKEN, attempts = 3 } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const headers = json ? githubHeaders(token) : { 'user-agent': USER_AGENT, ...(token ? { authorization: 'Bearer ' + token } : {}) };
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
      if (!response.ok) {
        const error = new Error('上游请求失败 HTTP ' + response.status + ': ' + url);
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
  if (!/^[a-f0-9]{40}$/.test(head?.sha ?? '')) throw new Error(source.id + ': 未取到完整的提交哈希。');
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

/** 下载内容的防御性校验：非空、体积受限、不是 HTML、不是二进制、JSON 可解析。 */
export function assertPayload(source, upstreamPath, bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error(source.id + ': 需要字节内容: ' + upstreamPath);
  // 结构文件必须非空；文本源码允许合法的空占位文件（例如空的 .ts/.css）。
  if (!bytes.length && !/\.(md|txt|js|mjs|cjs|ts|tsx|vue|html|css)$/i.test(upstreamPath)) throw new Error(source.id + ': 上游文件为空: ' + upstreamPath);
  if (bytes.length > source.maxFileBytes) throw new Error(source.id + ': 上游文件过大: ' + upstreamPath);
  const head = bytes.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) throw new Error(source.id + ': 上游返回了 HTML 页面: ' + upstreamPath);
  if (bytes.includes(0) && /\.(md|txt|js|mjs|cjs|ts|tsx|json|yaml|yml)$/i.test(upstreamPath)) throw new Error(source.id + ': 上游文件疑似二进制: ' + upstreamPath);
  if (/\.json$/i.test(upstreamPath)) {
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
    if (!/^\s*[[{"\dntf-]/.test(text)) throw new Error(source.id + ': 上游 JSON 格式异常: ' + upstreamPath);
    try { JSON.parse(text); } catch { throw new Error(source.id + ': 上游 JSON 无法解析: ' + upstreamPath); }
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

/** 只按锁文件生成索引清单，不读取磁盘：用于提交阶段的结构比对。 */
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

/** 由锁文件与磁盘内容生成 references/index.json。 */
export function buildIndex(root, lock, sources) {
  const known = new Set(sources.map(source => source.id)); const files = [];
  for (const [id, entry] of Object.entries(lock.sources ?? {})) {
    if (!known.has(id)) continue;
    for (const [upstream, record] of Object.entries(entry.files ?? {})) {
      // root 是工作区时用资料路径；root 是暂存目录时用暂存布局，也会回退到暂存目录里的直属副本。
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

/** 索引必须与锁文件一一对应；不依赖资料文件当前在暂存区还是活目录。 */
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
    // 提交阶段 root 是暂存目录、索引写在活目录：此时用活目录布局回退再比一次。
    return actual === jsonText(buildIndex(liveRoot, lock, sources));
  } catch { return false; }
}

function sourceFilter(only) {
  if (!only) return null;
  if (typeof only === 'string') return new Set([only]);
  if (only instanceof Set) return only;
  if (Array.isArray(only)) return new Set(only);
  throw new Error('来源筛选必须是来源 id 或 id 列表。');
}

/** 锁文件里有文件清单，但 live 侧的 references/upstream/ 为空时，给出还原建议。 */
function restoreHint(live, lock) {
  const locked = Object.values(lock.sources ?? {}).some(entry => Object.keys(entry?.files ?? {}).length);
  if (!locked) return null;
  if (listFiles(path.join(live, UPSTREAM_DIR)).length) return null;
  return '本地参考资料未恢复：' + UPSTREAM_DIR + '/ 为空或缺失，无法校验。请运行 pnpm refs restore 按锁文件还原（只取锁定的完整提交与文件，按 sha256 校验；可用 --source <id> 只还原指定来源），锁文件与来源配置随仓库保留。';
}

/** 校验锁文件、逐文件 sha256、必需文件与索引。
 * root 用来读配置、锁文件与索引；liveRoot 用来定位资料文件（提交阶段指向真实工作区）。 */
export async function checkReferences(root = ROOT, { sources: only, liveRoot = null } = {}) {
  const live = liveRoot ?? root;
  const sources = await loadConfig(live); const lock = await loadLock(live); const filter = sourceFilter(only);
  const selected = filter ? sources.filter(source => filter.has(source.id)) : sources;
  if (filter && !selected.length) throw new Error('未知来源: ' + [...filter].join(', '));
  const restore = restoreHint(live, lock);
  if (restore) throw new Error(restore);
  const result = { sources: 0, files: 0, bytes: 0, items: [] };
  for (const source of selected) {
    const entry = lock.sources[source.id];
    if (!entry) throw new Error(source.id + ': 缺少锁记录，请先运行 refs update。');
    if (!/^[a-f0-9]{40}$/.test(entry.commit ?? '')) throw new Error(source.id + ': 锁记录的 commit 无效。');
    if (entry.repository !== source.repository) throw new Error(source.id + ': 锁记录的 repository 与配置不一致。');
    if (entry.ref !== source.ref) throw new Error(source.id + ': 锁记录的 ref 与配置不一致。');
    if (source.pinCommit && entry.commit !== source.pinCommit) throw new Error(source.id + ': 锁记录的 commit 与 pinCommit 不一致。');
    if (!entry.fetchedAt || Number.isNaN(Date.parse(entry.fetchedAt))) throw new Error(source.id + ': 锁记录缺少有效的 fetchedAt。');
    if (!entry.license || typeof entry.license !== 'object' || !entry.license.spdx || !entry.license.source) throw new Error(source.id + ': 锁记录必须写明许可证的 spdx 与来源。');
    if (entry.licenseFile && !entry.files?.[entry.licenseFile]) throw new Error(source.id + ': licenseFile 不在锁定的文件里。');
    const locals = new Set();
    for (const [upstream, record] of Object.entries(entry.files ?? {})) {
      if (record.local !== targetPath(source, upstream)) throw new Error(source.id + ': 锁文件的路径映射已漂移: ' + upstream);
      if (locals.has(record.local)) throw new Error(source.id + ': 锁文件路径重复: ' + record.local);
      locals.add(record.local);
      const full = inside(live, record.local);
      if (!fs.existsSync(full)) throw new Error(source.id + ': 资料文件缺失: ' + record.local + '。请运行 pnpm refs restore 按锁还原。');
      const bytes = fs.readFileSync(full);
      if (sha256(bytes) !== record.sha256) throw new Error(source.id + ': 资料内容被改动: ' + record.local);
      result.files++; result.bytes += bytes.length;
    }
    for (const required of source.required) if (!entry.files?.[required]) throw new Error(source.id + ': 缺少必需资料: ' + required);
    result.items.push({ id: source.id, commit: entry.commit, files: Object.keys(entry.files ?? {}).length, license: entry.license.spdx });
    result.sources++;
  }
  if (!filter && !indexMatches(root, lock, sources, live) && !indexMatchesManifest(root, lock, sources, live)) throw new Error('references/index.json 缺失或过期，请运行 pnpm refs restore（按锁还原并重建本地索引）或 pnpm refs update（刷新来源并重写锁文件）。');
  return result;
}

/** 在本地资料库里检索关键词，返回文件、行号与上下文。 */
export function searchReferences(root = ROOT, query, { limit = 80, context = 0, sources: only = null } = {}) {
  const needle = String(query ?? '').trim();
  if (!needle) throw new Error('refs search 需要一个关键词。');
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit 必须是正整数。');
  if (!Number.isInteger(context) || context < 0) throw new Error('--context 必须是非负整数。');
  const available = listFiles(path.join(root, UPSTREAM_DIR));
  if (!available.length) throw new Error('本地参考资料尚未恢复：' + UPSTREAM_DIR + '/ 为空或缺失，检索不到内容。请先运行 pnpm refs restore（可用 --source <id> 只还原指定来源）按锁文件还原。');
  const filter = sourceFilter(only);
  let selectedFiles = null;
  if (filter) {
    const lock = JSON.parse(fs.readFileSync(path.join(root, LOCK_FILE), 'utf8'));
    selectedFiles = new Set();
    for (const id of filter) {
      if (!lock.sources?.[id]) throw new Error('未知来源: ' + id);
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
      if (!source.license.spdx || !source.license.source) throw new Error(source.id + ': license 需要 spdx 与 source。');
      return { license: source.license, licenseFile: null };
    }
    throw new Error(source.id + ': 没有选中许可证文件，且配置里的 license 不是对象。');
  }
  const record = payload.get(upstream);
  if (!record) throw new Error(source.id + ': 许可证文件不在本次选中范围内: ' + upstream);
  let license = source.license;
  if (license && typeof license === 'object') {
    if (!license.spdx || !license.source) throw new Error(source.id + ': license 需要 spdx 与 source。');
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
  if (total > source.maxTotalBytes) throw new Error(source.id + ': 选中内容总量过大（' + total + ' 字节）。');
  return files;
}

/** 读取 --seed 目录：<seed>/<id>/<仓库内路径>，返回字节；命中清单时校验 sha256。 */
export function seedReader(seedDir, manifest) {
  const dir = path.resolve(seedDir);
  const entries = manifest?.sources ?? null;
  return (source, commit) => {
    const base = path.join(dir, source.id);
    if (!fs.existsSync(base)) return null;
    const declared = entries?.[source.id];
    if (declared?.commit && commit && declared.commit !== commit) throw new Error(source.id + ': 离线资料的 commit 与锁定的 commit 不一致（' + declared.commit + ' ≠ ' + commit + '）。');
    const files = {};
    for (const relative of listFiles(base)) {
      const bytes = fs.readFileSync(path.join(base, relative));
      const expected = declared?.files?.[relative]?.sha256;
      if (expected && expected !== sha256(bytes)) throw new Error(source.id + ': 离线资料哈希与清单不一致: ' + relative);
      files[relative] = bytes;
    }
    return Object.keys(files).length ? { commit: declared?.commit ?? commit, files } : null;
  };
}

/**
 * 按配置刷新参考资料。
 * 全部内容先写入暂存目录；只有每个来源都校验通过后才整体切换；
 * 提交阶段（写锁文件/索引或外部校验）失败时回滚到切换前的资料与锁文件。
 */
export async function updateReferences({ root = ROOT, fetcher = request, only = null, readOffline = null, validate = () => {}, now = () => new Date().toISOString() } = {}) {
  const sources = await loadConfig(root); const previous = await loadLock(root); const filter = sourceFilter(only);
  const selected = filter ? sources.filter(source => filter.has(source.id)) : sources;
  if (filter && !selected.length) throw new Error('未知来源: ' + [...filter].join(', '));
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
      // 离线播种以快照声明的提交为准，不访问上游；联网更新才解析 ref 到最新提交。
      let commit = source.pinCommit ?? null;
      let offline = null;
      if (readOffline) {
        offline = await readOffline(source, commit);
        if (!offline) throw new Error(source.id + ': 离线资料没有该来源的内容。');
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
        for (const required of source.required) if (!payload.has(required)) throw new Error(source.id + ': 离线资料缺少必需文件: ' + required);
        if (total > source.maxTotalBytes) throw new Error(source.id + ': 离线资料总量过大（' + total + ' 字节）。');
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
        if (!data) throw new Error(source.id + ': 既没有下载内容也没有旧的资料内容: ' + upstream);
        fs.writeFileSync(full, data);
        staged.set(record.local, true);
      }
      for (const record of Object.values(before?.files ?? {})) if (!staged.has(record.local)) fs.rmSync(inside(stagedRoot, stagedPath(record.local)), { force: true });
      const { license, licenseFile } = licenseRecord(source, selection, payload, stagedRoot);
      lock.sources[source.id] = { repository: source.repository, ref: source.ref, commit, fetchedAt, license, licenseFile, ...(source.note ? { note: source.note } : {}), files };
      changed.push({ id: source.id, commit, files: Object.keys(files).length, bytes: total });
    }
    if (!changed.length) {
      // 没有来源内容变化时也要保证索引与锁文件一致：资料已就位、索引为空或过期时直接补写。
      const expectedIndex = buildIndex(root, lock, sources);
      if (!indexMatchesManifest(root, lock, sources, root) && expectedIndex.files.length) {
        writeFileAtomic(indexFile, jsonText(expectedIndex));
        return { changed: 0, sources: selected.length, files: 0, bytes: 0, updated: [], indexRepaired: true };
      }
      return { changed: 0, sources: selected.length, files: 0, bytes: 0, updated: [] };
    }
    // 暂存布局：upstream/ 是暂存根，锁里的 local 是工作区相对路径。
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
      if (failures.length > 1) throw new AggregateError(failures, '更新失败且回滚未完全成功');
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
// 按锁文件把参考资料还原到 references/upstream/：只取锁定的完整提交与文件清单，
// 不使用 GitHub tree API，也不解析最新分支；逐文件按 sha256 校验，已存在且校验通过的文件直接复用。
// 先在暂存目录里分阶段写好，全部通过后再整体切换；任何失败都回滚，不损伤旧缓存。
// 下载内容一律当资料：只做字节写入与哈希，绝不导入或执行；锁文件只读，不写入。

function lstatOrNull(file) {
  try { return fs.lstatSync(file); } catch { return null; }
}

/** 复用本地文件：必须是普通文件（跳过符号链接），大小一致且 sha256 命中才可用。 */
function reuseLive(root, local, sha, size) {
  const full = inside(root, local);
  const stat = lstatOrNull(full);
  if (!stat || !stat.isFile() || stat.size !== size) return null;
  const data = fs.readFileSync(full);
  return sha256(data) === sha ? data : null;
}

/** 需要还原的单个文件：校验锁记录、确认落点，并尽量复用已校验的本地字节。 */
function restoreItem(root, source, entry, upstream, record) {
  assertRelative(upstream, source.id + ' 锁记录里的上游路径');
  const local = String(record?.local ?? '');
  assertRelative(local, source.id + ' 锁记录里的 local');
  if (local !== targetPath(source, upstream)) throw new Error(source.id + ': 锁记录的路径映射已漂移: ' + upstream + '（请运行 pnpm refs update 重新生成锁文件）');
  if (!isUnder(UPSTREAM_DIR, local)) throw new Error(source.id + ': 锁记录的 local 必须位于 ' + UPSTREAM_DIR + '/ 下: ' + local);
  const sha = String(record?.sha256 ?? '');
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error(source.id + ': 锁记录的 sha256 无效: ' + upstream);
  if (!Number.isInteger(record?.bytes) || record.bytes < 0) throw new Error(source.id + ': 锁记录的字节数无效: ' + upstream);
  return { source, entry, upstream, local, sha, bytes: record.bytes, cached: reuseLive(root, local, sha, record.bytes) };
}

/** 在暂存目录里安全地建立目标路径：清掉挡路的符号链接与目录，逐段确保是真实目录。 */
function stagedFile(stagedRoot, local) {
  const prefix = UPSTREAM_DIR + '/';
  if (!local.startsWith(prefix)) throw new Error('锁记录的 local 必须位于 ' + UPSTREAM_DIR + '/ 下: ' + local);
  const relative = local.slice(prefix.length);
  const segments = relative.split('/');
  if (!relative || segments.some(segment => !segment || segment === '.' || segment === '..')) throw new Error('路径越界: ' + local);
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

/** 把单个文件写进暂存目录：命中复用就直接写，否则按锁定的完整提交下载并校验后再写。 */
async function materializeItem(stagedRoot, item, fetcher) {
  const target = stagedFile(stagedRoot, item.local);
  const data = item.cached ?? await fetcher(rawUrl(item.source, item.entry.commit, item.upstream));
  if (!Buffer.isBuffer(data)) throw new Error(item.source.id + ': 取数函数没有返回字节内容: ' + item.upstream);
  if (data.length !== item.bytes) throw new Error(item.source.id + ': 还原内容长度与锁记录不一致: ' + item.upstream + '（' + data.length + ' ≠ ' + item.bytes + '）');
  if (sha256(data) !== item.sha) throw new Error(item.source.id + ': 还原内容 sha256 与锁记录不一致: ' + item.upstream + '（已丢弃，未写入）');
  writeFileAtomic(target, data);
  return data.length;
}

/** 有界并发：任何一个失败就停发新任务，并等所有在途任务收尾后再抛第一个错误。 */
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

/** 切换后按锁记录逐文件回读校验，确认落到工作区的就是锁定的字节。 */
function verifyRestored(root, selected, lock) {
  for (const source of selected) {
    for (const [upstream, record] of Object.entries(lock.sources[source.id].files ?? {})) {
      const full = inside(root, record.local);
      const stat = lstatOrNull(full);
      if (!stat || !stat.isFile()) throw new Error(source.id + ': 还原后缺少文件: ' + record.local);
      if (sha256(fs.readFileSync(full)) !== record.sha256) throw new Error(source.id + ': 还原后校验失败: ' + record.local);
    }
  }
}

/**
 * 按锁文件还原参考资料，供未随发布分发 references/ 的克隆或损坏缓存重建。
 * only 指定来源时只处理这些来源，其它来源缺失不影响；锁文件只读，内容与时间不变。
 */
export async function restoreReferences({ root = ROOT, fetcher = request, only = null, concurrency = CONCURRENCY } = {}) {
  const referenceRoot = path.join(root, 'references');
  if (lstatOrNull(referenceRoot)?.isSymbolicLink()) throw new Error('references 目录不能是符号链接。');
  const sources = await loadConfig(root);
  const lock = await loadLock(root);
  const filter = sourceFilter(only);
  const selected = filter ? sources.filter(source => filter.has(source.id)) : sources;
  if (filter) for (const id of filter) if (!sources.some(source => source.id === id)) throw new Error('未知来源: ' + id);
  if (filter && !selected.length) throw new Error('未知来源: ' + [...filter].join(', '));
  if (!fs.existsSync(path.join(root, LOCK_FILE))) throw new Error('缺少 ' + LOCK_FILE + '：无法按锁还原。锁文件随维护配置保留，请先取得它。');
  const items = [];
  for (const source of selected) {
    const entry = lock.sources?.[source.id];
    if (!entry) throw new Error(source.id + ': 锁文件缺少该来源，请运行 pnpm refs update 生成锁记录后再还原。');
    if (entry.repository !== source.repository) throw new Error(source.id + ': 锁记录的 repository 与配置不一致，请运行 pnpm refs update。');
    if (!/^[a-f0-9]{40}$/.test(String(entry.commit ?? ''))) throw new Error(source.id + ': 锁记录的 commit 不是完整 40 位提交哈希，无法按锁还原，请运行 pnpm refs update。');
    if (source.pinCommit && entry.commit !== source.pinCommit) throw new Error(source.id + ': 锁记录的 commit 与配置 pinCommit 不一致，请运行 pnpm refs update。');
    const records = Object.entries(entry.files ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
    if (!records.length) throw new Error(source.id + ': 锁记录没有文件清单，请运行 pnpm refs update。');
    for (const [upstream, record] of records) items.push(restoreItem(root, source, entry, upstream, record));
  }
  const indexFile = path.join(root, INDEX_FILE);
  const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
  if (items.every(item => item.cached)) {
    // 全部命中复用：不动资料，只在缺失或过期时重建本地索引。
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
      if (failures.length > 1) throw new AggregateError(failures, '还原失败且回滚未完全成功，请保留备份目录: ' + backup);
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
    if (value === '--source' || value === '-s') { const next = rest[++index]; if (!next) throw new Error('--source 需要来源 id。'); options.sources.push(next); }
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

/** 命令行入口；成功与失败都打印 JSON，失败时返回退出码 1。 */
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
  throw new Error('refs 支持 check、search <关键词>、restore（可选 --source <id>）、update（可选 --seed <目录>）、verify-sources。');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().then(result => { process.stdout.write(jsonText(result)); }).catch(error => {
    process.stdout.write(jsonText({ ok: false, command: process.argv[2] ?? 'check', error: error?.message ?? String(error) }));
    process.exitCode = 1;
  });
}
