// refs restore：按锁文件还原参考资料（离线注入 fetcher，不访问网络）。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { restoreReferences, updateReferences, checkReferences, searchReferences, sha256, parseArgs } from '../tools/refs.mjs';

// 离线保证：本文件只允许注入 fetcher，任何真实网络访问都会立刻失败。
const realFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('refs restore 测试不应访问网络'); };
test.after(() => { globalThis.fetch = realFetch; });

const COMMIT = 'a'.repeat(40);
const OFFLINE_FETCHER = async () => ({ sha: COMMIT });
const REPOS = { 'example/demo': 'demo', 'example/extra': 'extra' };
const createdRoots = [];
test.after(async () => {
  const prefix = path.resolve(os.tmpdir()) + path.sep + 'tavern-refs-restore-';
  for (const root of createdRoots) {
    if (!path.resolve(root).startsWith(prefix)) throw new Error('测试清理路径越界');
    await fs.rm(root, { recursive: true, force: true });
  }
});

function textFile(body) { return Buffer.from(body, 'utf8'); }

function fixtureConfig() {
  return {
    schemaVersion: 1,
    sources: [
      {
        id: 'demo', repository: 'example/demo', ref: 'main', dest: 'demo',
        license: { spdx: 'MIT', source: 'demo/LICENSE' },
        files: ['LICENSE', 'docs/:-> references/upstream/demo-docs/'],
        include: ['re:\\.(md|txt|json)$', 're:(^|/)LICENSE$'],
        exclude: [], required: ['LICENSE', 'docs/guide.md'],
      },
      {
        id: 'extra', repository: 'example/extra', ref: 'main', dest: 'extra',
        license: { spdx: 'MIT', source: 'extra/LICENSE' },
        files: ['LICENSE'], include: [], exclude: [], required: ['LICENSE'],
      },
    ],
  };
}

function seedMap() {
  return new Map(Object.entries({
    'demo/LICENSE': textFile('MIT License\n\nCopyright (c) 2026 Demo\n'),
    'demo/docs/guide.md': textFile('# Guide\n\nWorld Info entries use keys and content.\n'),
    'demo/docs/api.json': textFile('{"ok":true}\n'),
    'extra/LICENSE': textFile('MIT License\n\nCopyright (c) 2026 Extra\n'),
  }));
}

async function fixture(config = fixtureConfig()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tavern-refs-restore-'));
  createdRoots.push(root);
  await fs.mkdir(path.join(root, 'maintenance'), { recursive: true });
  await fs.writeFile(path.join(root, 'maintenance/reference-sources.json'), JSON.stringify(config, null, 2) + '\n');
  return root;
}

function offlineReader(seed) {
  return (source, commit) => {
    const files = {};
    for (const [key, bytes] of seed) {
      const prefix = source.id + '/';
      if (key.startsWith(prefix)) files[key.slice(prefix.length)] = bytes;
    }
    return Object.keys(files).length ? { commit, files } : null;
  };
}

/** 注入的 URL 取数：只认 raw.githubusercontent.com/<repo>/<commit>/<path>，记录全部调用。 */
function urlFetcher(seed, { fail = null, override = null } = {}) {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    const match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([a-f0-9]{40})\/(.+)$/.exec(url);
    if (!match) throw new Error('restore 访问了非 raw 地址: ' + url);
    const [, repo, commit, encoded] = match;
    if (commit !== COMMIT) throw new Error('restore 未使用锁定的完整提交: ' + url);
    const upstream = encoded.split('/').map(decodeURIComponent).join('/');
    const key = REPOS[repo] + '/' + upstream;
    if (fail && fail(key)) throw new Error('注入的下载失败: ' + key);
    if (override && override.has(key)) return override.get(key);
    if (!seed.has(key)) throw new Error('未命中种子: ' + key);
    return seed.get(key);
  };
  fetch.calls = calls;
  return fetch;
}

async function snapshot(root) {
  const output = {};
  const walk = async dir => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) output[path.relative(root, full).split(path.sep).join('/')] = sha256(await fs.readFile(full));
    }
  };
  if (fss.existsSync(root)) await walk(root);
  return output;
}

async function lockBytes(root) { return fs.readFile(path.join(root, 'maintenance/references.lock.json')); }

async function lockFrom(root, seed) {
  await updateReferences({ root, fetcher: OFFLINE_FETCHER, readOffline: offlineReader(seed) });
}

function leftover(root) {
  const dir = path.join(root, 'references');
  if (!fss.existsSync(dir)) return [];
  return fss.readdirSync(dir).filter(name => /^\.(staging|backup)-restore-/.test(name));
}

test('restore 按锁还原缺失缓存、不改锁文件并重建索引', async () => {
  const seed = seedMap();
  const root = await fixture();
  await lockFrom(root, seed);
  const lockBefore = await lockBytes(root);
  const indexBefore = await fs.readFile(path.join(root, 'references/index.json'));

  await fs.rm(path.join(root, 'references/upstream'), { recursive: true, force: true });
  await fs.rm(path.join(root, 'references/index.json'), { force: true });

  await assert.rejects(checkReferences(root), /restore/);
  assert.throws(() => searchReferences(root, 'world info'), /restore/);

  const fetcher = urlFetcher(seed);
  const result = await restoreReferences({ root, fetcher });
  assert.equal(result.fetched, 4);
  assert.equal(result.reused, 0);
  assert.equal(result.files, 4);
  assert.equal(result.sources, 2);
  assert.equal(result.indexRebuilt, true);

  assert.ok(fetcher.calls.length >= 4);
  assert.ok(fetcher.calls.every(url => url.startsWith('https://raw.githubusercontent.com/')), '只走 raw 地址');
  assert.ok(fetcher.calls.every(url => url.includes('/' + COMMIT + '/')), '只用锁定的完整提交');
  assert.ok(fetcher.calls.every(url => !url.includes('api.github.com')), '不使用 GitHub tree/commits API');

  assert.deepEqual(await lockBytes(root), lockBefore, '锁文件内容与时间不变');
  assert.equal(sha256(await fs.readFile(path.join(root, 'references/upstream/demo-docs/guide.md'))), sha256(seed.get('demo/docs/guide.md')));
  assert.equal(sha256(await fs.readFile(path.join(root, 'references/upstream/extra/LICENSE'))), sha256(seed.get('extra/LICENSE')));

  const summary = await checkReferences(root);
  assert.equal(summary.files, 4);
  const found = await searchReferences(root, 'world info');
  assert.equal(found.matched, 1);
  assert.deepEqual(await fs.readFile(path.join(root, 'references/index.json')), indexBefore, '重建的索引与锁一致');
});

test('restore 复用已校验文件，不重复下载；索引可单独重建', async () => {
  const seed = seedMap();
  const root = await fixture();
  await lockFrom(root, seed);
  const lockBefore = await lockBytes(root);

  const reuse = urlFetcher(seed);
  const again = await restoreReferences({ root, fetcher: reuse });
  assert.equal(again.fetched, 0);
  assert.equal(again.reused, 4);
  assert.equal(again.indexRebuilt, false, '索引已一致时不重写');
  assert.equal(reuse.calls.length, 0, '完整缓存下不应联网');

  await fs.rm(path.join(root, 'references/index.json'), { force: true });
  const rebuild = await restoreReferences({ root, fetcher: urlFetcher(seed) });
  assert.equal(rebuild.fetched, 0);
  assert.equal(rebuild.indexRebuilt, true);
  await checkReferences(root);
  assert.deepEqual(await lockBytes(root), lockBefore);
});

test('restore --source 只还原指定来源，其它来源可缺', async () => {
  const seed = seedMap();
  const root = await fixture();
  await lockFrom(root, seed);
  await fs.rm(path.join(root, 'references/upstream'), { recursive: true, force: true });
  await fs.rm(path.join(root, 'references/index.json'), { force: true });

  const onlyExtra = await restoreReferences({ root, fetcher: urlFetcher(seed), only: 'extra' });
  assert.equal(onlyExtra.sources, 1);
  assert.equal(onlyExtra.fetched, 1);
  assert.ok(fss.existsSync(path.join(root, 'references/upstream/extra/LICENSE')));
  assert.ok(!fss.existsSync(path.join(root, 'references/upstream/demo')), '未选中的来源不还原');
  await checkReferences(root, { sources: new Set(['extra']) });

  const onlyDemo = await restoreReferences({ root, fetcher: urlFetcher(seed), only: 'demo' });
  assert.equal(onlyDemo.fetched, 3);
  const summary = await checkReferences(root);
  assert.equal(summary.files, 4);
});

test('restore 下载失败时不损伤旧缓存并清理暂存目录', async () => {
  const seed = seedMap();
  const root = await fixture();
  await lockFrom(root, seed);
  const lockBefore = await lockBytes(root);

  const guide = path.join(root, 'references/upstream/demo-docs/guide.md');
  await fs.writeFile(guide, textFile('# Guide\n\n本地缓存被改动，需要重新取回。\n'));
  const before = await snapshot(root);

  const broken = urlFetcher(seed, { fail: key => key === 'demo/docs/guide.md' });
  await assert.rejects(restoreReferences({ root, fetcher: broken }), /注入的下载失败/);
  assert.deepEqual(await snapshot(root), before, '失败后资料与索引保持原样');
  assert.deepEqual(await lockBytes(root), lockBefore);
  assert.deepEqual(leftover(root), [], '不残留 staging/backup 目录');
});

test('restore 拒绝与锁记录不一致的内容且不落地', async () => {
  const seed = seedMap();
  const original = seed.get('demo/docs/guide.md');
  const cases = [
    { override: textFile('x'), pattern: /长度/ },
    { override: Buffer.alloc(original.length, 0x23), pattern: /sha256/ },
  ];
  for (const { override, pattern } of cases) {
    const root = await fixture();
    await lockFrom(root, seed);
    await fs.rm(path.join(root, 'references/upstream'), { recursive: true, force: true });
    await fs.rm(path.join(root, 'references/index.json'), { force: true });

    const wrong = urlFetcher(seed, { override: new Map([['demo/docs/guide.md', override]]) });
    await assert.rejects(restoreReferences({ root, fetcher: wrong }), pattern);
    assert.ok(!fss.existsSync(path.join(root, 'references/upstream')), '失败后不落地半成品');
    assert.deepEqual(leftover(root), []);
  }
});

test('restore 拒绝越界路径、漂移映射与坏哈希的锁记录', async () => {
  const seed = seedMap();
  const root = await fixture();
  await lockFrom(root, seed);
  const lockPath = path.join(root, 'maintenance/references.lock.json');
  const baseline = await fs.readFile(lockPath);
  await fs.rm(path.join(root, 'references/upstream'), { recursive: true, force: true });

  const mutate = async change => {
    const lock = JSON.parse(baseline.toString('utf8'));
    change(lock);
    await fs.writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
  };

  await mutate(lock => { lock.sources.demo.files['docs/guide.md'].local = '../escaped.md'; });
  await assert.rejects(restoreReferences({ root, fetcher: urlFetcher(seed) }), /路径越界/);
  assert.ok(!fss.existsSync(path.resolve(root, '..', 'escaped.md')));

  await mutate(lock => { lock.sources.demo.files['docs/guide.md'].local = 'references/upstream/demo-docs/other.md'; });
  await assert.rejects(restoreReferences({ root, fetcher: urlFetcher(seed) }), /漂移/);

  await mutate(lock => { lock.sources.demo.files['docs/guide.md'].sha256 = 'zz'; });
  await assert.rejects(restoreReferences({ root, fetcher: urlFetcher(seed) }), /sha256 无效/);

  await fs.writeFile(lockPath, baseline);
});

test('restore 不信任符号链接缓存，重新取回普通文件', async t => {
  const seed = seedMap();
  const root = await fixture();
  await lockFrom(root, seed);
  const target = path.join(root, 'outside-guide.md');
  await fs.writeFile(target, seed.get('demo/docs/guide.md'));
  const link = path.join(root, 'references/upstream/demo-docs/guide.md');
  await fs.rm(link, { force: true });
  try { await fs.symlink(target, link, 'file'); }
  catch (error) { t.skip('当前环境不支持创建符号链接: ' + error.code); return; }

  // 只有符号链接那一条需要下载，其余都应命中复用；未命中就抛错。
  const fetcher = urlFetcher(seed, { fail: key => key !== 'demo/docs/guide.md' });
  const result = await restoreReferences({ root, fetcher });
  assert.equal(result.fetched, 1);
  assert.equal(result.reused, 3);
  assert.equal(fetcher.calls.length, 1);

  const stat = fss.lstatSync(link);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), '符号链接被替换为普通文件');
  assert.equal(sha256(await fs.readFile(link)), sha256(seed.get('demo/docs/guide.md')));
});

test('parseArgs 识别 restore 与 --source', () => {
  const parsed = parseArgs(['restore', '--source', 'demo', '--source=extra']);
  assert.equal(parsed.command, 'restore');
  assert.deepEqual(parsed.sources, ['demo', 'extra']);
});

test('restore 在缺锁文件时给出清楚提示', async () => {
  const root = await fixture();
  await assert.rejects(restoreReferences({ root, fetcher: async () => Buffer.alloc(0) }), /references\.lock\.json/);
});

test('按来源检索只返回选中来源，混合未知来源不能静默忽略', async () => {
  const root = await fixture(); const seed = seedMap();
  await lockFrom(root, seed);
  assert.equal(searchReferences(root, 'World Info', { sources: ['extra'] }).shown, 0);
  const result = searchReferences(root, 'World Info', { sources: ['demo'] });
  assert.equal(result.shown, 1);
  assert.equal(result.results[0].file, 'references/upstream/demo-docs/guide.md');
  await assert.rejects(restoreReferences({ root, only: ['demo', 'not-a-source'], fetcher: urlFetcher(seed) }), /未知来源/);
});

test('索引写入失败且目录回滚被占用时，最后一份旧缓存保留在备份', async () => {
  const root = await fixture(); const seed = seedMap();
  await lockFrom(root, seed);
  const guide = path.join(root, 'references/upstream/demo-docs/guide.md');
  await fs.writeFile(guide, 'old cached guide');
  const rename = fss.renameSync;
  fss.renameSync = (from, to) => {
    if (String(from).includes('index.json.tmp-') || String(from).includes('.backup-restore-')) throw new Error('simulated locked destination');
    return rename(from, to);
  };
  try { await assert.rejects(restoreReferences({ root, fetcher: urlFetcher(seed) }), /保留备份目录/); }
  finally { fss.renameSync = rename; }
  const backups = (await fs.readdir(path.join(root, 'references'))).filter(name => name.startsWith('.backup-restore-'));
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(path.join(root, 'references', backups[0], 'demo-docs/guide.md'), 'utf8'), 'old cached guide');
});
