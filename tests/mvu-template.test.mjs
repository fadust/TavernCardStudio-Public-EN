import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { isDeepStrictEqual } from 'node:util';
import { ROOT, readJSON } from '../tools/lib/files.mjs';
import { newCard } from '../tools/lib/templates.mjs';
import { buildCard } from '../tools/lib/build.mjs';
import { loadProject } from '../tools/lib/project.mjs';
import { readYAML } from '../tools/lib/authoring.mjs';
import { checkProject, applyRegexFixture } from '../tools/lib/validation.mjs';

const TEMPLATE_DIR = path.join(ROOT, 'templates/modules/mvu');
const MVU_COMMIT = '3377b494cd7277230f3056230062124fe117f93f';
const HELPER_COMMIT = '69abb272d46bed4057a0dfb31758f6164cb7ecef';
const HELPER_SHA256 = '78c40f52d81022d9d769a923a49e673b8babb562656051a7d0410b6b19f45184';
const ENTRY_NAMES = ['Variable list', '[mvu_update]Variable update rules', '[mvu_update]Variable output format', '[initvar]Initial variables - keep disabled'];
const REGEX_NAMES = ['Fold variable updates (display)', 'Fold incomplete variable updates (display, streaming)', 'Remove variable updates (prompt)', 'Remove incomplete variable updates (prompt, streaming)'];

async function workspace(t) {
  await fs.mkdir(path.join(ROOT, 'work'), { recursive: true });
  const dir = await fs.mkdtemp(path.join(ROOT, 'work/test-mvu-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

// Execute only reviewed repository templates with the locked host Zod instance; never imported card code.
async function loadTrustedSchema(file) {
  const { build } = await import('esbuild');
  const compiled = await build({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'neutral', logLevel: 'silent' });
  const { z } = await import('zod');
  const moduleObject = { exports: {} };
  const context = vm.createContext({ module: moduleObject, exports: moduleObject.exports, z, console });
  vm.runInContext(compiled.outputFiles[0].text, context, { filename: file });
  return { Schema: moduleObject.exports.Schema, z };
}

function applyAll(regexes, input) {
  return regexes.reduce((text, regex) => applyRegexFixture(regex, text), input);
}

test('MVU templates create four standard entries, pinned dependencies, and registration scripts', async t => {
  const root = await workspace(t);
  const dir = await newCard('mvu-template', { root, modules: ['mvu'] });
  const { project, card } = await loadProject('mvu-template', root);

  assert.deepEqual(project.modules, ['mvu']);
  assert.deepEqual(project.dependencies.map(d => d.url), [
    'https://cdn.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@' + MVU_COMMIT + '/artifact/bundle.js',
    'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource@' + HELPER_COMMIT + '/dist/util/mvu_zod.js',
  ]);
  assert.deepEqual(project.dependencies.map(d => d.version), [MVU_COMMIT, HELPER_COMMIT]);
  assert.deepEqual(project.builds, [{ kind: 'script', pointer: '/data/extensions/tavern_helper/scripts/1/content', entry: project.builds[0].entry }]);
  assert.match(project.builds[0].entry, /^src\/scripts\/002-.*\.js$/);

  const entries = card.data.character_book.entries;
  assert.deepEqual(entries.map(e => e.comment), ENTRY_NAMES);
  assert.ok(entries.every(e => e.constant === true), 'All four standard entries must be constant');
  assert.ok(entries.every(e => e.extensions.exclude_recursion === true && e.extensions.prevent_recursion === true));
  assert.equal(entries[3].enabled, false, 'Keep the [initvar] entry disabled');
  assert.equal(entries[3].extensions.position, 0);
  assert.equal(entries[3].insertion_order, 4);
  assert.deepEqual(entries.slice(0, 3).map(e => [e.extensions.position, e.extensions.depth, e.extensions.role, e.insertion_order]), [[4, 0, 0, 1], [4, 0, 0, 2], [4, 0, 0, 3]]);

  const regexes = card.data.extensions.regex_scripts;
  assert.deepEqual(regexes.slice(0, 4).map(r => r.scriptName), REGEX_NAMES);
  assert.deepEqual(regexes.slice(0, 4).map(r => [r.markdownOnly, r.promptOnly, r.placement]), [[true, false, [1, 2]], [true, false, [1, 2]], [false, true, [1, 2]], [false, true, [1, 2]]]);
  for (const markerRegex of regexes.slice(4)) assert.equal(applyRegexFixture(markerRegex, 'Narrative\n<StatusPlaceHolderImpl/>'), 'Narrative\n');
  assert.deepEqual(regexes.slice(4).map(r => [r.markdownOnly, r.promptOnly]), [[true, false], [false, true]]);

  const scripts = card.data.extensions.tavern_helper.scripts;
  assert.deepEqual(scripts.map(s => s.name), ['MVU framework (pinned commit)', 'Variable schema (Zod registration)']);
  assert.match(scripts[0].content, /MagVarUpdate@3377b494/);
  assert.ok(scripts[1].content.includes('StageDog/tavern_resource@' + HELPER_COMMIT + '/dist/util/mvu_zod.js'));
  assert.match(scripts[1].content, /registerMvuSchema\(Schema\)/);
    assert.match(scripts[1].content, /\$\(\(\) => \{/);
  assert.ok(!scripts[1].content.includes('await'), 'Registration must not await initialization');
  assert.ok(!scripts[1].content.includes('waitGlobalInitialized'), 'Registration does not depend on Mvu readiness');

  for (const name of ['schema.ts', 'variables/schema.json']) await fs.stat(path.join(dir, 'src', name));
    const worldbook = [];
  for (const file of (await readYAML(dir, 'src/index.yaml')).worldbook.entries) worldbook.push(await readYAML(dir, file));
  assert.deepEqual(worldbook.map(config => config.name), ENTRY_NAMES, 'Worldbook entry order must match the template');
  for (const config of worldbook) await fs.stat(path.join(dir, config.file));
  const variables = await fs.readFile(path.join(dir, worldbook[0].file), 'utf8');
  assert.match(variables, /\{\{format_message_variable::stat_data\}\}/);
  const format = await fs.readFile(path.join(dir, worldbook[2].file), 'utf8');
  assert.match(format, /^Variable output format:/m);
  assert.match(format, /^  rule:/m);
  assert.match(format, /^  format: \|-/m);
  assert.match(format, /<Analysis>\$\(IN ENGLISH, no more than 80 words\)/);
  assert.match(format, /"op": "delta", "path": "[^"]+", "value": 1/);
  assert.match(format, /"op": "move", "from": "[^"]+", "to": "[^"]+"/);
  assert.match(format, /never write the stat_data\. prefix/);
  for (const op of ['replace', 'delta', 'insert', 'remove', 'move']) assert.ok(format.includes(op), 'Missing operation ' + op);

  const report = await checkProject('mvu-template', root);
  assert.deepEqual(report.report.errors, []);
  assert.equal(report.report.ok, true);
  assert.equal(report.report.regexFixtures, (await readJSON(path.join(TEMPLATE_DIR, 'module.json'))).fixtures.length);
});

test('template composition preserves positions and roles and assigns global order', async t => {
  const root = await workspace(t);
  await newCard('engine', { root, modules: ['worldbook', 'regex', 'mvu'] });
  const { card } = await loadProject('engine', root);

  const plain = card.data.character_book.entries.find(e => e.comment === 'World setting');
  assert.deepEqual([plain.position, plain.insertion_order, plain.extensions.position, plain.extensions.depth, plain.extensions.role], ['before_char', 1, 0, 4, 0]);
  const keyword = card.data.character_book.entries.find(e => e.comment === 'Used bookshop');
  assert.deepEqual([keyword.constant, keyword.keys], [false, ['Used bookshop']]);
  const depthEntry = card.data.character_book.entries.find(e => e.comment === '[mvu_update]Variable update rules');
  assert.deepEqual([depthEntry.position, depthEntry.insertion_order, depthEntry.extensions.position, depthEntry.extensions.depth, depthEntry.extensions.role], ['after_char', 8, 4, 0, 0]);

  const note = card.data.extensions.regex_scripts.find(r => r.scriptName === 'Show notes');
  assert.deepEqual([note.placement, note.markdownOnly, note.promptOnly, note.runOnEdit, note.substituteRegex, note.minDepth, note.maxDepth], [[2], true, false, true, 0, null, null]);
  const strip = card.data.extensions.regex_scripts.find(r => r.scriptName === 'Remove variable updates (prompt)');
  assert.deepEqual([strip.placement, strip.replaceString], [[1, 2], '']);
});

test('MVU builds inline the schema without bundling Zod', async t => {
  const root = await workspace(t);
  const dir = await newCard('mvu-build', { root, modules: ['mvu'] });
  assert.equal(await fs.readFile(path.join(dir, 'src/schema.ts'), 'utf8'), await fs.readFile(path.join(TEMPLATE_DIR, 'schema.ts'), 'utf8'));

  const built = await buildCard('mvu-build', root);
  assert.deepEqual(built.files, ['scripts/1.js', 'mvu-build.json']);
  const report = await readJSON(path.join(built.directory, 'build-report.json'));
  assert.equal(report.dependencies.length, 2);
  assert.equal(report.checks.realTavern, 'not-tested');

  const card = await readJSON(path.join(built.directory, 'mvu-build.json'));
  const register = card.data.extensions.tavern_helper.scripts[1].content;
  assert.ok(register.includes('StageDog/tavern_resource@' + HELPER_COMMIT + '/dist/util/mvu_zod.js'));
  assert.match(register, /registerMvuSchema\(Schema\)/);
  assert.match(register, /z\.object\(/);
  assert.match(register, /prefault\(/);
  assert.ok(!register.includes('from "../schema'), 'The inlined schema must leave no relative import');
  assert.ok(!register.includes('"zod"') && !register.includes("'zod'"), 'Registration must not import another Zod instance');
  assert.ok(!register.includes('require('));
  assert.ok(register.length < 4000, 'The registration script stays small because the host supplies Zod');
  assert.match(card.data.extensions.tavern_helper.scripts[0].content, /@3377b494cd7277230f3056230062124fe117f93f/);
});

test('trusted template schemas parse defaults, clamp values, and parse idempotently', async t => {
  const root = await workspace(t);
  const dir = await newCard('mvu-schema', { root, modules: ['mvu'] });
  const schemaFile = path.join(TEMPLATE_DIR, 'schema.ts');
  const source = await fs.readFile(schemaFile, 'utf8');
  assert.equal(await fs.readFile(path.join(dir, 'src/schema.ts'), 'utf8'), source);
  assert.match(source, /import type \{ z as zod \} from 'zod';/);
  assert.doesNotMatch(source, /^\s*import \{[^}]+\} from 'zod';/m);
  assert.match(source, /export const Schema = z\s*\n\s*\.object\(/);
  assert.match(source, /declare const z: typeof zod;/);

  const { Schema, z } = await loadTrustedSchema(schemaFile);
  const initial = JSON.parse(await fs.readFile(path.join(TEMPLATE_DIR, 'initvar.json'), 'utf8'));
  assert.deepEqual(Schema.parse({}), initial);
  assert.deepEqual(Schema.parse(initial), initial);
  assert.deepEqual(Schema.parse({ character: { trust: 150 } }).character, { mood: 'Calm', trust: 100 });
  assert.equal(Schema.parse({ character: { trust: -5 } }).character.trust, 0);
  assert.equal(Schema.parse({ character: { trust: '42' } }).character.trust, 42);
  assert.equal(Schema.safeParse({ scene: { location: 42 } }).success, false, 'String fields must reject implicit coercion');

  const messy = { scene: { location: 'Used bookshop' }, character: { mood: 'Nervous', trust: 130 }, extraField: true };
  const once = Schema.parse(messy);
  assert.equal(once.character.trust, 100);
  assert.deepEqual(Schema.parse(once), once, 'Parsed output must be valid input');
  assert.deepEqual(Schema.parse(Schema.parse(Schema.parse(messy))), once);

  const reference = await readJSON(path.join(TEMPLATE_DIR, 'schema.json'));
  const generated = z.toJSONSchema(Schema, { io: 'input' });
  if (!isDeepStrictEqual(generated, reference)) {
    assert.fail('schema.json differs from z.toJSONSchema(Schema, { io: "input" }); update templates/modules/mvu/schema.json with:\n' + JSON.stringify(generated, null, 2));
  }
  assert.match(reference.title + reference.description, /projection/);
  assert.match(reference.description, /registerMvuSchema/);
});

test('regex handles complete, incomplete, and multiple blocks for display or prompts only', async t => {
  const root = await workspace(t);
  await newCard('mvu-regex', { root, modules: ['mvu'] });
  const { card } = await loadProject('mvu-regex', root);
  const regexes = card.data.extensions.regex_scripts.filter(r => r.scriptName.includes('variable updates'));
  const fold = regexes.filter(r => r.markdownOnly);
  const strip = regexes.filter(r => r.promptOnly);
  assert.equal(fold.length, 2);
  assert.equal(strip.length, 2);
  assert.ok(regexes.every(r => r.markdownOnly || r.promptOnly), 'A regex must affect only display or prompts; disabling both would rewrite stored messages');
  assert.ok(regexes.every(r => r.markdownOnly !== r.promptOnly && r.placement.join() === '1,2'));

  const blockA = '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/scene/location","value":"Used bookshop"}]</JSONPatch></UpdateVariable>';
  const blockB = '<UpdateVariable>\n<JSONPatch>[{"op":"delta","path":"/character/trust","value":3}]</JSONPatch>\n</UpdateVariable>';
  const blockC = '<UpdateVariable>\n<JSONPatch>[{"op":"insert","path":"/character/-","value":"x"}]';
  const mixed = 'Opening.\n' + blockA + '\nMiddle.\n' + blockB + '\nEnding.\n' + blockC;

  const shown = applyAll(fold, mixed);
  assert.equal((shown.match(/<details><summary>Variable update<\/summary>/g) || []).length, 3);
  assert.ok(!shown.includes('<UpdateVariable>'));
  assert.match(shown, /^Opening./);
  assert.match(shown, /Middle./);
  assert.match(shown, /Ending./);
  assert.match(shown, /\n\n<\/details>/);

  const prompted = applyAll(strip, mixed);
  assert.ok(!prompted.includes('<UpdateVariable>'));
  assert.ok(!prompted.includes('<JSONPatch>'));
  assert.equal(prompted, 'Opening.\n\nMiddle.\n\nEnding.\n');

  const single = applyRegexFixture(fold[0], blockA);
  assert.match(single, /^<details><summary>Variable update<\/summary>/);
  assert.ok(!single.includes('<UpdateVariable>'));
  assert.doesNotMatch(card.data.first_mes, /<details>/);
});

test('check and build never execute card schemas', async t => {
  const root = await workspace(t);
  const dir = await newCard('mvu-side-effects', { root, modules: ['mvu'] });
  const schemaFile = path.join(dir, 'src/schema.ts');
  await fs.writeFile(schemaFile, 'globalThis.__mvuSchemaRan = true;\nthrow new Error("Card schemas must not execute");\nexport const Schema = z.object({});\n');
  assert.equal((await checkProject('mvu-side-effects', root)).report.ok, true, 'Transform syntax without executing it');
  assert.equal(globalThis.__mvuSchemaRan, undefined);
  const built = await buildCard('mvu-side-effects', root);
  assert.ok(built.files.includes('scripts/1.js'));
  assert.equal(globalThis.__mvuSchemaRan, undefined, 'Build bundles without running card code');
  await fs.writeFile(schemaFile, 'export const Schema = ;\n');
  assert.equal((await checkProject('mvu-side-effects', root)).report.ok, false, 'Report syntax errors');
});

test('pinned dependencies match NOTES evidence and every regex has a fixture', async () => {
  const spec = await readJSON(path.join(TEMPLATE_DIR, 'module.json'));
  const notes = await fs.readFile(path.join(TEMPLATE_DIR, 'NOTES.md'), 'utf8');
  const helper = spec.dependencies.find(d => d.url.includes('tavern_resource'));
  const mvu = spec.dependencies.find(d => d.url.includes('MagVarUpdate'));
  assert.equal(helper.version, HELPER_COMMIT);
  assert.ok(helper.url.includes('@' + HELPER_COMMIT + '/'));
  assert.equal(mvu.version, MVU_COMMIT);
  assert.ok(mvu.url.includes('@' + MVU_COMMIT + '/'));
  assert.ok(notes.includes(HELPER_COMMIT));
  assert.ok(notes.includes(HELPER_SHA256));
  assert.ok(notes.includes(MVU_COMMIT));
  for (const regex of spec.regex) assert.ok(spec.fixtures.some(f => f.name === regex.scriptName), regex.scriptName + ' has no fixture');
  assert.match(spec.regex[0].findRegex, /update\(\?:variable\)\?/);
});
