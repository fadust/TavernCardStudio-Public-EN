// Independent worldbook layout and organization tests using public APIs only.
// Depends only on tools/lib/{worldbook-layout,organize,project,authoring,templates,files}.mjs and node:test without changing implementations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { newCard } from '../tools/lib/templates.mjs';
import { loadProject, semanticDiff, splitCard } from '../tools/lib/project.mjs';
import { readYAML, writeYAML } from '../tools/lib/authoring.mjs';
import { organizeWorldbook } from '../tools/lib/organize.mjs';
import { allocateWorldbook, existingWorldbookFolder, fileLabel, worldbookLocation } from '../tools/lib/worldbook-layout.mjs';
import { jsonText, sha256, walk } from '../tools/lib/files.mjs';

// ---------- Test helpers ----------

async function tempRoot(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  return root;
}

async function hasFile(dir, relative) {
  try { await fs.access(path.join(dir, relative)); return true; } catch { return false; }
}
async function readText(dir, relative) { return fs.readFile(path.join(dir, relative), 'utf8'); }
async function writeText(dir, relative, content) {
  const file = path.join(dir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  return fs.writeFile(file, content);
}
async function snapshot(dir) {
  // Store only relative paths and SHA-256 hashes so assertion failures cannot reveal card text.
  const result = {};
  for (const file of (await walk(dir)).sort()) result[path.relative(dir, file).split(path.sep).join('/')] = sha256(await fs.readFile(file));
  return result;
}
// Windows junctions need no administrator rights; return false when directory links are unsupported so the caller can skip.
async function junction(target, link) {
  try { await fs.symlink(target, link, 'junction'); return true; }
  catch (error) { if ([`EPERM`, `EACCES`, `ENOTSUP`, `EINVAL`].includes(error.code)) return false; throw error; }
}

function bookCard(name, entries) {
  return { spec: 'chara_card_v2', spec_version: '2.0', name, data: { name, first_mes: '你好', extensions: {}, character_book: { name, entries } } };
}
function entry(id, comment, content) {
  return { id, keys: [], comment, content, enabled: true, constant: false, extensions: { position: 0, depth: 4, role: 0 } };
}
async function importCard(root, name, card) {
  const file = path.join(root, name + '.json');
  await fs.writeFile(file, JSON.stringify(card, null, 2));
  return splitCard(file, { name, root });
}
async function worldbookEntries(dir) {
  const index = await readYAML(dir, 'src/index.yaml');
  const result = [];
  for (const file of index.worldbook.entries) result.push({ file, config: await readYAML(dir, file) });
  return result;
}
async function findWorldbook(dir, title) {
  const found = (await worldbookEntries(dir)).find(item => item.config.name === title);
  assert.ok(found, `世界书条目应存在: ${title}`);
  return found;
}
// Move configuration and bodies to the legacy flat layout and update index references without changing body contents.
async function flattenEntry(dir, from, file, body) {
  const config = await readYAML(dir, from);
  await writeText(dir, body, await readText(dir, config.file));
  await writeYAML(dir, file, { ...config, file: body });
  await fs.rm(path.join(dir, from));
  await fs.rm(path.join(dir, config.file));
  const index = await readYAML(dir, 'src/index.yaml');
  index.worldbook.entries = index.worldbook.entries.map(item => (item === from ? file : item));
  await writeYAML(dir, 'src/index.yaml', index);
  return config;
}

// ---------- Title classification ----------

test("worldbookLocation classifies only explicit tags, protocol names, and conventional overview names", () => {
  assert.deepEqual(worldbookLocation('甲'), { folder: "uncategorized", label: '甲' });
  assert.deepEqual(worldbookLocation('雾岭'), { folder: "uncategorized", label: '雾岭' }, '地名不当作分类');
  assert.deepEqual(worldbookLocation('甲-乙'), { folder: "uncategorized", label: '甲-乙' }, '前缀不是分类词时保留整个标题');
  assert.deepEqual(worldbookLocation('地理-雾岭'), { folder: "geography", label: '雾岭' });
  assert.deepEqual(worldbookLocation('地理：雾岭'), { folder: "geography", label: '雾岭' });
  assert.deepEqual(worldbookLocation('【角色】店主'), { folder: "characters", label: '店主' });
  assert.deepEqual(worldbookLocation('设定-世界的规则'), { folder: "setting", label: '世界的规则' });
  assert.deepEqual(worldbookLocation("World setting"), { folder: "setting", label: "World setting" });
  assert.deepEqual(worldbookLocation('世界总览'), { folder: "setting", label: '世界总览' });
  assert.deepEqual(worldbookLocation("Geography overview"), { folder: "geography", label: "Geography overview" });
  assert.deepEqual(worldbookLocation("Character overview"), { folder: "characters", label: "Character overview" });
  assert.deepEqual(worldbookLocation('人物总览'), { folder: "characters", label: '人物总览' });
  assert.deepEqual(worldbookLocation(undefined), { folder: "uncategorized", label: "Untitled" });
  assert.deepEqual(worldbookLocation('[initvar]变量初始化勿开'), { folder: "variables", label: '[initvar]变量初始化勿开' });
  assert.deepEqual(worldbookLocation('[mvu_update]变量更新规则'), { folder: "variables", label: '[mvu_update]变量更新规则' });
  assert.deepEqual(worldbookLocation("Variable list"), { folder: "variables", label: "Variable list" });
  // Existing category directories take precedence; title prefixes only refine filenames.
  assert.deepEqual(worldbookLocation('甲', '我的分类'), { folder: '我的分类', label: '甲' });
  assert.deepEqual(worldbookLocation('地理-雾岭', '我的分类'), { folder: '我的分类', label: '雾岭' });
});

test("fileLabel and allocateWorldbook prevent collisions across duplicate names, case, and Windows reserved names", () => {
  assert.equal(fileLabel('甲.'), '甲');
  assert.equal(fileLabel('   '), "Untitled");
  assert.equal(fileLabel('.'), "Untitled");
  assert.equal(fileLabel('..'), "Untitled");
  assert.equal(fileLabel('a/b'), 'a_b');
  assert.equal(fileLabel('甲'.repeat(100)).length, 64, '文件名有长度上限');
  for (const reserved of ['CON', 'con', 'NUL.txt', 'aux', 'lpt1', 'com9']) assert.equal(fileLabel(reserved), '_' + reserved, reserved + ' 是 Windows 保留名');

  // Occupied keys and candidates are compared lowercase, so case-only differences still collide.
  const occupied = new Set();
  assert.equal(allocateWorldbook('Geography', { occupied }), 'src/worldbook/uncategorized/Geography');
  assert.equal(allocateWorldbook('geography', { occupied }), 'src/worldbook/uncategorized/geography (2)');
  assert.equal(allocateWorldbook('Geography', { occupied }), 'src/worldbook/uncategorized/Geography (3)');
  assert.equal(allocateWorldbook("Untitled", { occupied: new Set() }), 'src/worldbook/uncategorized/Untitled');
  assert.equal(allocateWorldbook('CON', { occupied: new Set() }), 'src/worldbook/uncategorized/_CON');
  // Check only listed extensions; callers decide which files count as occupied.
  assert.equal(allocateWorldbook('甲', { extensions: ['.md'], occupied: new Set(['src/worldbook/uncategorized/甲.md']) }), 'src/worldbook/uncategorized/甲 (2)');
  assert.equal(allocateWorldbook('甲', { extensions: ['.md'], occupied: new Set(['src/worldbook/uncategorized/甲.yaml']) }), 'src/worldbook/uncategorized/甲');

  for (const folder of ['../外面', '地理/../外面', 'CON', '']) assert.throws(() => allocateWorldbook('甲', { folder }), /Invalid worldbook category folder/, folder + ' 不能当分类目录');

  assert.equal(existingWorldbookFolder('src/worldbook/我的分类/甲.yaml'), '我的分类');
  assert.equal(existingWorldbookFolder('src/worldbook/a/b/甲.yaml'), 'a/b');
  assert.equal(existingWorldbookFolder('src/worldbook/甲.yaml'), undefined, '扁平文件没有已有分类');
  assert.equal(existingWorldbookFolder('src/regex/甲.yaml'), undefined);
});

test("import classification uses titles without guessing from body text or injection positions", async t => {
  const root = await tempRoot(t, 'tcs-layout-guess-');
  const card = bookCard('不猜分类', [
    { ...entry(1, '甲', '地理总览：山与河。角色总览：店主。规则：不得出界。'), constant: true, extensions: { position: 4, depth: 2, role: 1 } },
    entry(2, "Used bookshop", '地点描述：旧书店在雾岭。地点词与内容都不是分类依据。'),
    { ...entry(3, "Knowledge boundaries", '总规则正文'), constant: true },
    entry(4, "Geography overview", '地理正文'),
    entry(5, "World setting", '世界观正文'),
    entry(6, '[initvar]变量初始化勿开', '变量正文'),
  ]);
  const dir = await importCard(root, '不猜分类', card);
  const entries = await worldbookEntries(dir);
  assert.deepEqual(entries.map(item => item.file), [
    'src/worldbook/uncategorized/甲.yaml',
    'src/worldbook/uncategorized/Used bookshop.yaml',
    'src/worldbook/uncategorized/Knowledge boundaries.yaml',
    'src/worldbook/geography/Geography overview.yaml',
    'src/worldbook/setting/World setting.yaml',
    'src/worldbook/variables/[initvar]变量初始化勿开.yaml',
  ], '只有显式标签、协议名与惯例总览名才决定分类');
  assert.deepEqual(entries.map(item => item.config.file), [
    'src/worldbook/uncategorized/甲.md',
    'src/worldbook/uncategorized/Used bookshop.md',
    'src/worldbook/uncategorized/Knowledge boundaries.md',
    'src/worldbook/geography/Geography overview.md',
    'src/worldbook/setting/World setting.md',
    'src/worldbook/variables/[initvar]变量初始化勿开.md',
  ]);
  assert.deepEqual((await fs.readdir(path.join(dir, 'src/worldbook'))).sort(), ["setting", "geography", "uncategorized", "variables"].sort());

  const loaded = await loadProject('不猜分类', root);
  assert.deepEqual(loaded.card.data.character_book.entries.map(item => [item.constant, item.extensions.position, item.extensions.depth, item.extensions.role]), [
    [true, 4, 2, 1],
    [false, 0, 4, 0],
    [true, 0, 4, 0],
    [false, 0, 4, 0],
    [false, 0, 4, 0],
    [false, 0, 4, 0],
  ], '注入位置与蓝绿灯原样保留，不参与分类');
});

// ---------- Split fidelity ----------

test("JSON split preserves macro and EJS bytes without executing or rewriting unknown metadata", async t => {
  const root = await tempRoot(t, 'tcs-layout-split-');
  const macroBody = '{{char}} 说：{{user}} 在吗？\n<% throw new Error("正文不应被当作 EJS 执行") %>\n<%- include("/etc/hosts") %>\n<UpdateVariable>\n<JSONPatch>[]</JSONPatch>\n</UpdateVariable>\n';
  const card = {
    spec: 'chara_card_v2', spec_version: '2.0', name: '宏卡',
    未知卡级: { keep: [1, '甲'] },
    data: {
      name: '宏卡', first_mes: '你好', description: macroBody,
      extensions: { 第三方插件: { nested: [{ deep: [1] }] } },
      character_book: {
        name: '书', 未知世界书字段: { keep: true },
        entries: [
          { id: 3, keys: ["Used bookshop"], comment: "Used bookshop", content: macroBody, enabled: true, constant: false, extensions: { position: 0, depth: 4, role: 0, 未知扩展: '保留' }, 未知条目字段: { keep: [1, 2] } },
          entry(4, '甲', '甲的内容'),
        ],
      },
    },
  };
  const dir = await importCard(root, '宏卡', card);
  const loaded = await loadProject('宏卡', root);
  assert.deepEqual(semanticDiff(card, loaded.card), [], '拆分再加载逐字等价');

  const bookshop = await findWorldbook(dir, "Used bookshop");
  assert.equal(await readText(dir, bookshop.config.file), macroBody, '正文按原字节写入');
  assert.equal((await fs.readFile(path.join(dir, bookshop.config.file))).equals(Buffer.from(macroBody, 'utf8')), true, '宏与 EJS 不被执行或改写');
  assert.equal(await readText(dir, 'src/text/description.md'), macroBody);
  assert.deepEqual(loaded.card['未知卡级'], { keep: [1, '甲'] });
  assert.deepEqual(loaded.card.data.extensions['第三方插件'], { nested: [{ deep: [1] }] });
  assert.deepEqual(loaded.card.data.character_book['未知世界书字段'], { keep: true });
  assert.deepEqual(loaded.card.data.character_book.entries[0]['未知条目字段'], { keep: [1, 2] });
  assert.equal(loaded.card.data.character_book.entries[0].extensions['未知扩展'], '保留');
  assert.equal(await readText(dir, (await findWorldbook(dir, '甲')).config.file), '甲的内容');
});

// ---------- Organizing legacy layouts ----------

test("organize moves legacy flat layouts into category directories while preserving the card and a backup", async t => {
  const root = await tempRoot(t, 'tcs-layout-organize-');
  const card = bookCard('扁平', [
    { ...entry(1, "World setting", '世界观正文'), constant: true },
    { ...entry(2, '地理-雾岭', '雾岭正文'), 未知条目字段: { keep: true } },
    entry(3, '甲', '甲正文'),
  ]);
  const dir = await importCard(root, '扁平', card);
  for (const [i, item] of (await worldbookEntries(dir)).entries()) {
    const stem = `00${i + 1}-${item.config.name}`;
    await flattenEntry(dir, item.file, `src/worldbook/${stem}.yaml`, `src/worldbook/${stem}.md`);
  }
  const before = await loadProject('扁平', root);
  const result = await organizeWorldbook('扁平', root);

  assert.equal(result.ok, true);
  assert.equal(result.organized, true);
  assert.deepEqual(result.changes.map(change => [change.from, change.to, change.bodyFrom, change.bodyTo]), [
    ['src/worldbook/001-World setting.yaml', 'src/worldbook/setting/World setting.yaml', 'src/worldbook/001-World setting.md', 'src/worldbook/setting/World setting.md'],
    ['src/worldbook/002-地理-雾岭.yaml', 'src/worldbook/geography/雾岭.yaml', 'src/worldbook/002-地理-雾岭.md', 'src/worldbook/geography/雾岭.md'],
    ['src/worldbook/003-甲.yaml', 'src/worldbook/uncategorized/甲.yaml', 'src/worldbook/003-甲.md', 'src/worldbook/uncategorized/甲.md'],
  ]);
  assert.equal(await hasFile(dir, 'src/worldbook/001-World setting.yaml'), false, '旧扁平配置不再留在工程里');
  assert.equal(await readText(dir, 'src/worldbook/geography/雾岭.md'), '雾岭正文');

  const after = await loadProject('扁平', root);
  assert.deepEqual(semanticDiff(before.card, after.card), [], '整理只改文件位置');
  assert.deepEqual(after.project.builds, before.project.builds);
  assert.deepEqual((await readYAML(dir, 'src/index.yaml')).worldbook.entries, [
    'src/worldbook/setting/World setting.yaml',
    'src/worldbook/geography/雾岭.yaml',
    'src/worldbook/uncategorized/甲.yaml',
  ], '索引指向新路径');

  assert.match(result.backup, /^work\/layout-backups\/扁平-[0-9a-f-]{36}$/, '备份落在 work/layout-backups');
  assert.equal(await hasFile(root, path.join(result.backup, 'src/worldbook/001-World setting.yaml')), true, '备份保留整理前的旧路径');
  assert.equal(await readText(root, path.join(result.backup, 'src/worldbook/001-World setting.md')), '世界观正文');
  assert.equal(await hasFile(root, path.join(result.backup, 'src/index.yaml')), true);

  const stable = await snapshot(dir);
  const again = await organizeWorldbook('扁平', root);
  assert.deepEqual(again, { name: '扁平', ok: true, organized: false, changes: [] }, '重复执行无改动');
  assert.deepEqual(await snapshot(dir), stable, '第二次整理不写文件');
  assert.equal((await fs.readdir(path.join(root, 'work/layout-backups'))).length, 1, '重复执行不再新增备份');
  assert.deepEqual((await fs.readdir(path.join(root, 'cards'))).filter(name => name.startsWith('.tmp-')), [], '不留临时目录');
});

test("organize preserves existing nested categories and adjusts filenames only within their directories", async t => {
  const root = await tempRoot(t, 'tcs-layout-nested-');
  await importCard(root, '嵌套', bookCard('嵌套', [entry(1, '地理-雾岭', '雾岭正文')]));
  const dir = path.join(root, 'cards', '嵌套');
  const generated = await findWorldbook(dir, '地理-雾岭');
  await flattenEntry(dir, generated.file, 'src/worldbook/我的分类/001-雾岭.yaml', 'src/worldbook/我的分类/001-雾岭.md');

  const result = await organizeWorldbook('嵌套', root);
  assert.deepEqual(result.changes, [{
    from: 'src/worldbook/我的分类/001-雾岭.yaml',
    to: 'src/worldbook/我的分类/雾岭.yaml',
    bodyFrom: 'src/worldbook/我的分类/001-雾岭.md',
    bodyTo: 'src/worldbook/我的分类/雾岭.md',
  }], '分类目录保留，只整理文件名');
  assert.equal(await hasFile(dir, 'src/worldbook/geography/雾岭.yaml'), false, '不搬到标题对应的类别目录');
  const after = await loadProject('嵌套', root);
  assert.equal(after.card.data.character_book.entries[0].content, '雾岭正文');
});

test("organize supports case-only renames while preserving filenames and data correctly", async t => {
  const root = await tempRoot(t, 'tcs-layout-case-');
  const card = bookCard('大小写', [{ ...entry(1, 'abc', 'abc 正文'), 未知条目字段: { keep: true } }]);
  await importCard(root, '大小写', card);
  const dir = path.join(root, 'cards', '大小写');
  const generated = await findWorldbook(dir, 'abc');
  await writeYAML(dir, generated.file, { ...(await readYAML(dir, generated.file)), name: 'ABC' });

  const before = await loadProject('大小写', root);
  const result = await organizeWorldbook('大小写', root);
  assert.equal(result.organized, true);
  assert.deepEqual(result.changes, [{
    from: 'src/worldbook/uncategorized/abc.yaml',
    to: 'src/worldbook/uncategorized/ABC.yaml',
    bodyFrom: 'src/worldbook/uncategorized/abc.md',
    bodyTo: 'src/worldbook/uncategorized/ABC.md',
  }]);
  assert.deepEqual((await fs.readdir(path.join(dir, 'src/worldbook/uncategorized'))).sort(), ['ABC.md', 'ABC.yaml'], '磁盘上是新的大小写，旧名字不再存在');
  assert.equal(await readText(dir, 'src/worldbook/uncategorized/ABC.md'), 'abc 正文', '正文数据不变');
  assert.deepEqual((await readYAML(dir, 'src/index.yaml')).worldbook.entries, ['src/worldbook/uncategorized/ABC.yaml']);

  const after = await loadProject('大小写', root);
  assert.equal(after.card.data.character_book.entries[0].comment, 'ABC');
  assert.equal(after.card.data.character_book.entries[0].content, 'abc 正文');
  assert.deepEqual(after.card.data.character_book.entries[0].未知条目字段, { keep: true });
  assert.deepEqual(semanticDiff(before.card, after.card), [], '整理只改文件名大小写，卡数据不变');
});

test("organize avoids unreferenced files and chooses another name for occupied destinations", async t => {
  const root = await tempRoot(t, 'tcs-layout-occupied-');
  await importCard(root, '占位', bookCard('占位', [entry(1, '甲', '甲正文')]));
  const dir = path.join(root, 'cards', '占位');
  const generated = await findWorldbook(dir, '甲');
  await flattenEntry(dir, generated.file, 'src/worldbook/001-甲.yaml', 'src/worldbook/001-甲.md');
  // Place an unreferenced worldbook file at the destination; organization must not overwrite it.
  await writeText(dir, 'src/worldbook/uncategorized/甲.yaml', 'name: 未引用');
  await writeText(dir, 'src/worldbook/uncategorized/甲.md', '未引用正文');

  const result = await organizeWorldbook('占位', root);
  assert.deepEqual(result.changes, [{
    from: 'src/worldbook/001-甲.yaml',
    to: 'src/worldbook/uncategorized/甲 (2).yaml',
    bodyFrom: 'src/worldbook/001-甲.md',
    bodyTo: 'src/worldbook/uncategorized/甲 (2).md',
  }]);
  assert.equal(await readText(dir, 'src/worldbook/uncategorized/甲.yaml'), 'name: 未引用', '未引用配置不动');
  assert.equal(await readText(dir, 'src/worldbook/uncategorized/甲.md'), '未引用正文', '未引用正文不动');
  assert.equal(await readText(dir, 'src/worldbook/uncategorized/甲 (2).md'), '甲正文');
  const after = await loadProject('占位', root);
  assert.equal(after.card.data.character_book.entries[0].content, '甲正文');
});

test("organize does not move executable entry bodies or build entry points", async t => {
  const root = await tempRoot(t, 'tcs-layout-build-');
  await importCard(root, "build", bookCard("build", [entry(1, '甲', '甲正文')]));
  const dir = path.join(root, 'cards', "build");
  const generated = await findWorldbook(dir, '甲');
  const config = { ...(await readYAML(dir, generated.file)), file: 'src/worldbook/001-甲.md', build: { type: 'script', entry: 'src/worldbook/001-甲.js' } };
  await writeYAML(dir, 'src/worldbook/001-甲.yaml', config);
  await writeText(dir, 'src/worldbook/001-甲.md', '甲正文');
  await writeText(dir, 'src/worldbook/001-甲.js', 'console.info("甲构建");');
  await fs.rm(path.join(dir, generated.file));
  await fs.rm(path.join(dir, generated.config.file));
  const index = await readYAML(dir, 'src/index.yaml');
  index.worldbook.entries = ['src/worldbook/001-甲.yaml'];
  await writeYAML(dir, 'src/index.yaml', index);

  const before = await loadProject("build", root);
  assert.deepEqual(before.project.builds, [{ kind: 'script', entry: 'src/worldbook/001-甲.js', pointer: '/data/character_book/entries/0/content' }]);
  const result = await organizeWorldbook("build", root);
  assert.deepEqual(result.changes, [{
    from: 'src/worldbook/001-甲.yaml',
    to: 'src/worldbook/uncategorized/甲.yaml',
    bodyFrom: 'src/worldbook/001-甲.md',
    bodyTo: 'src/worldbook/001-甲.md',
  }], '只整理配置，正文保持原位');

  const after = await loadProject("build", root);
  assert.deepEqual(after.project.builds, before.project.builds, '构建入口不变');
  assert.equal(await hasFile(dir, 'src/worldbook/001-甲.md'), true);
  assert.equal(await readText(dir, 'src/worldbook/001-甲.js'), 'console.info("甲构建");');
  assert.equal(after.project.fields.find(field => field.pointer.endsWith('/content')).file, 'src/worldbook/001-甲.md');
  assert.equal(after.card.data.character_book.entries[0].content, '甲正文');
});

test("organize recovers entries without links through recorded state paths", async t => {
  const root = await tempRoot(t, 'tcs-layout-recover-');
  const card = bookCard('找回', [{ ...entry(7, '甲', '甲正文'), 未知条目字段: { keep: [1, 2] } }]);
  await importCard(root, '找回', card);
  const dir = path.join(root, 'cards', '找回');
  const generated = await findWorldbook(dir, '甲');
  const config = { ...(await readYAML(dir, generated.file)), name: '甲-乙' };
  delete config.link;
  await writeYAML(dir, generated.file, config);

  const before = await loadProject('找回', root);
  assert.equal(before.card.data.character_book.entries[0].id, 7, '缺关联时先按记录路径找回原 ID');
  const result = await organizeWorldbook('找回', root);
  assert.deepEqual(result.changes, [{
    from: 'src/worldbook/uncategorized/甲.yaml',
    to: 'src/worldbook/uncategorized/甲-乙.yaml',
    bodyFrom: 'src/worldbook/uncategorized/甲.md',
    bodyTo: 'src/worldbook/uncategorized/甲-乙.md',
  }]);

  const after = await loadProject('找回', root);
  assert.deepEqual(semanticDiff(before.card, after.card), [], '整理不改动卡内容');
  assert.equal(after.card.data.character_book.entries[0].id, 7);
  assert.deepEqual(after.card.data.character_book.entries[0].未知条目字段, { keep: [1, 2] });
  assert.deepEqual(after.unreferenced, [], '没有丢下旧记录');
  const state = JSON.parse(await readText(dir, '.card/state.json'));
  const restored = (await findWorldbook(dir, '甲-乙')).config;
  assert.equal(Object.keys(state.records).length, 1, '找回原记录而不是新建');
  assert.equal(state.records[restored.link].kind, 'worldbook');
  assert.deepEqual(state.records[restored.link].base.未知条目字段, { keep: [1, 2] });
});

test("existing entries at their target paths recover missing links idempotently", async t => {
  const root = await tempRoot(t, 'tcs-layout-rekey-');
  const card = bookCard('补回', [{ ...entry(7, '甲', '甲正文'), 未知条目字段: { keep: [1, 2] } }]);
  await importCard(root, '补回', card);
  const dir = path.join(root, 'cards', '补回');
  const generated = await findWorldbook(dir, '甲');
  const config = { ...(await readYAML(dir, generated.file)) };
  delete config.link;
  await writeYAML(dir, generated.file, config);

  const before = await loadProject('补回', root);
  const first = await organizeWorldbook('补回', root);
  assert.equal(first.organized, true);
  assert.deepEqual(first.changes, [{
    from: 'src/worldbook/uncategorized/甲.yaml',
    to: 'src/worldbook/uncategorized/甲.yaml',
    bodyFrom: 'src/worldbook/uncategorized/甲.md',
    bodyTo: 'src/worldbook/uncategorized/甲.md',
  }], '路径不变，只补关联与记录');
  assert.equal(typeof (await findWorldbook(dir, '甲')).config.link, 'string');
  const after = await loadProject('补回', root);
  assert.deepEqual(semanticDiff(before.card, after.card), [], '只写关联与记录');
  assert.equal(after.card.data.character_book.entries[0].id, 7, '沿用原记录 ID');
  assert.deepEqual(after.unreferenced, []);
  const state = JSON.parse(await readText(dir, '.card/state.json'));
  assert.equal(Object.keys(state.records).length, 1, '找回原记录而不是新建');

  const stable = await snapshot(dir);
  assert.deepEqual(await organizeWorldbook('补回', root), { name: '补回', ok: true, organized: false, changes: [] }, '重复执行无改动');
  assert.deepEqual(await snapshot(dir), stable);
});

test("new unlinked entries retain IDs and receive links after organization", async t => {
  const root = await tempRoot(t, 'tcs-layout-newitem-');
  await importCard(root, '新增', bookCard('新增', [entry(1, "World setting", '世界观正文')]));
  const dir = path.join(root, 'cards', '新增');
  // Create a flat worldbook entry without a link or a path recorded in state.
  await writeYAML(dir, 'src/worldbook/004-新条目.yaml', { name: '新条目', keys: ['新条目'], file: 'src/worldbook/004-新条目.md' });
  await writeText(dir, 'src/worldbook/004-新条目.md', '新条目正文');
  const index = await readYAML(dir, 'src/index.yaml');
  index.worldbook.entries.push('src/worldbook/004-新条目.yaml');
  await writeYAML(dir, 'src/index.yaml', index);

  const before = await loadProject('新增', root);
  const idBefore = before.card.data.character_book.entries.find(item => item.comment === '新条目').id;
  const result = await organizeWorldbook('新增', root);
  assert.equal(result.organized, true);
  assert.deepEqual(result.changes, [{
    from: 'src/worldbook/004-新条目.yaml',
    to: 'src/worldbook/uncategorized/新条目.yaml',
    bodyFrom: 'src/worldbook/004-新条目.md',
    bodyTo: 'src/worldbook/uncategorized/新条目.md',
  }]);

  const after = await loadProject('新增', root);
  assert.deepEqual(semanticDiff(before.card, after.card), [], '整理只改文件位置');
  assert.equal(typeof (await findWorldbook(dir, '新条目')).config.link, 'string', '整理后补上关联');
  assert.equal(after.card.data.character_book.entries.find(item => item.comment === '新条目').id, idBefore, 'ID 由首次加载确定后不再变化');
});

test("unlinked entries already using the new layout receive stable IDs idempotently", async t => {
  const root = await tempRoot(t, 'tcs-layout-fixid-');
  // A project without the worldbook template has handwritten entries and no worldbook state records.
  await newCard('手写世界书', { root });
  const dir = path.join(root, 'cards', '手写世界书');
  await writeYAML(dir, 'src/worldbook/uncategorized/甲.yaml', { name: '甲', keys: ['甲'], file: 'src/worldbook/uncategorized/甲.md' });
  await writeText(dir, 'src/worldbook/uncategorized/甲.md', '甲正文');
  const index = await readYAML(dir, 'src/index.yaml');
  index.worldbook.entries = ['src/worldbook/uncategorized/甲.yaml'];
  await writeYAML(dir, 'src/index.yaml', index);

  const before = await loadProject('手写世界书', root);
  const idBefore = before.card.data.character_book.entries[0].id;
  const result = await organizeWorldbook('手写世界书', root);
  assert.equal(result.organized, true);
  assert.deepEqual(result.changes, [{
    from: 'src/worldbook/uncategorized/甲.yaml',
    to: 'src/worldbook/uncategorized/甲.yaml',
    bodyFrom: 'src/worldbook/uncategorized/甲.md',
    bodyTo: 'src/worldbook/uncategorized/甲.md',
  }], '路径已经在目标位置，只固化 ID 与关联');
  const after = await loadProject('手写世界书', root);
  assert.deepEqual(semanticDiff(before.card, after.card), [], '整理不改动卡内容');
  assert.equal(after.card.data.character_book.entries[0].id, idBefore, 'ID 固化后不再变化');
  const recorded = (await findWorldbook(dir, '甲')).config;
  assert.equal(typeof recorded.link, 'string', '补上关联');
  const state = JSON.parse(await readText(dir, '.card/state.json'));
  assert.equal(Object.keys(state.records).length, 1);
  assert.equal(state.records[recorded.link].kind, 'worldbook');
  assert.equal(state.records[recorded.link].base.id, idBefore);

  const stable = await snapshot(dir);
  assert.deepEqual(await organizeWorldbook('手写世界书', root), { name: '手写世界书', ok: true, organized: false, changes: [] }, '重复执行无改动');
  assert.deepEqual(await snapshot(dir), stable, '第二次整理不写文件');
});

test("new-layout unlinked entries receive stable IDs alongside existing recorded entries", async t => {
  const root = await tempRoot(t, 'tcs-layout-fixid-mixed-');
  await importCard(root, '混合固化', bookCard('混合固化', [entry(1, "World setting", '世界观正文')]));
  const dir = path.join(root, 'cards', '混合固化');
  // The handwritten entry already occupies its target path but has no link or matching recorded path.
  await writeYAML(dir, 'src/worldbook/uncategorized/甲.yaml', { name: '甲', keys: ['甲'], file: 'src/worldbook/uncategorized/甲.md' });
  await writeText(dir, 'src/worldbook/uncategorized/甲.md', '甲正文');
  const index = await readYAML(dir, 'src/index.yaml');
  index.worldbook.entries.push('src/worldbook/uncategorized/甲.yaml');
  await writeYAML(dir, 'src/index.yaml', index);

  const before = await loadProject('混合固化', root);
  const idBefore = before.card.data.character_book.entries.find(item => item.comment === '甲').id;
  const result = await organizeWorldbook('混合固化', root);
  assert.equal(result.organized, true);
  const after = await loadProject('混合固化', root);
  assert.equal(after.card.data.character_book.entries.find(item => item.comment === '甲').id, idBefore, 'ID 固化后不再变化');
  assert.equal(typeof (await findWorldbook(dir, '甲')).config.link, 'string', '补上关联');
  assert.deepEqual(semanticDiff(before.card, after.card), [], '整理不改动卡内容');

  const stable = await snapshot(dir);
  assert.deepEqual(await organizeWorldbook('混合固化', root), { name: '混合固化', ok: true, organized: false, changes: [] }, '重复执行无改动');
  assert.deepEqual(await snapshot(dir), stable, '第二次整理不写文件');
});

test("organize rejects invalid state without modifying the project", async t => {
  const root = await tempRoot(t, 'tcs-layout-state-');
  await importCard(root, '破坏', bookCard('破坏', [entry(1, '甲', '甲正文')]));
  const dir = path.join(root, 'cards', '破坏');
  const state = JSON.parse(await readText(dir, '.card/state.json'));
  state.card.data.first_mes = '被改过的正文';
  await writeText(dir, '.card/state.json', jsonText(state));

  const before = await snapshot(dir);
  await assert.rejects(() => organizeWorldbook('破坏', root), /Compatibility data checksum failed/);
  assert.deepEqual(await snapshot(dir), before, '拒绝后工程不变');
  assert.equal(await hasFile(root, 'work/layout-backups'), false, '不留下备份目录');
});

test("organize rejects project or backup directories using directory links", async t => {
  const root = await tempRoot(t, 'tcs-layout-link-');
  await importCard(root, '链接卡', bookCard('链接卡', [entry(1, '甲', '甲正文')]));
  const dir = path.join(root, 'cards', '链接卡');
  const generated = await findWorldbook(dir, '甲');
  const config = { ...(await readYAML(dir, generated.file)) };
  delete config.link;
  await writeYAML(dir, generated.file, config);

  const real = path.join(root, 'real-链接卡');
  await fs.rename(dir, real);
  if (!await junction(real, dir)) { t.skip('当前环境不能创建目录链接'); return; }
  await assert.rejects(() => organizeWorldbook('链接卡', root), /Directory cannot be a link or special file/);
  assert.equal((await readYAML(real, generated.file)).link, undefined, '拒绝后工程没有改动');
  assert.equal(await hasFile(root, 'work/layout-backups'), false, '没有写出备份');

  const root2 = await tempRoot(t, 'tcs-layout-link2-');
  await importCard(root2, '链接备份', bookCard('链接备份', [entry(1, '甲', '甲正文')]));
  const dir2 = path.join(root2, 'cards', '链接备份');
  const generated2 = await findWorldbook(dir2, '甲');
  const config2 = { ...(await readYAML(dir2, generated2.file)) };
  delete config2.link;
  await writeYAML(dir2, generated2.file, config2);
  const elsewhere = path.join(root2, 'elsewhere');
  await fs.mkdir(elsewhere, { recursive: true });
  await fs.mkdir(path.join(root2, 'work'), { recursive: true });
  if (!await junction(elsewhere, path.join(root2, 'work', 'layout-backups'))) { t.skip('当前环境不能创建目录链接'); return; }
  await assert.rejects(() => organizeWorldbook('链接备份', root2), /Directory cannot be a link or special file/);
  assert.deepEqual(await fs.readdir(elsewhere), [], '备份不能写进链接目标');
  assert.equal((await readYAML(dir2, generated2.file)).link, undefined, '拒绝后工程没有改动');
});

// ---------- Worldbooks created from templates ----------

test("newCard places worldbook entries by template category with body paths controlled by the index and configuration", async t => {
  const root = await tempRoot(t, 'tcs-layout-newcard-');
  const dir = await newCard('模板卡', { root, modules: ['worldbook'] });
  const entries = await worldbookEntries(dir);
  assert.deepEqual(entries.map(item => [item.config.name, item.config.file]), [
    ["World setting", 'src/worldbook/setting/World setting.md'],
    ["Geography overview", 'src/worldbook/geography/Geography overview.md'],
    ["Used bookshop", 'src/worldbook/geography/Used bookshop.md'],
    ["Character overview", 'src/worldbook/characters/Character overview.md'],
    ["Bookseller", 'src/worldbook/characters/Bookseller.md'],
    ["Knowledge boundaries", 'src/worldbook/rules/Knowledge boundaries.md'],
  ], '模板 category 决定分类，正文与配置同 stem');
  for (const item of entries) assert.equal(await hasFile(dir, item.config.file), true, item.config.file);
});
