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
    const render = regexes.find(r => r.scriptName === 'Embedded status panel');
    const strip = regexes.find(r => r.scriptName === 'Remove status placeholder (prompt only)');
    const message = 'Narrative\n<StatusPlaceHolderImpl/>';
    assert.equal(applyRegexFixture({ ...render, replaceString: '[Panel]' }, message), 'Narrative\n[Panel]');
    assert.equal(applyRegexFixture(strip, message), 'Narrative\n');
    assert.ok(render.markdownOnly && !render.promptOnly);
    assert.ok(!strip.markdownOnly && strip.promptOnly);
    assert.equal(regexes.some(r => r.scriptName.includes('no interface')), false);
    assert.equal((await checkProject(name, root)).report.ok, true);
  }
});

test('standalone interfaces retain their own placeholder production path', async t => {
  const root = await workspace(t);
  await newCard('standalone', { root, modules: ['html'] });
  const { card } = await loadProject('standalone', root);
  assert.ok(card.data.first_mes.endsWith('<CardStatus/>'));
  const output = card.data.character_book.entries.find(e => e.comment === 'Status panel output position');
  assert.ok(output.enabled && output.constant && output.content.includes('<CardStatus/>'));
  assert.equal(output.extensions.position, 4);
  const regex = card.data.extensions.regex_scripts.find(r => r.markdownOnly);
  assert.equal(applyRegexFixture({ ...regex, replaceString: '[Panel]' }, '<CardStatus/>'), '[Panel]');
});

test('worldbook defaults separate setting, geography, characters and depth rules without recursion', async t => {
  const root = await workspace(t);
  await newCard('world', { root, modules: ['worldbook'] });
  const { card } = await loadProject('world', root);
  const entries = card.data.character_book.entries;
  assert.deepEqual(entries.map(e => e.extensions.position), [0, 0, 0, 1, 1, 4]);
  assert.deepEqual(entries.map(e => e.constant), [true, true, false, true, false, true]);
  assert.ok(entries.every(e => e.extensions.exclude_recursion && e.extensions.prevent_recursion));
  assert.deepEqual(entries.map(e => e.insertion_order), [1, 2, 3, 4, 5, 6]);
  assert.ok(entries[3].insertion_order < entries[4].insertion_order);
  assert.equal(entries[5].extensions.depth, 1);
  assert.equal(entries[5].extensions.role, 0);
  assert.deepEqual((await checkProject('world', root)).report.errors, []);
});

test('official MVU samples render or hide the framework marker without a model-output entry', async () => {
  for (const name of ['example-mvu', 'example-mvu-vue', 'example-mvu-zod-vue', 'example-fogharbor-bureau']) {
    const { card } = await loadProject(name);
    const messages = [card.data.first_mes, ...card.data.alternate_greetings];
    assert.ok(messages.every(message => !message.includes('<CardStatus/>')), name);
    assert.ok(card.data.character_book.entries.every(entry => !entry.content.includes('<CardStatus/>') && !entry.content.includes('<StatusPlaceHolderImpl/>')), name);
    const regexes = card.data.extensions.regex_scripts;
    const render = regexes.find(regex => regex.markdownOnly && !regex.disabled && regex.findRegex.includes('StatusPlaceHolderImpl'));
    const strip = regexes.find(regex => regex.promptOnly && !regex.disabled && regex.findRegex.includes('StatusPlaceHolderImpl'));
    assert.ok(render && strip, name);
    assert.equal(applyRegexFixture({ ...render, replaceString: '[State]' }, 'Narrative\n<StatusPlaceHolderImpl/>'), 'Narrative\n[State]', name);
    assert.equal(applyRegexFixture(strip, 'Narrative\n<StatusPlaceHolderImpl/>'), 'Narrative\n', name);
  }
});
