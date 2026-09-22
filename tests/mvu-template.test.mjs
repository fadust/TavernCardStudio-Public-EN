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
const ENTRY_NAMES = ['变量列表', '[mvu_update]变量更新规则', '[mvu_update]变量输出格式', '[initvar]变量初始化勿开'];
const REGEX_NAMES = ['折叠变量更新块（仅显示）', '折叠未闭合变量更新块（仅显示，流式）', '屏蔽变量更新块（仅提示词）', '屏蔽未闭合变量更新块（仅提示词，流式）'];

async function workspace(t) {
  await fs.mkdir(path.join(ROOT, 'work'), { recursive: true });
  const dir = await fs.mkdtemp(path.join(ROOT, 'work/test-mvu-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

// 只执行受信任的仓库模板：把模板文件编译后在 vm 里跑，并注入仓库里锁定的那份 zod。
// 导入卡（split 进来的卡）的脚本、schema 与界面代码一律不执行。
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

test('mvu 模板生成四个标准条目、固定依赖与注册脚本', async t => {
  const root = await workspace(t);
  const dir = await newCard('MVU模板', { root, modules: ['mvu'] });
  const { project, card } = await loadProject('MVU模板', root);

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
  assert.ok(entries.every(e => e.constant === true), '四个标准条目都要是蓝灯（constant）');
  assert.ok(entries.every(e => e.extensions.exclude_recursion === true && e.extensions.prevent_recursion === true));
  assert.equal(entries[3].enabled, false, '[initvar] 条目保持禁用');
  assert.equal(entries[3].extensions.position, 0);
  assert.equal(entries[3].insertion_order, 4);
  assert.deepEqual(entries.slice(0, 3).map(e => [e.extensions.position, e.extensions.depth, e.extensions.role, e.insertion_order]), [[4, 0, 0, 1], [4, 0, 0, 2], [4, 0, 0, 3]]);

  const regexes = card.data.extensions.regex_scripts;
  assert.deepEqual(regexes.slice(0, 4).map(r => r.scriptName), REGEX_NAMES);
  assert.deepEqual(regexes.slice(0, 4).map(r => [r.markdownOnly, r.promptOnly, r.placement]), [[true, false, [1, 2]], [true, false, [1, 2]], [false, true, [1, 2]], [false, true, [1, 2]]]);
  for (const markerRegex of regexes.slice(4)) assert.equal(applyRegexFixture(markerRegex, '正文\n<StatusPlaceHolderImpl/>'), '正文\n');
  assert.deepEqual(regexes.slice(4).map(r => [r.markdownOnly, r.promptOnly]), [[true, false], [false, true]]);

  const scripts = card.data.extensions.tavern_helper.scripts;
  assert.deepEqual(scripts.map(s => s.name), ['MVU 框架（固定提交）', '变量结构（zod 注册）']);
  assert.match(scripts[0].content, /MagVarUpdate@3377b494/);
  assert.ok(scripts[1].content.includes('StageDog/tavern_resource@' + HELPER_COMMIT + '/dist/util/mvu_zod.js'));
  assert.match(scripts[1].content, /registerMvuSchema\(Schema\)/);
  // 注册要尽早：照上游写法在 $() 里同步注册，不能先等 Mvu 就绪，否则可能错过初始化事件。
  assert.match(scripts[1].content, /\$\(\(\) => \{/);
  assert.ok(!scripts[1].content.includes('await'), '注册脚本不能 await');
  assert.ok(!scripts[1].content.includes('waitGlobalInitialized'), '注册不依赖 Mvu 初始化完成');

  for (const name of ['schema.ts', 'variables/schema.json']) await fs.stat(path.join(dir, 'src', name));
  // 世界书正文的实际位置由 src/index.yaml 与条目配置决定，不在这里写死目录布局。
  const worldbook = [];
  for (const file of (await readYAML(dir, 'src/index.yaml')).世界书.条目) worldbook.push(await readYAML(dir, file));
  assert.deepEqual(worldbook.map(config => config.名称), ENTRY_NAMES, '世界书条目顺序与模板一致');
  for (const config of worldbook) await fs.stat(path.join(dir, config.文件));
  const variables = await fs.readFile(path.join(dir, worldbook[0].文件), 'utf8');
  assert.match(variables, /\{\{format_message_variable::stat_data\}\}/);
  const format = await fs.readFile(path.join(dir, worldbook[2].文件), 'utf8');
  assert.match(format, /^变量输出格式:/m);
  assert.match(format, /^  rule:/m);
  assert.match(format, /^  format: \|-/m);
  assert.match(format, /<Analysis>\$\(IN ENGLISH, no more than 80 words\)/);
  assert.match(format, /"op": "delta", "path": "[^"]+", "value": 1/);
  assert.match(format, /"op": "move", "from": "[^"]+", "to": "[^"]+"/);
  assert.match(format, /never write the stat_data\. prefix/);
  for (const op of ['replace', 'delta', 'insert', 'remove', 'move']) assert.ok(format.includes(op), '缺少 op ' + op);

  const report = await checkProject('MVU模板', root);
  assert.deepEqual(report.report.errors, []);
  assert.equal(report.report.ok, true);
  assert.equal(report.report.regexFixtures, (await readJSON(path.join(TEMPLATE_DIR, 'module.json'))).fixtures.length);
});

test('模板引擎保留位置与角色，并在组合模块后生成全局编号', async t => {
  const root = await workspace(t);
  await newCard('引擎', { root, modules: ['worldbook', 'regex', 'mvu'] });
  const { card } = await loadProject('引擎', root);

  const plain = card.data.character_book.entries.find(e => e.comment === '世界观');
  assert.deepEqual([plain.position, plain.insertion_order, plain.extensions.position, plain.extensions.depth, plain.extensions.role], ['before_char', 1, 0, 4, 0]);
  const keyword = card.data.character_book.entries.find(e => e.comment === '旧书店');
  assert.deepEqual([keyword.constant, keyword.keys], [false, ['旧书店']]);
  const depthEntry = card.data.character_book.entries.find(e => e.comment === '[mvu_update]变量更新规则');
  assert.deepEqual([depthEntry.position, depthEntry.insertion_order, depthEntry.extensions.position, depthEntry.extensions.depth, depthEntry.extensions.role], ['after_char', 8, 4, 0, 0]);

  const note = card.data.extensions.regex_scripts.find(r => r.scriptName === '显示备注');
  assert.deepEqual([note.placement, note.markdownOnly, note.promptOnly, note.runOnEdit, note.substituteRegex, note.minDepth, note.maxDepth], [[2], true, false, true, 0, null, null]);
  const strip = card.data.extensions.regex_scripts.find(r => r.scriptName === '屏蔽变量更新块（仅提示词）');
  assert.deepEqual([strip.placement, strip.replaceString], [[1, 2], '']);
});

test('mvu 卡构建：结构随注册脚本内联，zod 不随卡打包', async t => {
  const root = await workspace(t);
  const dir = await newCard('MVU构建', { root, modules: ['mvu'] });
  assert.equal(await fs.readFile(path.join(dir, 'src/schema.ts'), 'utf8'), await fs.readFile(path.join(TEMPLATE_DIR, 'schema.ts'), 'utf8'));

  const built = await buildCard('MVU构建', root);
  assert.deepEqual(built.files, ['scripts/1.js', 'MVU构建.json']);
  const report = await readJSON(path.join(built.directory, 'build-report.json'));
  assert.equal(report.dependencies.length, 2);
  assert.equal(report.checks.realTavern, 'not-tested');

  const card = await readJSON(path.join(built.directory, 'MVU构建.json'));
  const register = card.data.extensions.tavern_helper.scripts[1].content;
  assert.ok(register.includes('StageDog/tavern_resource@' + HELPER_COMMIT + '/dist/util/mvu_zod.js'));
  assert.match(register, /registerMvuSchema\(Schema\)/);
  assert.match(register, /z\.object\(/);
  assert.match(register, /prefault\(/);
  assert.ok(!register.includes('from "../schema'), '本地结构已经内联，不能再残留相对导入');
  assert.ok(!register.includes('"zod"') && !register.includes("'zod'"), '注册脚本不能引入另一份 zod');
  assert.ok(!register.includes('require('));
  assert.ok(register.length < 4000, '注册脚本应该很薄，zod 由宿主提供');
  assert.match(card.data.extensions.tavern_helper.scripts[0].content, /@3377b494cd7277230f3056230062124fe117f93f/);
});

test('schema 初值解析、夹值与重复解析幂等（只执行仓库模板）', async t => {
  const root = await workspace(t);
  const dir = await newCard('MVU结构', { root, modules: ['mvu'] });
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
  assert.deepEqual(Schema.parse({ 角色: { 信任: 150 } }).角色, { 心情: '平静', 信任: 100 });
  assert.equal(Schema.parse({ 角色: { 信任: -5 } }).角色.信任, 0);
  assert.equal(Schema.parse({ 角色: { 信任: '42' } }).角色.信任, 42);
  assert.equal(Schema.safeParse({ 场景: { 地点: 42 } }).success, false, '字符串字段不做隐式转换，不符合结构的更新会被丢弃');

  const messy = { 场景: { 地点: '旧书店' }, 角色: { 心情: '紧张', 信任: 130 }, 额外字段: true };
  const once = Schema.parse(messy);
  assert.equal(once.角色.信任, 100);
  assert.deepEqual(Schema.parse(once), once, '解析结果必须是自己的合法输入');
  assert.deepEqual(Schema.parse(Schema.parse(Schema.parse(messy))), once);

  const reference = await readJSON(path.join(TEMPLATE_DIR, 'schema.json'));
  const generated = z.toJSONSchema(Schema, { io: 'input' });
  if (!isDeepStrictEqual(generated, reference)) {
    assert.fail('schema.json 与 z.toJSONSchema(Schema, { io: "input" }) 不一致，请用下面这段覆盖 templates/modules/mvu/schema.json：\n' + JSON.stringify(generated, null, 2));
  }
  assert.match(reference.title + reference.description, /投影/);
  assert.match(reference.description, /registerMvuSchema/);
});

test('正则覆盖完整块、未闭合块与多块，且只影响显示或提示词', async t => {
  const root = await workspace(t);
  await newCard('MVU正则', { root, modules: ['mvu'] });
  const { card } = await loadProject('MVU正则', root);
  const regexes = card.data.extensions.regex_scripts.filter(r => r.scriptName.includes('变量更新块'));
  const fold = regexes.filter(r => r.markdownOnly);
  const strip = regexes.filter(r => r.promptOnly);
  assert.equal(fold.length, 2);
  assert.equal(strip.length, 2);
  assert.ok(regexes.every(r => r.markdownOnly || r.promptOnly), '只允许改显示或只允许改提示词；两个开关都关会改写来源消息');
  assert.ok(regexes.every(r => r.markdownOnly !== r.promptOnly && r.placement.join() === '1,2'));

  const blockA = '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/场景/地点","value":"旧书店"}]</JSONPatch></UpdateVariable>';
  const blockB = '<UpdateVariable>\n<JSONPatch>[{"op":"delta","path":"/角色/信任","value":3}]</JSONPatch>\n</UpdateVariable>';
  const blockC = '<UpdateVariable>\n<JSONPatch>[{"op":"insert","path":"/角色/-","value":"x"}]';
  const mixed = '开场。\n' + blockA + '\n中间。\n' + blockB + '\n结尾。\n' + blockC;

  const shown = applyAll(fold, mixed);
  assert.equal((shown.match(/<details><summary>变量更新<\/summary>/g) || []).length, 3);
  assert.ok(!shown.includes('<UpdateVariable>'));
  assert.match(shown, /^开场。/);
  assert.match(shown, /中间。/);
  assert.match(shown, /结尾。/);
  assert.match(shown, /\n\n<\/details>/);

  const prompted = applyAll(strip, mixed);
  assert.ok(!prompted.includes('<UpdateVariable>'));
  assert.ok(!prompted.includes('<JSONPatch>'));
  assert.equal(prompted, '开场。\n\n中间。\n\n结尾。\n');

  const single = applyRegexFixture(fold[0], blockA);
  assert.match(single, /^<details><summary>变量更新<\/summary>/);
  assert.ok(!single.includes('<UpdateVariable>'));
  assert.doesNotMatch(card.data.first_mes, /<details>/);
});

test('check 与 build 都不执行卡内 schema', async t => {
  const root = await workspace(t);
  const dir = await newCard('MVU副作用', { root, modules: ['mvu'] });
  const schemaFile = path.join(dir, 'src/schema.ts');
  await fs.writeFile(schemaFile, 'globalThis.__mvuSchemaRan = true;\nthrow new Error("卡内 schema 不该被执行");\nexport const Schema = z.object({});\n');
  assert.equal((await checkProject('MVU副作用', root)).report.ok, true, '只做语法转换，不执行');
  assert.equal(globalThis.__mvuSchemaRan, undefined);
  const built = await buildCard('MVU副作用', root);
  assert.ok(built.files.includes('scripts/1.js'));
  assert.equal(globalThis.__mvuSchemaRan, undefined, '构建只打包，不运行卡内代码');
  await fs.writeFile(schemaFile, 'export const Schema = ;\n');
  assert.equal((await checkProject('MVU副作用', root)).report.ok, false, '语法错误要报出来');
});

test('固定依赖与 NOTES 证据一致，每条正则都有 fixture', async () => {
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
  for (const regex of spec.regex) assert.ok(spec.fixtures.some(f => f.name === regex.scriptName), regex.scriptName + ' 缺少 fixture');
  assert.match(spec.regex[0].findRegex, /update\(\?:variable\)\?/);
});
