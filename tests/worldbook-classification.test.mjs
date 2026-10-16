import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { splitCard, loadProject } from '../tools/lib/project.mjs';
import { readYAML, writeYAML } from '../tools/lib/authoring.mjs';
import { organizeWorldbook } from '../tools/lib/organize.mjs';
import { worldbookInventory } from '../tools/lib/worldbook-inventory.mjs';
import { worldbookLocation, validateWorldbookFolder } from '../tools/lib/worldbook-layout.mjs';
import { main } from '../tools/card.mjs';

async function imported(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classification-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const name = '分类测试';
  const card = { spec: 'chara_card_v2', spec_version: '2.0', data: { name, extensions: {}, character_book: { entries: [
    { id: 43, comment: '雾岭', content: '位于北境的山岭。', keys: ['雾岭'], enabled: true, extensions: { position: 0, vendor: { keep: true } } },
    { id: 21, comment: '守望者', content: '守望者是一种鸟。', keys: ['守望者'], enabled: true, extensions: { position: 0 } },
  ] } } };
  const input = path.join(root, 'input.json');
  await fs.writeFile(input, JSON.stringify(card));
  const dir = await splitCard(input, { root, name });
  return { root, name, dir };
}

test('semantic category is authoring-only; organize follows the chosen nested category without altering card data', async t => {
  const { root, name, dir } = await imported(t);
  const before = await loadProject(name, root);
  const inventory = await worldbookInventory(before);
  assert.equal(inventory.classification.pending.length, 2);
  assert.ok(inventory.worldbook.every(row => !Object.hasOwn(row, 'content')));
  const file = inventory.worldbook[0].file;
  const config = await readYAML(dir, file);
  config.category = '地理/北境';
  await writeYAML(dir, file, config);
  const staged = await loadProject(name, root);
  assert.deepEqual(staged.card, before.card);
  const pending = await worldbookInventory(staged);
  assert.equal(pending.classification.pending.length, 1);
  assert.deepEqual(pending.classification.pendingMoves, [file]);
  const moved = await organizeWorldbook(name, root);
  assert.equal(moved.organized, true);
  const after = await loadProject(name, root);
  assert.deepEqual(after.card, before.card);
  const result = await worldbookInventory(after);
  assert.equal(result.worldbook[0].file, 'src/worldbook/地理/北境/雾岭.yaml');
  assert.equal(result.worldbook[0].directory, '地理/北境');
  assert.deepEqual(result.classification.pendingMoves, []);
  assert.equal(result.classification.pending.length, 1, 'tool must not pretend to classify the unreviewed bird');
  assert.equal((await organizeWorldbook(name, root)).organized, false);
  const backup = await readYAML(path.join(root, moved.backup), file);
  assert.equal(backup.category, '地理/北境');
});

test('classification rejects unsafe or non-string paths during load, before moving any files', async t => {
  const { root, name, dir } = await imported(t);
  const index = await readYAML(dir, 'src/index.yaml');
  const file = index.worldbook.entries[0];
  const original = await readYAML(dir, file);
  for (const category of ['../outside', '地理//北境', '地理\\北境', '/地理', 'CON', '地理/', '', 42, null]) {
    await writeYAML(dir, file, { ...original, category: category });
    await assert.rejects(() => loadProject(name, root), /Invalid worldbook category folder/);
    await fs.stat(path.join(dir, file));
  }
});

test('category maps do not mistake Object prototype properties for recognized titles', () => {
  for (const title of ['constructor', '__proto__', 'toString', 'constructor-甲']) {
    assert.equal(worldbookLocation(title).folder, "uncategorized");
  }
  assert.equal(validateWorldbookFolder('自然/种族'), '自然/种族');
});

test('map exposes actionable metadata; CLI keeps organize and explicit renumbering separate', async t => {
  const { root, name } = await imported(t);
  const mapped = await main(['map', name], root);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.results[0].classification.pending.length, 2);
  assert.equal(mapped.results[0].worldbook[0].name, '雾岭');
  assert.ok(!JSON.stringify(mapped).includes('位于北境的山岭'));
  await assert.rejects(() => main(['split', 'input.json', '--order', 'index'], root), /does not accept --order/);
  await assert.rejects(() => main(['new', '新卡', '--order', 'index'], root), /does not accept --order/);
  await assert.rejects(() => main(['organize', name, '--order', 'index'], root), /does not accept/);
  const invalid = await main(['arrange', name, '--order', 'oops'], root);
  assert.equal(invalid.ok, false);
  const ordered = await main(['arrange', name, '--order', 'index'], root);
  assert.equal(ordered.ok, true);
  assert.equal(ordered.results[0].order, 'index');
  assert.deepEqual((await loadProject(name, root)).card.data.character_book.entries.map(e => e.insertion_order), [1, 2]);
});
