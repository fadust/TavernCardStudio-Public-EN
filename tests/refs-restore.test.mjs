// refs restore uses pinned references and an offline injected fetcher.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { restoreReferences, updateReferences, checkReferences, searchReferences, sha256, parseArgs } from '../tools/refs.mjs';

// Only injected fetchers are allowed; real network access fails immediately.
const realFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('refs restore tests must not access the network'); };
test.after(() => { globalThis.fetch = realFetch; });

const COMMIT = 'a'.repeat(40);
const OFFLINE_FETCHER = async () => ({ sha: COMMIT });
const REPOS = { 'example/demo': 'demo', 'example/extra': 'extra' };
const createdRoots = [];
test.after(async () => {
  const prefix = path.resolve(os.tmpdir()) + path.sep + 'tavern-refs-restore-';
  for (const root of createdRoots) {
    if (!path.resolve(root).startsWith(prefix)) throw new Error('Test cleanup path escapes the workspace');
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

/** Injected URL fetcher accepts only raw.githubusercontent.com/<repo>/<commit>/<path> and records all calls. */
function urlFetcher(seed, { fail = null, override = null } = {}) {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    const match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([a-f0-9]{40})\/(.+)$/.exec(url);
    if (!match) throw new Error('restore requested a non-raw URL: ' + url);
    const [, repo, commit, encoded] = match;
    if (commit !== COMMIT) throw new Error('restore did not use the pinned full commit: ' + url);
    const upstream = encoded.split('/').map(decodeURIComponent).join('/');
    const key = REPOS[repo] + '/' + upstream;
    if (fail && fail(key)) throw new Error('Injected download failure: ' + key);
    if (override && override.has(key)) return override.get(key);
    if (!seed.has(key)) throw new Error('Seed entry missing: ' + key);
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

test('restore repairs missing caches without changing the lockfile and rebuilds the index', async () => {
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
  assert.ok(fetcher.calls.every(url => url.startsWith('https://raw.githubusercontent.com/')), 'Only raw URLs are requested');
  assert.ok(fetcher.calls.every(url => url.includes('/' + COMMIT + '/')), 'Only full pinned commits are used');
  assert.ok(fetcher.calls.every(url => !url.includes('api.github.com')), 'No GitHub tree or commits API requests');

  assert.deepEqual(await lockBytes(root), lockBefore, 'Lockfile content and timestamps remain unchanged');
  assert.equal(sha256(await fs.readFile(path.join(root, 'references/upstream/demo-docs/guide.md'))), sha256(seed.get('demo/docs/guide.md')));
  assert.equal(sha256(await fs.readFile(path.join(root, 'references/upstream/extra/LICENSE'))), sha256(seed.get('extra/LICENSE')));

  const summary = await checkReferences(root);
  assert.equal(summary.files, 4);
  const found = await searchReferences(root, 'world info');
  assert.equal(found.matched, 1);
  assert.deepEqual(await fs.readFile(path.join(root, 'references/index.json')), indexBefore, 'Rebuilt index matches the lockfile');
});

test('restore reuses verified files and can rebuild the index separately', async () => {
  const seed = seedMap();
  const root = await fixture();
  await lockFrom(root, seed);
  const lockBefore = await lockBytes(root);

  const reuse = urlFetcher(seed);
  const again = await restoreReferences({ root, fetcher: reuse });
  assert.equal(again.fetched, 0);
  assert.equal(again.reused, 4);
  assert.equal(again.indexRebuilt, false, 'Do not rewrite a matching index');
  assert.equal(reuse.calls.length, 0, 'A complete cache needs no network access');

  await fs.rm(path.join(root, 'references/index.json'), { force: true });
  const rebuild = await restoreReferences({ root, fetcher: urlFetcher(seed) });
  assert.equal(rebuild.fetched, 0);
  assert.equal(rebuild.indexRebuilt, true);
  await checkReferences(root);
  assert.deepEqual(await lockBytes(root), lockBefore);
});

test('restore --source restores selected sources independently', async () => {
  const seed = seedMap();
  const root = await fixture();
  await lockFrom(root, seed);
  await fs.rm(path.join(root, 'references/upstream'), { recursive: true, force: true });
  await fs.rm(path.join(root, 'references/index.json'), { force: true });

  const onlyExtra = await restoreReferences({ root, fetcher: urlFetcher(seed), only: 'extra' });
  assert.equal(onlyExtra.sources, 1);
  assert.equal(onlyExtra.fetched, 1);
  assert.ok(fss.existsSync(path.join(root, 'references/upstream/extra/LICENSE')));
  assert.ok(!fss.existsSync(path.join(root, 'references/upstream/demo')), 'Unselected sources are not restored');
  await checkReferences(root, { sources: new Set(['extra']) });

  const onlyDemo = await restoreReferences({ root, fetcher: urlFetcher(seed), only: 'demo' });
  assert.equal(onlyDemo.fetched, 3);
  const summary = await checkReferences(root);
  assert.equal(summary.files, 4);
});

test('restore download failures preserve old cache and remove staging directories', async () => {
  const seed = seedMap();
  const root = await fixture();
  await lockFrom(root, seed);
  const lockBefore = await lockBytes(root);

  const guide = path.join(root, 'references/upstream/demo-docs/guide.md');
  await fs.writeFile(guide, textFile('# Guide\n\nLocal cache was modified and must be fetched again.\n'));
  const before = await snapshot(root);

  const broken = urlFetcher(seed, { fail: key => key === 'demo/docs/guide.md' });
  await assert.rejects(restoreReferences({ root, fetcher: broken }), /Injected download failure/);
  assert.deepEqual(await snapshot(root), before, 'References and index remain unchanged after failure');
  assert.deepEqual(await lockBytes(root), lockBefore);
  assert.deepEqual(leftover(root), [], 'No leftover staging or backup directories');
});

test('restore rejects content that differs from lock records before writing', async () => {
  const seed = seedMap();
  const original = seed.get('demo/docs/guide.md');
  const cases = [
    { override: textFile('x'), pattern: /byte count/ },
    { override: Buffer.alloc(original.length, 0x23), pattern: /sha256/ },
  ];
  for (const { override, pattern } of cases) {
    const root = await fixture();
    await lockFrom(root, seed);
    await fs.rm(path.join(root, 'references/upstream'), { recursive: true, force: true });
    await fs.rm(path.join(root, 'references/index.json'), { force: true });

    const wrong = urlFetcher(seed, { override: new Map([['demo/docs/guide.md', override]]) });
    await assert.rejects(restoreReferences({ root, fetcher: wrong }), pattern);
    assert.ok(!fss.existsSync(path.join(root, 'references/upstream')), 'No partial files remain after failure');
    assert.deepEqual(leftover(root), []);
  }
});

test('restore rejects escaping paths, drifted mappings, and invalid hashes', async () => {
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
  await assert.rejects(restoreReferences({ root, fetcher: urlFetcher(seed) }), /Path escapes the workspace/);
  assert.ok(!fss.existsSync(path.resolve(root, '..', 'escaped.md')));

  await mutate(lock => { lock.sources.demo.files['docs/guide.md'].local = 'references/upstream/demo-docs/other.md'; });
  await assert.rejects(restoreReferences({ root, fetcher: urlFetcher(seed) }), /has drifted/);

  await mutate(lock => { lock.sources.demo.files['docs/guide.md'].sha256 = 'zz'; });
  await assert.rejects(restoreReferences({ root, fetcher: urlFetcher(seed) }), /Invalid lock record sha256/);

  await fs.writeFile(lockPath, baseline);
});

test('restore replaces untrusted symlink cache files with regular files', async t => {
  const seed = seedMap();
  const root = await fixture();
  await lockFrom(root, seed);
  const target = path.join(root, 'outside-guide.md');
  await fs.writeFile(target, seed.get('demo/docs/guide.md'));
  const link = path.join(root, 'references/upstream/demo-docs/guide.md');
  await fs.rm(link, { force: true });
  try { await fs.symlink(target, link, 'file'); }
  catch (error) { t.skip('This environment cannot create symlinks: ' + error.code); return; }

  // Only the symlinked file needs downloading; fail if other files are not reused.
  const fetcher = urlFetcher(seed, { fail: key => key !== 'demo/docs/guide.md' });
  const result = await restoreReferences({ root, fetcher });
  assert.equal(result.fetched, 1);
  assert.equal(result.reused, 3);
  assert.equal(fetcher.calls.length, 1);

  const stat = fss.lstatSync(link);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Symlink was replaced with a regular file');
  assert.equal(sha256(await fs.readFile(link)), sha256(seed.get('demo/docs/guide.md')));
});

test('parseArgs recognizes restore and --source', () => {
  const parsed = parseArgs(['restore', '--source', 'demo', '--source=extra']);
  assert.equal(parsed.command, 'restore');
  assert.deepEqual(parsed.sources, ['demo', 'extra']);
});

test('restore reports a missing lockfile clearly', async () => {
  const root = await fixture();
  await assert.rejects(restoreReferences({ root, fetcher: async () => Buffer.alloc(0) }), /references\.lock\.json/);
});

test('Source search returns selected sources and rejects unknown sources', async () => {
  const root = await fixture(); const seed = seedMap();
  await lockFrom(root, seed);
  assert.equal(searchReferences(root, 'World Info', { sources: ['extra'] }).shown, 0);
  const result = searchReferences(root, 'World Info', { sources: ['demo'] });
  assert.equal(result.shown, 1);
  assert.equal(result.results[0].file, 'references/upstream/demo-docs/guide.md');
  await assert.rejects(restoreReferences({ root, only: ['demo', 'not-a-source'], fetcher: urlFetcher(seed) }), /Unknown source/);
});

test('Keep the last old cache backup if index writing and directory rollback fail', async () => {
  const root = await fixture(); const seed = seedMap();
  await lockFrom(root, seed);
  const guide = path.join(root, 'references/upstream/demo-docs/guide.md');
  await fs.writeFile(guide, 'old cached guide');
  const rename = fss.renameSync;
  fss.renameSync = (from, to) => {
    if (String(from).includes('index.json.tmp-') || String(from).includes('.backup-restore-')) throw new Error('simulated locked destination');
    return rename(from, to);
  };
  try { await assert.rejects(restoreReferences({ root, fetcher: urlFetcher(seed) }), /Keep the backup directory/); }
  finally { fss.renameSync = rename; }
  const backups = (await fs.readdir(path.join(root, 'references'))).filter(name => name.startsWith('.backup-restore-'));
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(path.join(root, 'references', backups[0], 'demo-docs/guide.md'), 'utf8'), 'old cached guide');
});
