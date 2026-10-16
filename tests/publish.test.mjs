import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { replaceFiles, publishDirectory } from '../tools/lib/publish.mjs';
import { write } from '../tools/lib/files.mjs';
import { auditResources, findResourceReferences } from '../tools/lib/resources.mjs';

// Dependency declarations and resource scanning gate publication: loaded external URLs must appear in dependencies.
// Authored content and local files must not remain as unresolved script, stylesheet, or jQuery loads in artifacts.
const PINNED = 'https://cdn.jsdelivr.net/gh/owner/card-assets@abc1234/dist/panel.js';
const pinned = { url: PINNED, purpose: '创作者自己的固定提交外链', version: 'abc1234' };

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tavern-publish-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const live = path.join(root, 'live'); const staging = path.join(root, 'staging'); const backup = path.join(root, 'backup');
  await write(path.join(live, 'old.png'), 'old avatar');
  await write(path.join(live, 'card.json'), 'old JSON');
  await write(path.join(staging, 'card.json'), 'new JSON');
  await write(path.join(staging, 'ui/index.html'), 'new HTML');
  return { root, live, staging, backup };
}
test('file transaction updates existing artifacts and removes obsolete PNG', async t => {
  const { live, staging, backup } = await setup(t);
  assert.equal(await replaceFiles(staging, live, backup), 'file-transaction');
  assert.equal(await fs.readFile(path.join(live, 'card.json'), 'utf8'), 'new JSON');
  assert.equal(await fs.readFile(path.join(live, 'ui/index.html'), 'utf8'), 'new HTML');
  await assert.rejects(fs.access(path.join(live, 'old.png')));
  await assert.rejects(fs.access(backup));
});
test('failed file installation restores earlier artifacts', async t => {
  const { live, staging, backup } = await setup(t);
  // A directory at a target file name forces a real installation failure after a prior file was installed.
  await fs.mkdir(path.join(live, 'ui/index.html'), { recursive: true });
  await assert.rejects(replaceFiles(staging, live, backup));
  assert.equal(await fs.readFile(path.join(live, 'card.json'), 'utf8'), 'old JSON');
  assert.equal(await fs.readFile(path.join(live, 'old.png'), 'utf8'), 'old avatar');
  await assert.rejects(fs.access(backup));
});
test('ordinary directory publication writes all staged outputs', async t => {
  const { live, staging, backup } = await setup(t);
  await publishDirectory(staging, live, backup);
  assert.equal(await fs.readFile(path.join(live, 'card.json'), 'utf8'), 'new JSON');
  await assert.rejects(fs.access(backup));
});

const jqueryOptions = '$.ajax({ url: ' + JSON.stringify(PINNED) + ', dataType: "script" });';

test('jQuery ajax and get loaders reach the dependency audit', async () => {
  const undeclared = await auditResources(jqueryOptions, { file: 'src/scripts/panel.js', javascript: true, bundled: true });
  assert.equal(undeclared.errors.length, 1);
  assert.match(undeclared.errors[0], /undeclared external resource/);
  const declared = await auditResources(jqueryOptions, { file: 'src/scripts/panel.js', javascript: true, bundled: true, dependencies: [pinned] });
  assert.deepEqual(declared.errors, []);
  assert.deepEqual(declared.external, [PINNED]);
  const shorthand = await auditResources('$.get(' + JSON.stringify(PINNED) + ');', { file: 'src/scripts/panel.js', javascript: true, bundled: true });
  assert.match(shorthand.errors[0], /undeclared external resource/);
});
test('relative and variable jQuery addresses warn without failing the audit', async () => {
  const relative = await auditResources("$.get('/api/status');", { file: 'src/scripts/panel.js', javascript: true, bundled: true });
  assert.deepEqual(relative.errors, []);
  assert.equal(relative.warnings.length, 1);
  const variable = await auditResources('$.getJSON(endpoint);', { file: 'src/scripts/panel.js', javascript: true, bundled: true });
  assert.deepEqual(variable.errors, []);
  assert.equal(variable.warnings.length, 1);
  const unrelated = await auditResources("const selected = cache.get('user:1');", { file: 'src/scripts/panel.js', javascript: true });
  assert.deepEqual(unrelated.errors, []);
  assert.deepEqual(unrelated.warnings, []);
  const options = await auditResources("$.ajax({ type: 'POST', data: body });", { file: 'src/scripts/panel.js', javascript: true });
  assert.deepEqual(options.warnings, []);
});

test('literal non-network protocols in jQuery loaders still reach resource validation', async () => {
  for (const url of ['file:///private/panel.js', 'ftp://assets.example/panel.js']) {
    const report = await auditResources(`$.get(${JSON.stringify(url)});`, { file: 'src/scripts/panel.js', javascript: true, bundled: true });
    assert.ok(report.errors.length > 0, url);
  }
  const nonLoader = findResourceReferences("cache.get('https://example.com/key');", { javascript: true });
  assert.deepEqual(nonLoader.references, []);
});
test('URL construction is not a resource load', async t => {
  const { root } = await setup(t);
  const code = "const icon = new URL('./assets/icon.svg', import.meta.url);";
  assert.deepEqual(findResourceReferences(code, { javascript: true }).references, []);
  assert.deepEqual((await auditResources(code, { file: 'src/scripts/panel.js', dir: root, javascript: true })).errors, []);
  assert.deepEqual((await auditResources(code, { file: 'src/scripts/panel.js', javascript: true, bundled: true })).errors, []);
});
test('blob addresses warn and protocol-relative links match their https declaration', async () => {
  const blob = await auditResources('<video src="blob:https://tavern.example/9d1f0c"></video>', { file: 'src/ui/panel.html' });
  assert.deepEqual(blob.errors, []);
  assert.equal(blob.warnings.length, 1);
  const relative = await auditResources('<script src="//cdn.jsdelivr.net/gh/owner/card-assets@abc1234/dist/panel.js"></script>', { file: 'src/ui/panel.html', bundled: true, dependencies: [pinned] });
  assert.deepEqual(relative.errors, []);
  const undeclared = await auditResources('<script src="//cdn.example.com/lib@1.0.0.js"></script>', { file: 'src/ui/panel.html' });
  assert.match(undeclared.errors[0], /undeclared external resource/);
});
