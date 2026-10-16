import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { ROOT, readJSON, write, writeJSON } from '../tools/lib/files.mjs';
import { newCard } from '../tools/lib/templates.mjs';
import { buildCard, embedHTML } from '../tools/lib/build.mjs';
import { loadProject, splitCard } from '../tools/lib/project.mjs';
import { chunk, writeCardPNG, readCardPNG, parsePNG } from '../tools/lib/png.mjs';
import { checkProject, applyRegexFixture } from '../tools/lib/validation.mjs';
import { auditResources, findResourceReferences, validateDependencies } from '../tools/lib/resources.mjs';
import { main } from '../tools/card.mjs';
import { readYAML, writeYAML } from '../tools/lib/authoring.mjs';

async function workspace(t) {
  await fs.mkdir(path.join(ROOT, 'work'), { recursive: true });
  const dir = await fs.mkdtemp(path.join(ROOT, 'work/test-build-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir;
}
test('pure text creation and build have no optional modules or UI', async t => {
  const root = await workspace(t); await newCard('文字测试', { root });
  const { card, project, dir } = await loadProject('文字测试', root);
  assert.deepEqual(project.modules, []); assert.deepEqual(project.builds, []);
  assert.deepEqual(card.data.extensions, {}); assert.equal(card.data.character_book, undefined);
  const built = await buildCard('文字测试', root);
  assert.deepEqual(built.files, ['文字测试.json']);
  assert.deepEqual(await readJSON(path.join(built.directory, built.files[0])), card);
  assert.equal((await checkProject('文字测试', root)).report.ok, true);
  await assert.rejects(newCard('文字测试', { root }), /refusing to overwrite/);
});
test('PowerShell joined module argument and invalid CLI parameters', async t => {
  const root = await workspace(t);
  await main(['new', '组合', '--modules', 'worldbook regex'], root);
  assert.deepEqual((await loadProject('组合', root)).project.modules, ['worldbook', 'regex']);
  assert.equal((await checkProject('组合', root)).report.regexFixtures, 1);
  await assert.rejects(main(['new', '坏', '--modules', 'html,vue'], root), /html or vue/);
  await assert.rejects(main(['split', 'a.json', '--modules', 'mvu'], root), /does not apply/);
});
test('script module is a single bundle and retains helper metadata', async t => {
  const root = await workspace(t); await newCard("scripts", { root, modules: ['script'] });
  const original = (await loadProject("scripts", root)).card;
  const built = await buildCard("scripts", root); const card = await readJSON(path.join(built.directory, 'scripts.json'));
  const before = structuredClone(original.data.extensions.tavern_helper.scripts[0]);
  const after = structuredClone(card.data.extensions.tavern_helper.scripts[0]);
  delete before.content; delete after.content; assert.deepEqual(after, before);
  assert.match(card.data.extensions.tavern_helper.scripts[0].content, /eventOn/);
  assert.deepEqual(built.files, ['scripts/1.js', 'scripts.json']);
});
test('HTML assets are embedded; local Vite config is not executed; replacement protects macros and dollars', async t => {
  const root = await workspace(t); const dir = await newCard('界面', { root, modules: ['html'] });
  const htmlFile = path.join(dir, 'src/ui/html/index.html');
  const html = await fs.readFile(htmlFile, 'utf8');
  await fs.writeFile(htmlFile, html.replace('<main', '<img alt="icon" src="./icon.svg"><p>$1 $<name> {{user}} 中文</p><main'));
  await write(path.join(dir, 'src/ui/html/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path fill="purple" d="M0 0h1v1H0z"/></svg>');
  await write(path.join(dir, 'src/ui/html/vite.config.js'), 'throw new Error("must not execute");');
  const built = await buildCard('界面', root);
  const preview = await fs.readFile(path.join(built.directory, 'ui/1.html'), 'utf8');
  assert.match(preview, /data:image\/svg\+xml/);
  assert.match(preview, /\$1 \$<name> \{\{user\}\} 中文/);
  const card = await readJSON(path.join(built.directory, '界面.json'));
  const regex = card.data.extensions.regex_scripts.find(r => r.scriptName === "Embedded status panel");
  assert.equal(applyRegexFixture(regex, '<CardStatus/>'), regex.replaceString);
  assert.doesNotMatch(regex.replaceString, /\$\d|\$<|\{\{/);
  const encoded = regex.replaceString.match(/atob\("([A-Za-z0-9+/=]+)"\)/)[1];
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), preview);
});
test('Vue and MVU are independent, fixed external MVU is preserved', async t => {
  const root = await workspace(t);
  await newCard('Vue', { root, modules: ['vue'] });
  const simple = await buildCard('Vue', root);
  assert.match(await fs.readFile(path.join(simple.directory, 'ui/1.html'), 'utf8'), /Vue · No MVU required/);
  await newCard('变量界面', { root, modules: ['mvu', 'vue'] });
  const built = await buildCard('变量界面', root);
  const report = await readJSON(path.join(built.directory, 'build-report.json'));
  assert.equal(report.dependencies.length, 2);
  assert.match(report.dependencies[0].url, /@[a-f0-9]{40}\//);
  assert.match(report.dependencies[1].url, /@69abb272d46bed4057a0dfb31758f6164cb7ecef\/dist\/util\/mvu_zod\.js$/);
  assert.equal(report.checks.realTavern, 'not-tested');
  const card = await readJSON(path.join(built.directory, '变量界面.json'));
  assert.equal(card.data.character_book.entries.find(e => e.comment.startsWith('[initvar]')).enabled, false);
  assert.match(card.data.extensions.tavern_helper.scripts[0].content, /import 'https:/);
  assert.deepEqual(card.data.extensions.tavern_helper.scripts.map(s => s.name), ['MVU framework (pinned commit)', 'Variable schema (Zod registration)']);
  assert.match(card.data.extensions.tavern_helper.scripts[1].content, /registerMvuSchema\(Schema\)/);
});
test('failed build leaves previous deliverable intact', async t => {
  const root = await workspace(t); const dir = await newCard('原子构建', { root, modules: ['html'] });
  const built = await buildCard('原子构建', root);
  const old = await fs.readFile(path.join(built.directory, '原子构建.json'));
  await fs.appendFile(path.join(dir, 'src/ui/html/main.js'), '\nfetch("http://localhost:5173/private.json");');
  await assert.rejects(buildCard('原子构建', root), /undeclared|development/);
  assert.deepEqual(await fs.readFile(path.join(built.directory, '原子构建.json')), old);
});
test('resource auditing distinguishes resources, missing assets, external versions, and dynamic calls', async () => {
  const url = 'https://cdn.example.org/lib@1.2.3.js';
  const dependencies = [{ url, purpose: 'test public dependency', version: '1.2.3' }];
  assert.deepEqual(validateDependencies(dependencies), []);
  assert.ok(validateDependencies([{ ...dependencies[0], version: 'latest' }]).length);
  assert.equal((await auditResources(`import '${url}';`, { file: 'test.js', javascript: true, bundled: true, dependencies })).errors.length, 0);
  assert.ok((await auditResources('<img src="./missing.png">', { bundled: true, file: 'x.html' })).errors.length);
  assert.ok((await auditResources('fetch(prefix + name)', { file: 'x.js', javascript: true })).warnings.length);
  assert.equal(findResourceReferences('<a href="https://example.org">普通链接</a>').references.length, 0);
  assert.ok((await auditResources('<script src="https://raw.githubusercontent.com/owner/private/main/a.js"></script>', { file: 'x.html' })).errors.length);
});
test('pinned ST group replacement preserves literal dollars and uses named groups and trim strings', () => {
  const regex = { findRegex: '/(?<word>a)(b)/g', replaceString: '$0|$1|$2|$<word>|$$|$&|{{user}}', trimStrings: [] };
  assert.equal(applyRegexFixture(regex, 'ab'), 'ab|a|b|a|$$|$&|{{user}}');
  assert.equal(applyRegexFixture({ findRegex: '/<x>(.*?)<\/x>/g', replaceString: '$1', trimStrings: ['!'] }, '<x>a!b!</x>'), 'ab');
});
test('regex fixture timeout and source syntax errors are reported without executing card code', async t => {
  const root = await workspace(t); const dir = await newCard('静态', { root, modules: ['script'] });
  const { project } = await loadProject('静态', root);
  const script = project.fields.find(f => f.file.startsWith('src/scripts/'));
  await fs.writeFile(path.join(dir, script.file), 'throw new Error("MUST NOT RUN");');
  assert.equal((await checkProject('静态', root)).report.ok, true);
  await fs.writeFile(path.join(dir, script.file), 'const = ;');
  assert.equal((await checkProject('静态', root)).report.ok, false);
  assert.throws(() => applyRegexFixture({ findRegex: '/(a+)+$/', replaceString: '', trimStrings: [] }, 'a'.repeat(10000) + '!'), /timed out/);
});
test('complete PNG split -> build -> reimport keeps V2/V3 fields, image, and unrelated chunks', async t => {
  const root = await workspace(t);
  await newCard('基础', { root, modules: ['worldbook', 'regex', 'script'] });
  const { card: base } = await loadProject('基础', root);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from('Author\0Original artist')), chunk('IDAT', deflateSync(Buffer.from([0, 80, 40, 120, 255]))), chunk('IEND', Buffer.alloc(0))]);
  for (const version of [2, 3]) {
    const card = structuredClone(base);
    card.spec = `chara_card_v${version}`; card.spec_version = `${version}.0`;
    card.data.extensions.unknown = { nested: [null, false, 0, { preserved: '陌生插件信息' }] };
    card.data.alternate_greetings = ['', '第一行\r\n第二行'];
    if (version === 3) { card.data.nickname = '另一个名字'; card.data.group_only_greetings = ['群聊开场']; }
    const file = path.join(root, `输入${version}.png`);
    await fs.writeFile(file, writeCardPNG(image, card));
    await splitCard(file, { root, name: `回包${version}` });
    const built = await buildCard(`回包${version}`, root);
    const json = await readJSON(path.join(built.directory, `回包${version}.json`));
    const png = await fs.readFile(path.join(built.directory, `回包${version}.png`));
    assert.deepEqual(json, card); assert.deepEqual(readCardPNG(png).card, card);
    const chunks = parsePNG(png);
    assert.deepEqual(chunks.find(c => c.type === 'IDAT').data, parsePNG(image).find(c => c.type === 'IDAT').data);
    assert.equal(chunks.filter(c => c.type === 'tEXt' && c.data.toString().startsWith('Author\0')).length, 1);
    await splitCard(path.join(built.directory, `回包${version}.png`), { root, name: `再导入${version}` });
    assert.deepEqual((await loadProject(`再导入${version}`, root)).card, card);
  }
});
test('EJS syntax is compiled without rendering or running template statements', async t => {
  const root = await workspace(t); const dir = await newCard('模板语法', { root });
  const file = path.join(dir, 'src/text/description.md');
  const index = await readYAML(dir, 'src/index.yaml');
  index.text.description = 'src/text/description.md';
  await writeYAML(dir, 'src/index.yaml', index);
  await fs.writeFile(file, '<% throw new Error("Do not render me"); %><%= getvar("name") %>');
  const valid = await checkProject('模板语法', root);
  assert.equal(valid.report.ok, true); assert.deepEqual(valid.report.warnings, []);
  await fs.writeFile(file, '<% if ( %>');
  const fragment = await checkProject('模板语法', root);
  assert.ok(fragment.report.warnings.some(w => w.includes('EJS standalone compilation failed')));
  assert.ok(fragment.report.warnings.every(w => !w.includes('is not a function')));
});
