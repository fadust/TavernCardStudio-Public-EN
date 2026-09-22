import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { replaceFiles, publishDirectory } from '../tools/lib/publish.mjs';
import { write } from '../tools/lib/files.mjs';

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
