import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../tools/lib/files.mjs';
import { newCard } from '../tools/lib/templates.mjs';
import { loadProject } from '../tools/lib/project.mjs';

async function workspace(t) {
  await fs.mkdir(path.join(ROOT, 'work'), { recursive: true });
  const root = await fs.mkdtemp(path.join(ROOT, 'work/test-project-retry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const windows = { skip: process.platform !== 'win32' };

test('new project installation tolerates transient Windows directory locks', windows, async t => {
  const root = await workspace(t);
  const rename = fs.rename.bind(fs); let attempts = 0;
  t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === path.join(root, 'cards/可恢复') && ++attempts <= 2) throw Object.assign(new Error('temporary sharing failure'), { code: 'EPERM' });
    return rename(source, destination);
  });
  await newCard('可恢复', { root });
  assert.equal(attempts, 3);
  assert.equal((await loadProject('可恢复', root)).card.data.name, '可恢复');
  assert.deepEqual(await fs.readdir(path.join(root, 'cards')), ['可恢复']);
});

test('permanent denial stops after bounded attempts and leaves no partial project', windows, async t => {
  const root = await workspace(t); let attempts = 0;
  t.mock.method(fs, 'rename', async () => {
    attempts++;
    throw Object.assign(new Error('denied'), { code: 'EACCES' });
  });
  await assert.rejects(newCard('被拒绝', { root }), { code: 'EACCES' });
  assert.equal(attempts, 4);
  assert.deepEqual(await fs.readdir(path.join(root, 'cards')), []);
});

test('a destination appearing during retry is preserved without another rename', windows, async t => {
  const root = await workspace(t); let attempts = 0;
  t.mock.method(fs, 'rename', async (_source, destination) => {
    attempts++;
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, 'existing.txt'), 'keep');
    throw Object.assign(new Error('sharing failure'), { code: 'EBUSY' });
  });
  await assert.rejects(newCard('已有编辑', { root }), /拒绝覆盖/);
  assert.equal(attempts, 1);
  assert.equal(await fs.readFile(path.join(root, 'cards/已有编辑/existing.txt'), 'utf8'), 'keep');
  assert.deepEqual(await fs.readdir(path.join(root, 'cards')), ['已有编辑']);
});
