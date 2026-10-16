import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { ROOT, write } from '../tools/lib/files.mjs';
import { newCard } from '../tools/lib/templates.mjs';
import { loadProject, semanticDiff } from '../tools/lib/project.mjs';
import { readYAML, writeYAML } from '../tools/lib/authoring.mjs';
import { normalizeAuthoring, normalizeAuthoringDocument } from '../tools/lib/authoring-language.mjs';
import { normalizeCard } from '../tools/inspect-card.mjs';
import { createOperations } from '../tools/lib/studio-operations.mjs';

test('new projects use English settings and legacy YAML remains lossless', async t => {
  await fs.mkdir(path.join(ROOT, 'work'), { recursive: true });
  const root = await fs.mkdtemp(path.join(ROOT, 'work/test-localization-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = await newCard('english-card', { root, modules: ['worldbook', 'script'] });
  const before = await loadProject('english-card', root);
  const index = await readYAML(dir, 'src/index.yaml');
  assert.deepEqual(Object.keys(index), ['character', 'text', 'alternate_greetings', 'group_only_greetings', 'worldbook', 'regex', 'scripts', 'helper_variables']);
  assert.doesNotMatch(await fs.readFile(path.join(dir, 'src/index.yaml'), 'utf8'), /\p{Script=Han}/u);
  const entryFile = index.worldbook.entries[0];
  const settings = await readYAML(dir, entryFile);
  assert.equal(settings.activation, 'constant');
  assert.equal(settings.position, 'before_character');
  const indexBytes = await fs.readFile(path.join(dir, 'src/index.yaml'), 'utf8');
  await write(path.join(dir, 'src/index.yaml'), indexBytes.replace(/^character:/m, '角色:').replace(/^text:/m, '文本:').replace(/^worldbook:/m, '世界书:').replace(/^  entries:/m, '  条目:'));
  const entryBytes = await fs.readFile(path.join(dir, entryFile), 'utf8');
  await write(path.join(dir, entryFile), entryBytes.replace(/^name:/m, '名称:').replace(/^activation: constant/m, '激活: 蓝灯').replace(/^position: before_character/m, '位置: 角色定义之前').replace(/^role: system/m, '角色: 系统'));
  assert.deepEqual(semanticDiff(before.card, (await loadProject('english-card', root)).card), []);

  // Arbitrary script data is not authoring metadata, even when its keys look familiar.
  const scriptFile = index.scripts[0];
  const script = await readYAML(dir, scriptFile);
  script.data_file = 'src/scripts/payload.data.yaml';
  delete script.data;
  const payload = { 名称: '角色', 类型: '脚本', nested: { 数据: '蓝灯' }, constructor: 'unchanged' };
  await writeYAML(dir, script.data_file, payload);
  await writeYAML(dir, scriptFile, script);
  assert.deepEqual((await loadProject('english-card', root)).card.data.extensions.tavern_helper.scripts[0].data, payload);
});

test('aliases reject ambiguous keys and preserve opaque user data and attachment labels', () => {
  assert.throws(() => normalizeAuthoring({ name: 'one', 名称: 'two' }), /Duplicate authoring setting: name/);
  assert.throws(() => normalizeAuthoringDocument(parseDocument('name: one\n名称: two\n'), 'entry'), /Duplicate authoring setting: name/);
  const data = { 名称: '用户内容', 角色: '原文', constructor: 'keep' };
  const config = normalizeAuthoring({ 角色: '系统', 数据: data, 附属文本: { 名称: { 文件: 'src/note.md' } } });
  assert.equal(config.role, 'system');
  assert.deepEqual(config.data, data);
  assert.deepEqual(normalizeAuthoring({ 数据: [data] }).data, [data]);
  assert.deepEqual(normalizeAuthoring({ 助手变量: [data] }, 'root').helper_variables, [data]);
  assert.deepEqual(config.attachments, { 名称: { file: 'src/note.md' } });
  assert.deepEqual(normalizeAuthoring({ 角色: { 名称: 'Original' }, 助手变量: data }, 'root'), { character: { name: 'Original' }, helper_variables: data });
  assert.deepEqual(normalizeAuthoring({ constructor: 'unchanged', type: 'constructor' }), { constructor: 'unchanged', type: 'constructor' });
});

test('legacy YAML document normalization preserves comments and role context', () => {
  const doc = parseDocument('# Entry settings\n名称: Original\n角色: 系统 # Host role\n数据:\n  名称: Unchanged\n');
  normalizeAuthoringDocument(doc, 'entry');
  assert.deepEqual(doc.toJS(), { name: 'Original', role: 'system', data: { 名称: 'Unchanged' } });
  assert.match(doc.toString(), /# Entry settings/);
  assert.match(doc.toString(), /# Host role/);
});

test('shared YAML anchors never translate opaque user payloads', () => {
  const doc = parseDocument('角色: &character\n  名称: Original\n文本:\n  第一条消息:\n    文件: src/text/first_mes.md\n    构建:\n      类型: &kind 脚本\n      入口: src/first.js\n助手变量:\n  snapshot: *character\n  classification: *kind # Keep the original value\n');
  normalizeAuthoringDocument(doc);
  const value = doc.toJS();
  assert.deepEqual(value.character, { name: 'Original' });
  assert.equal(value.text.first_mes.build.type, 'script');
  assert.deepEqual(value.helper_variables, { snapshot: { 名称: 'Original' }, classification: '脚本' });
  assert.match(doc.toString(), /# Keep the original value/);
  assert.throws(() => normalizeAuthoringDocument(parseDocument('data: &loop\n  recursive: *loop\n')), /Cyclic YAML aliases/);
});

test('English separator labels use whole words', () => {
  const card = { spec: 'chara_card_v2', data: { name: 'Labels', character_book: { entries: ['[Variables] ➡️ Start', '➡️ Weekend', '➡️ Friend'].map((comment, id) => ({ id, comment, content: '', keys: [] })) } } };
  assert.deepEqual(normalizeCard(card).entries.map(entry => entry.separator), [true, false, false]);
});

test('Studio renames legacy anchored metadata without changing user variables', async t => {
  const root = await fs.mkdtemp(path.join(ROOT, 'work/test-localization-rename-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = await newCard('legacy-anchors', { root });
  const indexFile = path.join(dir, 'src/index.yaml');
  const source = (await fs.readFile(indexFile, 'utf8')).replace(/^character:/m, '角色: &character').replace(/^  name:/m, '  名称:');
  await fs.writeFile(indexFile, source + '助手变量:\n  snapshot: *character\n');
  const before = await loadProject('legacy-anchors', root);
  const state = await fs.readFile(path.join(dir, '.card/state.json'));
  await createOperations({ root }).renameCard({ name: 'legacy-anchors', newName: 'legacy-anchors', characterName: 'English display name' });
  const after = await loadProject('legacy-anchors', root);
  assert.equal(after.card.data.name, 'English display name');
  assert.deepEqual(after.card.data.extensions.tavern_helper.variables, before.card.data.extensions.tavern_helper.variables);
  assert.deepEqual(await fs.readFile(path.join(dir, '.card/state.json')), state);
});
