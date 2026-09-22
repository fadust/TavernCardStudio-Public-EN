// refs 命令的检索、校验与更新回滚测试。
// 只使用公开接口：tools/refs.mjs 的 loadConfig/checkReferences/updateReferences/searchReferences。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { checkReferences, searchReferences, updateReferences, loadConfig, sha256, request } from '../tools/refs.mjs';

const COMMIT = 'a'.repeat(40);

/** 注入的取数函数：只解析 ref 到固定提交，不联网。 */
const fetcher = async () => ({ sha: COMMIT });
const OLD_COMMIT = 'b'.repeat(40);

test('HTTP 层保留空模板文件，由来源校验决定是否允许', async t => {
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  globalThis.fetch = async () => new Response('', { status: 200 });
  assert.deepEqual(await request('https://example.test/empty.ts', { attempts: 1, token: null }), Buffer.alloc(0));
  await assert.rejects(request('https://example.test/data.json', { json: true, attempts: 1, token: null }));
});

function textFile(body) { return Buffer.from(body, 'utf8'); }

/** 最小来源配置：demo 两个文件、extra 一个文件。files 使用上游到本地的显式映射。 */
function fixtureConfig() {
  return {
    schemaVersion: 1,
    sources: [
      {
        id: 'demo', repository: 'example/demo', ref: 'main', dest: 'demo',
        license: { spdx: 'MIT', source: 'demo/LICENSE' },
        files: ['LICENSE', 'docs/:-> references/upstream/demo-docs/'],
        include: ['re:\.(md|txt|json)$', 're:(^|/)LICENSE$'],
        exclude: [],
        required: ['LICENSE', 'docs/guide.md'],
      },
      {
        id: 'extra', repository: 'example/extra', ref: 'main', dest: 'extra',
        license: { spdx: 'MIT', source: 'extra/LICENSE' },
        files: ['LICENSE'],
        include: [],
        exclude: [],
        required: ['LICENSE'],
      },
    ],
  };
}

function fixtureSeed(overrides = {}) {
  return new Map(Object.entries({
    'demo/LICENSE': textFile('MIT License\n\nCopyright (c) 2026 Demo\n'),
    'demo/docs/guide.md': textFile('# Guide\n\nWorld Info entries use keys and content.\n'),
    'demo/docs/api.json': textFile('{"ok":true}\n'),
    'extra/LICENSE': textFile('MIT License\n\nCopyright (c) 2026 Extra\n'),
    ...overrides,
  }));
}

async function fixture(seed = fixtureSeed(), config = fixtureConfig()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tavern-refs-'));
  await fs.mkdir(path.join(root, 'maintenance'), { recursive: true });
  await fs.writeFile(path.join(root, 'maintenance/reference-sources.json'), JSON.stringify(config, null, 2) + '\n');
  return { root, seed };
}

function readerFor(seed) {
  return (source, commit) => {
    const files = {};
    for (const [key, bytes] of seed) {
      const prefix = source.id + '/';
      if (!key.startsWith(prefix)) continue;
      files[key.slice(prefix.length)] = bytes;
    }
    return Object.keys(files).length ? { commit, files } : null;
  };
}


test('种子更新生成非空索引，条目指向资料路径且内容可检索', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });

  const index = JSON.parse(await fs.readFile(path.join(root, 'references/index.json'), 'utf8'));
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.files.length, 4, '索引必须列出全部锁定资料，不能为空');
  assert.deepEqual([...new Set(index.files.map(item => item.source))].sort(), ['demo', 'extra']);

  const guide = index.files.find(item => item.local === 'references/upstream/demo-docs/guide.md');
  assert.ok(guide, '索引条目使用工作区资料路径');
  assert.equal(guide.upstreamPath, 'docs/guide.md');
  assert.equal(guide.sha256, sha256(seed.get('demo/docs/guide.md')));
  assert.equal(guide.bytes, seed.get('demo/docs/guide.md').length);
  assert.equal(guide.commit, COMMIT);
  assert.ok(guide.symbols.includes('Guide'), '索引保留可检索的符号');
  assert.ok(index.files.every(item => item.local.startsWith('references/upstream/') && item.sha256.length === 64));

  const summary = await checkReferences(root);
  assert.equal(summary.files, 4);
  const found = await searchReferences(root, 'world info');
  assert.equal(found.matched, 1);
  assert.equal(found.results[0].file, guide.local);

  // 手改索引会被 check 发现，而不是因为索引为空而"通过"。
  index.files = [];
  await fs.writeFile(path.join(root, 'references/index.json'), JSON.stringify(index, null, 2) + '\n');
  await assert.rejects(checkReferences(root), /index\.json 缺失或过期/);
});


test('索引缺失或为空时 update 会补写，不重切资料', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  const before = await snapshot(root);

  const indexFile = path.join(root, 'references/index.json');
  await fs.writeFile(indexFile, JSON.stringify({ schemaVersion: 1, sources: [], files: [] }, null, 2) + '\n');
  const repaired = await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  assert.equal(repaired.changed, 0);
  assert.equal(repaired.indexRepaired, true);

  const index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
  assert.equal(index.files.length, 4);
  await checkReferences(root);
  const after = await snapshot(root);
  assert.deepEqual({ ...after, 'references/index.json': before['references/index.json'] }, before, '只改索引，不动资料与锁文件');
});

/** 记录临时根目录（含锁文件、索引与资料）的快照，用于回滚断言。 */
async function snapshot(root) {
  const output = {};
  const walk = async dir => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else output[path.relative(root, full).split(path.sep).join('/')] = sha256(await fs.readFile(full));
    }
  };
  if (fss.existsSync(root)) await walk(root);
  return output;
}

test('种子更新写入锁文件、资料与索引，check 通过且内容可检索', async () => {
  const { root, seed } = await fixture();
  const result = await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  assert.equal(result.changed, 2);
  assert.equal(result.files, 4);

  const lock = JSON.parse(await fs.readFile(path.join(root, 'maintenance/references.lock.json'), 'utf8'));
  assert.equal(lock.sources.demo.commit, COMMIT);
  assert.equal(lock.sources.demo.license.spdx, 'MIT');
  assert.equal(lock.sources.demo.licenseFile, 'LICENSE');
  assert.equal(lock.sources.demo.files['docs/guide.md'].local, 'references/upstream/demo-docs/guide.md');
  assert.equal(lock.sources.demo.files['docs/guide.md'].sha256, sha256(seed.get('demo/docs/guide.md')));
  assert.match(lock.sources.demo.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);

  const summary = await checkReferences(root);
  assert.equal(summary.sources, 2);
  assert.equal(summary.files, 4);

  const found = await searchReferences(root, 'world info');
  assert.equal(found.matched, 1);
  assert.match(found.results[0].file, /references\/upstream\/demo-docs\/guide\.md$/);
  assert.equal(found.results[0].line, 3);
});

test('相同输入重复更新不产生变化，且不重写已有资料', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  const before = await snapshot(root);
  const again = await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  assert.equal(again.changed, 0);
  assert.deepEqual(await snapshot(root), before);
});

test('校验失败时资料、锁文件与索引一起回滚', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  const before = await snapshot(root);

  const changed = fixtureSeed({ 'demo/docs/guide.md': textFile('# Guide\n\nWorld Info entries changed.\n') });
  await assert.rejects(
    updateReferences({ root, fetcher, readOffline: readerFor(changed), validate: () => { throw new Error('校验失败'); } }),
    /校验失败/,
  );
  assert.deepEqual(await snapshot(root), before);
  await checkReferences(root);
});

test('缺少必需文件或空内容时保留旧资料并报错', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  const before = await snapshot(root);

  const missing = fixtureSeed();
  missing.delete('demo/docs/guide.md');
  await assert.rejects(updateReferences({ root, fetcher, readOffline: readerFor(missing) }), /缺少必需文件/);

  const empty = fixtureSeed({ 'demo/docs/api.json': Buffer.alloc(0) });
  await assert.rejects(updateReferences({ root, fetcher, readOffline: readerFor(empty) }), /上游文件为空/);

  assert.deepEqual(await snapshot(root), before);
  await checkReferences(root);
});

test('异步校验失败同样回滚资料、锁文件与索引', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  const before = await snapshot(root);

  const changed = fixtureSeed({ 'demo/docs/guide.md': textFile('# Guide\n\n异步校验会失败。\n') });
  await assert.rejects(
    updateReferences({
      root,
      fetcher,
      readOffline: readerFor(changed),
      validate: async () => { await new Promise(resolve => setTimeout(resolve, 5)); throw new Error('异步校验失败'); },
    }),
    /异步校验失败/,
  );
  assert.deepEqual(await snapshot(root), before);
  await checkReferences(root);
});

test('含空格与中文的路径下 CLI 入口仍会执行', async () => {
  const { root, seed } = await fixture();
  const cliTest = path.join(root, '含 空格 目录', 'entry.test.mjs');
  await fs.mkdir(path.dirname(cliTest), { recursive: true });
  const cliPath = path.resolve(import.meta.dirname, '../tools/refs.mjs').split(path.sep).join('/');
  await fs.writeFile(cliTest, [
    'import { spawnSync } from \'node:child_process\';',
    'const result = spawnSync(process.execPath, [' + JSON.stringify(cliPath) + ', \'verify-sources\'], { encoding: \'utf8\', windowsHide: true });',
    'if (!result.stdout.includes(\'character-card-spec-v3\')) { console.error(result.stdout + result.stderr); process.exit(1); }',
    'process.stdout.write(\'ok\');',
    '',
  ].join('\n'));
  const run = spawnSync(process.execPath, [cliTest], { encoding: 'utf8', windowsHide: true, cwd: path.dirname(cliTest) });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^ok/);
});

test('check 能发现资料被改动与锁文件漂移', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });

  const file = path.join(root, 'references/upstream/demo-docs/guide.md');
  const original = await fs.readFile(file);
  await fs.writeFile(file, Buffer.concat([original, Buffer.from('\n新增一行\n')]));
  await assert.rejects(checkReferences(root), /资料内容被改动/);
  await fs.writeFile(file, original);

  const lockFile = path.join(root, 'maintenance/references.lock.json');
  const lock = JSON.parse(await fs.readFile(lockFile, 'utf8'));
  lock.sources.demo.commit = OLD_COMMIT;
  await fs.writeFile(lockFile, JSON.stringify(lock, null, 2) + '\n');
  await assert.rejects(checkReferences(root), /锁记录的 commit|index\.json 缺失或过期|资料内容被改动/);
});

test('路径越界与非法配置被拒绝', async () => {
  const bad = fixtureConfig();
  bad.sources[0].files = ['LICENSE', 'docs/:-> ../../outside'];
  const { root } = await fixture(fixtureSeed(), bad);
  await assert.rejects(loadConfig(root), /路径越界/);

  const escape = fixtureConfig();
  escape.sources[0].files = ['LICENSE', '../secret:-> demo-docs/'];
  const second = await fixture(fixtureSeed(), escape);
  await assert.rejects(loadConfig(second.root), /路径越界/);
});

test('只更新指定来源时不动其他来源的锁定内容', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  const before = await snapshot(root);
  const result = await updateReferences({ root, fetcher, readOffline: readerFor(seed), only: 'demo' });
  assert.equal(result.changed, 0);
  assert.deepEqual(await snapshot(root), before);
  const lock = JSON.parse(await fs.readFile(path.join(root, 'maintenance/references.lock.json'), 'utf8'));
  assert.equal(lock.sources.extra.commit, COMMIT);
});
