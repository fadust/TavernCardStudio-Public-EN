import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../tools/lib/files.mjs';
import { newCard } from '../tools/lib/templates.mjs';
import { loadProject } from '../tools/lib/project.mjs';
import { applyRegexFixture, checkProject } from '../tools/lib/validation.mjs';

async function workspace(t) {
  await fs.mkdir(path.join(ROOT, 'work'), { recursive: true });
  const root = await fs.mkdtemp(path.join(ROOT, 'work/test-defaults-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('MVU interfaces consume the framework marker regardless of module order', async t => {
  const root = await workspace(t);
  for (const modules of [['mvu', 'vue'], ['vue', 'mvu'], ['mvu', 'html'], ['html', 'mvu']]) {
    const name = modules.join('-');
    await newCard(name, { root, modules });
    const { card } = await loadProject(name, root);
    assert.ok(!card.data.first_mes.includes('<CardStatus/>'));
    assert.ok(!card.data.first_mes.includes('<StatusPlaceHolderImpl/>'));
    assert.ok(!card.data.first_mes.includes('{{char}}'));
    assert.ok(!card.data.character_book.entries.some(e => e.content.includes('<CardStatus/>') || e.content.includes('<StatusPlaceHolderImpl/>')));
    const regexes = card.data.extensions.regex_scripts;
    const render = regexes.find(r => r.scriptName === '内嵌状态栏');
    const strip = regexes.find(r => r.scriptName === '屏蔽状态栏占位（仅提示词）');
    const message = '正文\n<StatusPlaceHolderImpl/>';
    assert.equal(applyRegexFixture({ ...render, replaceString: '[面板]' }, message), '正文\n[面板]');
    assert.equal(applyRegexFixture(strip, message), '正文\n');
    assert.ok(render.markdownOnly && !render.promptOnly);
    assert.ok(!strip.markdownOnly && strip.promptOnly);
    assert.equal(regexes.some(r => r.scriptName.includes('无界面')), false);
    assert.equal((await checkProject(name, root)).report.ok, true);
  }
});

test('standalone interfaces retain their own placeholder production path', async t => {
  const root = await workspace(t);
  await newCard('独立', { root, modules: ['html'] });
  const { card } = await loadProject('独立', root);
  assert.ok(card.data.first_mes.endsWith('<CardStatus/>'));
  const output = card.data.character_book.entries.find(e => e.comment === '状态栏输出位置');
  assert.ok(output.enabled && output.constant && output.content.includes('<CardStatus/>'));
  assert.equal(output.extensions.position, 4);
  const regex = card.data.extensions.regex_scripts.find(r => r.markdownOnly);
  assert.equal(applyRegexFixture({ ...regex, replaceString: '[面板]' }, '<CardStatus/>'), '[面板]');
});

test('worldbook defaults separate setting, geography, characters and depth rules without recursion', async t => {
  const root = await workspace(t);
  await newCard('世界', { root, modules: ['worldbook'] });
  const { card } = await loadProject('世界', root);
  const entries = card.data.character_book.entries;
  assert.deepEqual(entries.map(e => e.extensions.position), [0, 0, 0, 1, 1, 4]);
  assert.deepEqual(entries.map(e => e.constant), [true, true, false, true, false, true]);
  assert.ok(entries.every(e => e.extensions.exclude_recursion && e.extensions.prevent_recursion));
  assert.ok(entries[0].insertion_order < entries[1].insertion_order && entries[1].insertion_order < entries[2].insertion_order);
  assert.ok(entries[3].insertion_order < entries[4].insertion_order);
  assert.equal(entries[5].extensions.depth, 1);
  assert.equal(entries[5].extensions.role, 0);
  assert.deepEqual((await checkProject('世界', root)).report.errors, []);
});

test('official MVU samples render or hide the framework marker without a model-output entry', async () => {
  for (const name of ['示例-MVU', '示例-MVU-Vue', '示例-MVU-Zod-Vue', '示例-雾港调查局']) {
    const { card } = await loadProject(name);
    const messages = [card.data.first_mes, ...card.data.alternate_greetings];
    assert.ok(messages.every(message => !message.includes('<CardStatus/>')), name);
    assert.ok(card.data.character_book.entries.every(entry => !entry.content.includes('<CardStatus/>') && !entry.content.includes('<StatusPlaceHolderImpl/>')), name);
    const regexes = card.data.extensions.regex_scripts;
    const render = regexes.find(regex => regex.markdownOnly && !regex.disabled && regex.findRegex.includes('StatusPlaceHolderImpl'));
    const strip = regexes.find(regex => regex.promptOnly && !regex.disabled && regex.findRegex.includes('StatusPlaceHolderImpl'));
    assert.ok(render && strip, name);
    assert.equal(applyRegexFixture({ ...render, replaceString: '[状态]' }, '正文\n<StatusPlaceHolderImpl/>'), '正文\n[状态]', name);
    assert.equal(applyRegexFixture(strip, '正文\n<StatusPlaceHolderImpl/>'), '正文\n', name);
  }
});
