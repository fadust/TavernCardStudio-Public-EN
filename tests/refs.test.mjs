// Reference search, verification, and update rollback tests.
// Use only public tools/refs.mjs APIs: loadConfig/checkReferences/updateReferences/searchReferences.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { checkReferences, searchReferences, updateReferences, loadConfig, sha256, request } from '../tools/refs.mjs';

const COMMIT = 'a'.repeat(40);

/** Injected fetcher resolves refs to a fixed commit without network access. */
const fetcher = async () => ({ sha: COMMIT });
const OLD_COMMIT = 'b'.repeat(40);

test('HTTP preserves empty template files for source validation', async t => {
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  globalThis.fetch = async () => new Response('', { status: 200 });
  assert.deepEqual(await request('https://example.test/empty.ts', { attempts: 1, token: null }), Buffer.alloc(0));
  await assert.rejects(request('https://example.test/data.json', { json: true, attempts: 1, token: null }));
});

function textFile(body) { return Buffer.from(body, 'utf8'); }

/** Minimal source configuration with explicit upstream-to-local mappings. */
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


test('Seed updates generate a nonempty searchable index with reference paths', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });

  const index = JSON.parse(await fs.readFile(path.join(root, 'references/index.json'), 'utf8'));
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.files.length, 4, 'Index must list all pinned references');
  assert.deepEqual([...new Set(index.files.map(item => item.source))].sort(), ['demo', 'extra']);

  const guide = index.files.find(item => item.local === 'references/upstream/demo-docs/guide.md');
  assert.ok(guide, 'Index entries use workspace reference paths');
  assert.equal(guide.upstreamPath, 'docs/guide.md');
  assert.equal(guide.sha256, sha256(seed.get('demo/docs/guide.md')));
  assert.equal(guide.bytes, seed.get('demo/docs/guide.md').length);
  assert.equal(guide.commit, COMMIT);
  assert.ok(guide.symbols.includes('Guide'), 'Index retains searchable symbols');
  assert.ok(index.files.every(item => item.local.startsWith('references/upstream/') && item.sha256.length === 64));

  const summary = await checkReferences(root);
  assert.equal(summary.files, 4);
  const found = await searchReferences(root, 'world info');
  assert.equal(found.matched, 1);
  assert.equal(found.results[0].file, guide.local);

  // check detects a manually emptied index.
  index.files = [];
  await fs.writeFile(path.join(root, 'references/index.json'), JSON.stringify(index, null, 2) + '\n');
  await assert.rejects(checkReferences(root), /index\.json is missing or stale/);
});


test('update rebuilds missing or empty indexes without replacing reference files', async () => {
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
  assert.deepEqual({ ...after, 'references/index.json': before['references/index.json'] }, before, 'Only the index changes; references and lockfile remain intact');
});

/** Snapshot the temporary root including lockfile, index, and references for rollback assertions. */
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

test('Seed update writes a searchable, verified lockfile, references, and index', async () => {
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

test('Repeated identical updates leave existing references unchanged', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  const before = await snapshot(root);
  const again = await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  assert.equal(again.changed, 0);
  assert.deepEqual(await snapshot(root), before);
});

test('Validation failure rolls back references, lockfile, and index', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  const before = await snapshot(root);

  const changed = fixtureSeed({ 'demo/docs/guide.md': textFile('# Guide\n\nWorld Info entries changed.\n') });
  await assert.rejects(
    updateReferences({ root, fetcher, readOffline: readerFor(changed), validate: () => { throw new Error('verification failed'); } }),
    /verification failed/,
  );
  assert.deepEqual(await snapshot(root), before);
  await checkReferences(root);
});

test('Missing required files or empty content preserves old references and fails', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  const before = await snapshot(root);

  const missing = fixtureSeed();
  missing.delete('demo/docs/guide.md');
  await assert.rejects(updateReferences({ root, fetcher, readOffline: readerFor(missing) }), /lack a required file/);

  const empty = fixtureSeed({ 'demo/docs/api.json': Buffer.alloc(0) });
  await assert.rejects(updateReferences({ root, fetcher, readOffline: readerFor(empty) }), /Upstream file is empty/);

  assert.deepEqual(await snapshot(root), before);
  await checkReferences(root);
});

test('Async validation failures roll back references, lockfile, and index', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  const before = await snapshot(root);

  const changed = fixtureSeed({ 'demo/docs/guide.md': textFile('# Guide\n\nAsync validation will fail.\n') });
  await assert.rejects(
    updateReferences({
      root,
      fetcher,
      readOffline: readerFor(changed),
      validate: async () => { await new Promise(resolve => setTimeout(resolve, 5)); throw new Error('Async verification failed'); },
    }),
    /Async verification failed/,
  );
  assert.deepEqual(await snapshot(root), before);
  await checkReferences(root);
});

test('CLI entry point supports paths containing spaces and Unicode', async () => {
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

test('check detects modified references and lockfile drift', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });

  const file = path.join(root, 'references/upstream/demo-docs/guide.md');
  const original = await fs.readFile(file);
  await fs.writeFile(file, Buffer.concat([original, Buffer.from('\nAdded line\n')]));
  await assert.rejects(checkReferences(root), /Reference content was modified/);
  await fs.writeFile(file, original);

  const lockFile = path.join(root, 'maintenance/references.lock.json');
  const lock = JSON.parse(await fs.readFile(lockFile, 'utf8'));
  lock.sources.demo.commit = OLD_COMMIT;
  await fs.writeFile(lockFile, JSON.stringify(lock, null, 2) + '\n');
  await assert.rejects(checkReferences(root), /Lock record commit|index\.json is missing or stale|Reference content was modified/);
});

test('Path escapes the workspaceand invalid configuration are rejected', async () => {
  const bad = fixtureConfig();
  bad.sources[0].files = ['LICENSE', 'docs/:-> ../../outside'];
  const { root } = await fixture(fixtureSeed(), bad);
  await assert.rejects(loadConfig(root), /Path escapes the workspace/);

  const escape = fixtureConfig();
  escape.sources[0].files = ['LICENSE', '../secret:-> demo-docs/'];
  const second = await fixture(fixtureSeed(), escape);
  await assert.rejects(loadConfig(second.root), /Path escapes the workspace/);
});

test('Updating selected sources preserves other pinned content', async () => {
  const { root, seed } = await fixture();
  await updateReferences({ root, fetcher, readOffline: readerFor(seed) });
  const before = await snapshot(root);
  const result = await updateReferences({ root, fetcher, readOffline: readerFor(seed), only: 'demo' });
  assert.equal(result.changed, 0);
  assert.deepEqual(await snapshot(root), before);
  const lock = JSON.parse(await fs.readFile(path.join(root, 'maintenance/references.lock.json'), 'utf8'));
  assert.equal(lock.sources.extra.commit, COMMIT);
});
