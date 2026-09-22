// 世界书目录布局与世界书整理：只使用公开 API 的独立测试。
// 只依赖 tools/lib/{worldbook-layout,organize,project,authoring,templates,files}.mjs 与 node:test；不改动工具实现。
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

// ---------- 测试辅助 ----------

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
  // 只记相对路径与 sha256：断言失败时打印的是路径和哈希，不会带出卡正文。
  const result = {};
  for (const file of (await walk(dir)).sort()) result[path.relative(dir, file).split(path.sep).join('/')] = sha256(await fs.readFile(file));
  return result;
}
// Windows 上 junction 不需要管理员权限；环境不支持目录链接时返回 false，由调用方跳过。
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
  for (const file of index.世界书.条目) result.push({ file, config: await readYAML(dir, file) });
  return result;
}
async function findWorldbook(dir, title) {
  const found = (await worldbookEntries(dir)).find(item => item.config.名称 === title);
  assert.ok(found, `世界书条目应存在: ${title}`);
  return found;
}
// 手动把配置与正文搬成旧扁平布局，并同步 index 引用；正文内容原样搬走。
async function flattenEntry(dir, from, file, body) {
  const config = await readYAML(dir, from);
  await writeText(dir, body, await readText(dir, config.文件));
  await writeYAML(dir, file, { ...config, 文件: body });
  await fs.rm(path.join(dir, from));
  await fs.rm(path.join(dir, config.文件));
  const index = await readYAML(dir, 'src/index.yaml');
  index.世界书.条目 = index.世界书.条目.map(item => (item === from ? file : item));
  await writeYAML(dir, 'src/index.yaml', index);
  return config;
}

// ---------- 标题分类 ----------

test('worldbookLocation 只按显式标签、协议名与惯例总览名分类', () => {
  assert.deepEqual(worldbookLocation('甲'), { folder: '未分类', label: '甲' });
  assert.deepEqual(worldbookLocation('雾岭'), { folder: '未分类', label: '雾岭' }, '地名不当作分类');
  assert.deepEqual(worldbookLocation('甲-乙'), { folder: '未分类', label: '甲-乙' }, '前缀不是分类词时保留整个标题');
  assert.deepEqual(worldbookLocation('地理-雾岭'), { folder: '地理', label: '雾岭' });
  assert.deepEqual(worldbookLocation('地理：雾岭'), { folder: '地理', label: '雾岭' });
  assert.deepEqual(worldbookLocation('【角色】店主'), { folder: '角色', label: '店主' });
  assert.deepEqual(worldbookLocation('设定-世界的规则'), { folder: '世界设定', label: '世界的规则' });
  assert.deepEqual(worldbookLocation('世界观'), { folder: '世界设定', label: '世界观' });
  assert.deepEqual(worldbookLocation('世界总览'), { folder: '世界设定', label: '世界总览' });
  assert.deepEqual(worldbookLocation('地理总览'), { folder: '地理', label: '地理总览' });
  assert.deepEqual(worldbookLocation('角色总览'), { folder: '角色', label: '角色总览' });
  assert.deepEqual(worldbookLocation('人物总览'), { folder: '角色', label: '人物总览' });
  assert.deepEqual(worldbookLocation(undefined), { folder: '未分类', label: '未命名' });
  assert.deepEqual(worldbookLocation('[initvar]变量初始化勿开'), { folder: '变量', label: '[initvar]变量初始化勿开' });
  assert.deepEqual(worldbookLocation('[mvu_update]变量更新规则'), { folder: '变量', label: '[mvu_update]变量更新规则' });
  assert.deepEqual(worldbookLocation('变量列表'), { folder: '变量', label: '变量列表' });
  // 已有分类目录优先，标题里的前缀只用来整理文件名。
  assert.deepEqual(worldbookLocation('甲', '我的分类'), { folder: '我的分类', label: '甲' });
  assert.deepEqual(worldbookLocation('地理-雾岭', '我的分类'), { folder: '我的分类', label: '雾岭' });
});

test('fileLabel 与 allocateWorldbook 防覆盖：同名、大小写与 Windows 保留名', () => {
  assert.equal(fileLabel('甲.'), '甲');
  assert.equal(fileLabel('   '), '未命名');
  assert.equal(fileLabel('.'), '未命名');
  assert.equal(fileLabel('..'), '未命名');
  assert.equal(fileLabel('a/b'), 'a_b');
  assert.equal(fileLabel('甲'.repeat(100)).length, 64, '文件名有长度上限');
  for (const reserved of ['CON', 'con', 'NUL.txt', 'aux', 'lpt1', 'com9']) assert.equal(fileLabel(reserved), '_' + reserved, reserved + ' 是 Windows 保留名');

  // occupied 里的键按小写登记，候选名也按小写比较，所以大小写不同也算同名。
  const occupied = new Set();
  assert.equal(allocateWorldbook('Geography', { occupied }), 'src/worldbook/未分类/Geography');
  assert.equal(allocateWorldbook('geography', { occupied }), 'src/worldbook/未分类/geography (2)');
  assert.equal(allocateWorldbook('Geography', { occupied }), 'src/worldbook/未分类/Geography (3)');
  assert.equal(allocateWorldbook('未命名', { occupied: new Set() }), 'src/worldbook/未分类/未命名');
  assert.equal(allocateWorldbook('CON', { occupied: new Set() }), 'src/worldbook/未分类/_CON');
  // 只检查 extensions 里列出的扩展名，调用方决定哪些文件算占用。
  assert.equal(allocateWorldbook('甲', { extensions: ['.md'], occupied: new Set(['src/worldbook/未分类/甲.md']) }), 'src/worldbook/未分类/甲 (2)');
  assert.equal(allocateWorldbook('甲', { extensions: ['.md'], occupied: new Set(['src/worldbook/未分类/甲.yaml']) }), 'src/worldbook/未分类/甲');

  for (const folder of ['../外面', '地理/../外面', 'CON', '']) assert.throws(() => allocateWorldbook('甲', { folder }), /无效世界书分类目录/, folder + ' 不能当分类目录');

  assert.equal(existingWorldbookFolder('src/worldbook/我的分类/甲.yaml'), '我的分类');
  assert.equal(existingWorldbookFolder('src/worldbook/a/b/甲.yaml'), 'a/b');
  assert.equal(existingWorldbookFolder('src/worldbook/甲.yaml'), undefined, '扁平文件没有已有分类');
  assert.equal(existingWorldbookFolder('src/regex/甲.yaml'), undefined);
});

test('分类不猜内容：导入卡按标题落位，正文与注入位置不参与', async t => {
  const root = await tempRoot(t, 'tcs-layout-guess-');
  const card = bookCard('不猜分类', [
    { ...entry(1, '甲', '地理总览：山与河。角色总览：店主。规则：不得出界。'), constant: true, extensions: { position: 4, depth: 2, role: 1 } },
    entry(2, '旧书店', '地点描述：旧书店在雾岭。地点词与内容都不是分类依据。'),
    { ...entry(3, '信息边界', '总规则正文'), constant: true },
    entry(4, '地理总览', '地理正文'),
    entry(5, '世界观', '世界观正文'),
    entry(6, '[initvar]变量初始化勿开', '变量正文'),
  ]);
  const dir = await importCard(root, '不猜分类', card);
  const entries = await worldbookEntries(dir);
  assert.deepEqual(entries.map(item => item.file), [
    'src/worldbook/未分类/甲.yaml',
    'src/worldbook/未分类/旧书店.yaml',
    'src/worldbook/未分类/信息边界.yaml',
    'src/worldbook/地理/地理总览.yaml',
    'src/worldbook/世界设定/世界观.yaml',
    'src/worldbook/变量/[initvar]变量初始化勿开.yaml',
  ], '只有显式标签、协议名与惯例总览名才决定分类');
  assert.deepEqual(entries.map(item => item.config.文件), [
    'src/worldbook/未分类/甲.md',
    'src/worldbook/未分类/旧书店.md',
    'src/worldbook/未分类/信息边界.md',
    'src/worldbook/地理/地理总览.md',
    'src/worldbook/世界设定/世界观.md',
    'src/worldbook/变量/[initvar]变量初始化勿开.md',
  ]);
  assert.deepEqual((await fs.readdir(path.join(dir, 'src/worldbook'))).sort(), ['世界设定', '地理', '未分类', '变量'].sort());

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

// ---------- 拆分保真 ----------

test('split JSON 保真：宏与 EJS 原字节写入，未知元数据不执行不改写', async t => {
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
          { id: 3, keys: ['旧书店'], comment: '旧书店', content: macroBody, enabled: true, constant: false, extensions: { position: 0, depth: 4, role: 0, 未知扩展: '保留' }, 未知条目字段: { keep: [1, 2] } },
          entry(4, '甲', '甲的内容'),
        ],
      },
    },
  };
  const dir = await importCard(root, '宏卡', card);
  const loaded = await loadProject('宏卡', root);
  assert.deepEqual(semanticDiff(card, loaded.card), [], '拆分再加载逐字等价');

  const bookshop = await findWorldbook(dir, '旧书店');
  assert.equal(await readText(dir, bookshop.config.文件), macroBody, '正文按原字节写入');
  assert.equal((await fs.readFile(path.join(dir, bookshop.config.文件))).equals(Buffer.from(macroBody, 'utf8')), true, '宏与 EJS 不被执行或改写');
  assert.equal(await readText(dir, 'src/text/description.md'), macroBody);
  assert.deepEqual(loaded.card['未知卡级'], { keep: [1, '甲'] });
  assert.deepEqual(loaded.card.data.extensions['第三方插件'], { nested: [{ deep: [1] }] });
  assert.deepEqual(loaded.card.data.character_book['未知世界书字段'], { keep: true });
  assert.deepEqual(loaded.card.data.character_book.entries[0]['未知条目字段'], { keep: [1, 2] });
  assert.equal(loaded.card.data.character_book.entries[0].extensions['未知扩展'], '保留');
  assert.equal(await readText(dir, (await findWorldbook(dir, '甲')).config.文件), '甲的内容');
});

// ---------- 整理旧布局 ----------

test('organize 把扁平旧布局整理进分类目录，整卡保真并留下备份', async t => {
  const root = await tempRoot(t, 'tcs-layout-organize-');
  const card = bookCard('扁平', [
    { ...entry(1, '世界观', '世界观正文'), constant: true },
    { ...entry(2, '地理-雾岭', '雾岭正文'), 未知条目字段: { keep: true } },
    entry(3, '甲', '甲正文'),
  ]);
  const dir = await importCard(root, '扁平', card);
  for (const [i, item] of (await worldbookEntries(dir)).entries()) {
    const stem = `00${i + 1}-${item.config.名称}`;
    await flattenEntry(dir, item.file, `src/worldbook/${stem}.yaml`, `src/worldbook/${stem}.md`);
  }
  const before = await loadProject('扁平', root);
  const result = await organizeWorldbook('扁平', root);

  assert.equal(result.ok, true);
  assert.equal(result.organized, true);
  assert.deepEqual(result.changes.map(change => [change.from, change.to, change.bodyFrom, change.bodyTo]), [
    ['src/worldbook/001-世界观.yaml', 'src/worldbook/世界设定/世界观.yaml', 'src/worldbook/001-世界观.md', 'src/worldbook/世界设定/世界观.md'],
    ['src/worldbook/002-地理-雾岭.yaml', 'src/worldbook/地理/雾岭.yaml', 'src/worldbook/002-地理-雾岭.md', 'src/worldbook/地理/雾岭.md'],
    ['src/worldbook/003-甲.yaml', 'src/worldbook/未分类/甲.yaml', 'src/worldbook/003-甲.md', 'src/worldbook/未分类/甲.md'],
  ]);
  assert.equal(await hasFile(dir, 'src/worldbook/001-世界观.yaml'), false, '旧扁平配置不再留在工程里');
  assert.equal(await readText(dir, 'src/worldbook/地理/雾岭.md'), '雾岭正文');

  const after = await loadProject('扁平', root);
  assert.deepEqual(semanticDiff(before.card, after.card), [], '整理只改文件位置');
  assert.deepEqual(after.project.builds, before.project.builds);
  assert.deepEqual((await readYAML(dir, 'src/index.yaml')).世界书.条目, [
    'src/worldbook/世界设定/世界观.yaml',
    'src/worldbook/地理/雾岭.yaml',
    'src/worldbook/未分类/甲.yaml',
  ], '索引指向新路径');

  assert.match(result.backup, /^work\/layout-backups\/扁平-[0-9a-f-]{36}$/, '备份落在 work/layout-backups');
  assert.equal(await hasFile(root, path.join(result.backup, 'src/worldbook/001-世界观.yaml')), true, '备份保留整理前的旧路径');
  assert.equal(await readText(root, path.join(result.backup, 'src/worldbook/001-世界观.md')), '世界观正文');
  assert.equal(await hasFile(root, path.join(result.backup, 'src/index.yaml')), true);

  const stable = await snapshot(dir);
  const again = await organizeWorldbook('扁平', root);
  assert.deepEqual(again, { name: '扁平', ok: true, organized: false, changes: [] }, '重复执行无改动');
  assert.deepEqual(await snapshot(dir), stable, '第二次整理不写文件');
  assert.equal((await fs.readdir(path.join(root, 'work/layout-backups'))).length, 1, '重复执行不再新增备份');
  assert.deepEqual((await fs.readdir(path.join(root, 'cards'))).filter(name => name.startsWith('.tmp-')), [], '不留临时目录');
});

test('organize 保留已有嵌套分类，只在同目录内整理文件名', async t => {
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
  assert.equal(await hasFile(dir, 'src/worldbook/地理/雾岭.yaml'), false, '不搬到标题对应的类别目录');
  const after = await loadProject('嵌套', root);
  assert.equal(after.card.data.character_book.entries[0].content, '雾岭正文');
});

test('organize 支持只改大小写的重命名，磁盘文件名与数据都正确', async t => {
  const root = await tempRoot(t, 'tcs-layout-case-');
  const card = bookCard('大小写', [{ ...entry(1, 'abc', 'abc 正文'), 未知条目字段: { keep: true } }]);
  await importCard(root, '大小写', card);
  const dir = path.join(root, 'cards', '大小写');
  const generated = await findWorldbook(dir, 'abc');
  await writeYAML(dir, generated.file, { ...(await readYAML(dir, generated.file)), 名称: 'ABC' });

  const before = await loadProject('大小写', root);
  const result = await organizeWorldbook('大小写', root);
  assert.equal(result.organized, true);
  assert.deepEqual(result.changes, [{
    from: 'src/worldbook/未分类/abc.yaml',
    to: 'src/worldbook/未分类/ABC.yaml',
    bodyFrom: 'src/worldbook/未分类/abc.md',
    bodyTo: 'src/worldbook/未分类/ABC.md',
  }]);
  assert.deepEqual((await fs.readdir(path.join(dir, 'src/worldbook/未分类'))).sort(), ['ABC.md', 'ABC.yaml'], '磁盘上是新的大小写，旧名字不再存在');
  assert.equal(await readText(dir, 'src/worldbook/未分类/ABC.md'), 'abc 正文', '正文数据不变');
  assert.deepEqual((await readYAML(dir, 'src/index.yaml')).世界书.条目, ['src/worldbook/未分类/ABC.yaml']);

  const after = await loadProject('大小写', root);
  assert.equal(after.card.data.character_book.entries[0].comment, 'ABC');
  assert.equal(after.card.data.character_book.entries[0].content, 'abc 正文');
  assert.deepEqual(after.card.data.character_book.entries[0].未知条目字段, { keep: true });
  assert.deepEqual(semanticDiff(before.card, after.card), [], '整理只改文件名大小写，卡数据不变');
});

test('organize 不覆盖未引用文件，目标被占用时顺延命名', async t => {
  const root = await tempRoot(t, 'tcs-layout-occupied-');
  await importCard(root, '占位', bookCard('占位', [entry(1, '甲', '甲正文')]));
  const dir = path.join(root, 'cards', '占位');
  const generated = await findWorldbook(dir, '甲');
  await flattenEntry(dir, generated.file, 'src/worldbook/001-甲.yaml', 'src/worldbook/001-甲.md');
  // 目标位置放一份没有被 index 引用的世界书文件，整理不能踩掉它。
  await writeText(dir, 'src/worldbook/未分类/甲.yaml', '名称: 未引用');
  await writeText(dir, 'src/worldbook/未分类/甲.md', '未引用正文');

  const result = await organizeWorldbook('占位', root);
  assert.deepEqual(result.changes, [{
    from: 'src/worldbook/001-甲.yaml',
    to: 'src/worldbook/未分类/甲 (2).yaml',
    bodyFrom: 'src/worldbook/001-甲.md',
    bodyTo: 'src/worldbook/未分类/甲 (2).md',
  }]);
  assert.equal(await readText(dir, 'src/worldbook/未分类/甲.yaml'), '名称: 未引用', '未引用配置不动');
  assert.equal(await readText(dir, 'src/worldbook/未分类/甲.md'), '未引用正文', '未引用正文不动');
  assert.equal(await readText(dir, 'src/worldbook/未分类/甲 (2).md'), '甲正文');
  const after = await loadProject('占位', root);
  assert.equal(after.card.data.character_book.entries[0].content, '甲正文');
});

test('organize 不搬动可执行条目的正文与构建入口', async t => {
  const root = await tempRoot(t, 'tcs-layout-build-');
  await importCard(root, '构建', bookCard('构建', [entry(1, '甲', '甲正文')]));
  const dir = path.join(root, 'cards', '构建');
  const generated = await findWorldbook(dir, '甲');
  const config = { ...(await readYAML(dir, generated.file)), 文件: 'src/worldbook/001-甲.md', 构建: { 类型: 'script', 入口: 'src/worldbook/001-甲.js' } };
  await writeYAML(dir, 'src/worldbook/001-甲.yaml', config);
  await writeText(dir, 'src/worldbook/001-甲.md', '甲正文');
  await writeText(dir, 'src/worldbook/001-甲.js', 'console.info("甲构建");');
  await fs.rm(path.join(dir, generated.file));
  await fs.rm(path.join(dir, generated.config.文件));
  const index = await readYAML(dir, 'src/index.yaml');
  index.世界书.条目 = ['src/worldbook/001-甲.yaml'];
  await writeYAML(dir, 'src/index.yaml', index);

  const before = await loadProject('构建', root);
  assert.deepEqual(before.project.builds, [{ kind: 'script', entry: 'src/worldbook/001-甲.js', pointer: '/data/character_book/entries/0/content' }]);
  const result = await organizeWorldbook('构建', root);
  assert.deepEqual(result.changes, [{
    from: 'src/worldbook/001-甲.yaml',
    to: 'src/worldbook/未分类/甲.yaml',
    bodyFrom: 'src/worldbook/001-甲.md',
    bodyTo: 'src/worldbook/001-甲.md',
  }], '只整理配置，正文保持原位');

  const after = await loadProject('构建', root);
  assert.deepEqual(after.project.builds, before.project.builds, '构建入口不变');
  assert.equal(await hasFile(dir, 'src/worldbook/001-甲.md'), true);
  assert.equal(await readText(dir, 'src/worldbook/001-甲.js'), 'console.info("甲构建");');
  assert.equal(after.project.fields.find(field => field.pointer.endsWith('/content')).file, 'src/worldbook/001-甲.md');
  assert.equal(after.card.data.character_book.entries[0].content, '甲正文');
});

test('缺 关联 时 organize 通过 state 记录的路径找回原条目', async t => {
  const root = await tempRoot(t, 'tcs-layout-recover-');
  const card = bookCard('找回', [{ ...entry(7, '甲', '甲正文'), 未知条目字段: { keep: [1, 2] } }]);
  await importCard(root, '找回', card);
  const dir = path.join(root, 'cards', '找回');
  const generated = await findWorldbook(dir, '甲');
  const config = { ...(await readYAML(dir, generated.file)), 名称: '甲-乙' };
  delete config.关联;
  await writeYAML(dir, generated.file, config);

  const before = await loadProject('找回', root);
  assert.equal(before.card.data.character_book.entries[0].id, 7, '缺关联时先按记录路径找回原 ID');
  const result = await organizeWorldbook('找回', root);
  assert.deepEqual(result.changes, [{
    from: 'src/worldbook/未分类/甲.yaml',
    to: 'src/worldbook/未分类/甲-乙.yaml',
    bodyFrom: 'src/worldbook/未分类/甲.md',
    bodyTo: 'src/worldbook/未分类/甲-乙.md',
  }]);

  const after = await loadProject('找回', root);
  assert.deepEqual(semanticDiff(before.card, after.card), [], '整理不改动卡内容');
  assert.equal(after.card.data.character_book.entries[0].id, 7);
  assert.deepEqual(after.card.data.character_book.entries[0].未知条目字段, { keep: [1, 2] });
  assert.deepEqual(after.unreferenced, [], '没有丢下旧记录');
  const state = JSON.parse(await readText(dir, '.card/state.json'));
  const restored = (await findWorldbook(dir, '甲-乙')).config;
  assert.equal(Object.keys(state.records).length, 1, '找回原记录而不是新建');
  assert.equal(state.records[restored.关联].kind, 'worldbook');
  assert.deepEqual(state.records[restored.关联].base.未知条目字段, { keep: [1, 2] });
});

test('旧条目缺 关联 且已在目标路径时补回关联，重复执行不变', async t => {
  const root = await tempRoot(t, 'tcs-layout-rekey-');
  const card = bookCard('补回', [{ ...entry(7, '甲', '甲正文'), 未知条目字段: { keep: [1, 2] } }]);
  await importCard(root, '补回', card);
  const dir = path.join(root, 'cards', '补回');
  const generated = await findWorldbook(dir, '甲');
  const config = { ...(await readYAML(dir, generated.file)) };
  delete config.关联;
  await writeYAML(dir, generated.file, config);

  const before = await loadProject('补回', root);
  const first = await organizeWorldbook('补回', root);
  assert.equal(first.organized, true);
  assert.deepEqual(first.changes, [{
    from: 'src/worldbook/未分类/甲.yaml',
    to: 'src/worldbook/未分类/甲.yaml',
    bodyFrom: 'src/worldbook/未分类/甲.md',
    bodyTo: 'src/worldbook/未分类/甲.md',
  }], '路径不变，只补关联与记录');
  assert.equal(typeof (await findWorldbook(dir, '甲')).config.关联, 'string');
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

test('新增的无关联条目在整理后保留原 ID 并补上关联', async t => {
  const root = await tempRoot(t, 'tcs-layout-newitem-');
  await importCard(root, '新增', bookCard('新增', [entry(1, '世界观', '世界观正文')]));
  const dir = path.join(root, 'cards', '新增');
  // 手写一条新的扁平世界书文件：没有 关联，路径也不在 state 记录里。
  await writeYAML(dir, 'src/worldbook/004-新条目.yaml', { 名称: '新条目', 关键词: ['新条目'], 文件: 'src/worldbook/004-新条目.md' });
  await writeText(dir, 'src/worldbook/004-新条目.md', '新条目正文');
  const index = await readYAML(dir, 'src/index.yaml');
  index.世界书.条目.push('src/worldbook/004-新条目.yaml');
  await writeYAML(dir, 'src/index.yaml', index);

  const before = await loadProject('新增', root);
  const idBefore = before.card.data.character_book.entries.find(item => item.comment === '新条目').id;
  const result = await organizeWorldbook('新增', root);
  assert.equal(result.organized, true);
  assert.deepEqual(result.changes, [{
    from: 'src/worldbook/004-新条目.yaml',
    to: 'src/worldbook/未分类/新条目.yaml',
    bodyFrom: 'src/worldbook/004-新条目.md',
    bodyTo: 'src/worldbook/未分类/新条目.md',
  }]);

  const after = await loadProject('新增', root);
  assert.deepEqual(semanticDiff(before.card, after.card), [], '整理只改文件位置');
  assert.equal(typeof (await findWorldbook(dir, '新条目')).config.关联, 'string', '整理后补上关联');
  assert.equal(after.card.data.character_book.entries.find(item => item.comment === '新条目').id, idBefore, 'ID 由首次加载确定后不再变化');
});

test('符合新布局但无关联的条目整理后固化 ID，重复执行不变', async t => {
  const root = await tempRoot(t, 'tcs-layout-fixid-');
  // 不带世界书模板的工程：条目完全手写，state 里没有任何世界书记录。
  await newCard('手写世界书', { root });
  const dir = path.join(root, 'cards', '手写世界书');
  await writeYAML(dir, 'src/worldbook/未分类/甲.yaml', { 名称: '甲', 关键词: ['甲'], 文件: 'src/worldbook/未分类/甲.md' });
  await writeText(dir, 'src/worldbook/未分类/甲.md', '甲正文');
  const index = await readYAML(dir, 'src/index.yaml');
  index.世界书.条目 = ['src/worldbook/未分类/甲.yaml'];
  await writeYAML(dir, 'src/index.yaml', index);

  const before = await loadProject('手写世界书', root);
  const idBefore = before.card.data.character_book.entries[0].id;
  const result = await organizeWorldbook('手写世界书', root);
  assert.equal(result.organized, true);
  assert.deepEqual(result.changes, [{
    from: 'src/worldbook/未分类/甲.yaml',
    to: 'src/worldbook/未分类/甲.yaml',
    bodyFrom: 'src/worldbook/未分类/甲.md',
    bodyTo: 'src/worldbook/未分类/甲.md',
  }], '路径已经在目标位置，只固化 ID 与关联');
  const after = await loadProject('手写世界书', root);
  assert.deepEqual(semanticDiff(before.card, after.card), [], '整理不改动卡内容');
  assert.equal(after.card.data.character_book.entries[0].id, idBefore, 'ID 固化后不再变化');
  const recorded = (await findWorldbook(dir, '甲')).config;
  assert.equal(typeof recorded.关联, 'string', '补上关联');
  const state = JSON.parse(await readText(dir, '.card/state.json'));
  assert.equal(Object.keys(state.records).length, 1);
  assert.equal(state.records[recorded.关联].kind, 'worldbook');
  assert.equal(state.records[recorded.关联].base.id, idBefore);

  const stable = await snapshot(dir);
  assert.deepEqual(await organizeWorldbook('手写世界书', root), { name: '手写世界书', ok: true, organized: false, changes: [] }, '重复执行无改动');
  assert.deepEqual(await snapshot(dir), stable, '第二次整理不写文件');
});

test('工程里已有带记录的条目时，符合新布局的无关联条目同样固化 ID', async t => {
  const root = await tempRoot(t, 'tcs-layout-fixid-mixed-');
  await importCard(root, '混合固化', bookCard('混合固化', [entry(1, '世界观', '世界观正文')]));
  const dir = path.join(root, 'cards', '混合固化');
  // 手写的新条目已经在目标路径上，没有 关联，也没有可以按路径匹配的记录。
  await writeYAML(dir, 'src/worldbook/未分类/甲.yaml', { 名称: '甲', 关键词: ['甲'], 文件: 'src/worldbook/未分类/甲.md' });
  await writeText(dir, 'src/worldbook/未分类/甲.md', '甲正文');
  const index = await readYAML(dir, 'src/index.yaml');
  index.世界书.条目.push('src/worldbook/未分类/甲.yaml');
  await writeYAML(dir, 'src/index.yaml', index);

  const before = await loadProject('混合固化', root);
  const idBefore = before.card.data.character_book.entries.find(item => item.comment === '甲').id;
  const result = await organizeWorldbook('混合固化', root);
  assert.equal(result.organized, true);
  const after = await loadProject('混合固化', root);
  assert.equal(after.card.data.character_book.entries.find(item => item.comment === '甲').id, idBefore, 'ID 固化后不再变化');
  assert.equal(typeof (await findWorldbook(dir, '甲')).config.关联, 'string', '补上关联');
  assert.deepEqual(semanticDiff(before.card, after.card), [], '整理不改动卡内容');

  const stable = await snapshot(dir);
  assert.deepEqual(await organizeWorldbook('混合固化', root), { name: '混合固化', ok: true, organized: false, changes: [] }, '重复执行无改动');
  assert.deepEqual(await snapshot(dir), stable, '第二次整理不写文件');
});

test('state 校验失败时 organize 拒绝并且不改动工程', async t => {
  const root = await tempRoot(t, 'tcs-layout-state-');
  await importCard(root, '破坏', bookCard('破坏', [entry(1, '甲', '甲正文')]));
  const dir = path.join(root, 'cards', '破坏');
  const state = JSON.parse(await readText(dir, '.card/state.json'));
  state.card.data.first_mes = '被改过的正文';
  await writeText(dir, '.card/state.json', jsonText(state));

  const before = await snapshot(dir);
  await assert.rejects(() => organizeWorldbook('破坏', root), /兼容数据校验失败/);
  assert.deepEqual(await snapshot(dir), before, '拒绝后工程不变');
  assert.equal(await hasFile(root, 'work/layout-backups'), false, '不留下备份目录');
});

test('organize 拒绝把工程目录或备份目录放在目录链接上', async t => {
  const root = await tempRoot(t, 'tcs-layout-link-');
  await importCard(root, '链接卡', bookCard('链接卡', [entry(1, '甲', '甲正文')]));
  const dir = path.join(root, 'cards', '链接卡');
  const generated = await findWorldbook(dir, '甲');
  const config = { ...(await readYAML(dir, generated.file)) };
  delete config.关联;
  await writeYAML(dir, generated.file, config);

  const real = path.join(root, 'real-链接卡');
  await fs.rename(dir, real);
  if (!await junction(real, dir)) { t.skip('当前环境不能创建目录链接'); return; }
  await assert.rejects(() => organizeWorldbook('链接卡', root), /目录不能是链接或特殊文件/);
  assert.equal((await readYAML(real, generated.file)).关联, undefined, '拒绝后工程没有改动');
  assert.equal(await hasFile(root, 'work/layout-backups'), false, '没有写出备份');

  const root2 = await tempRoot(t, 'tcs-layout-link2-');
  await importCard(root2, '链接备份', bookCard('链接备份', [entry(1, '甲', '甲正文')]));
  const dir2 = path.join(root2, 'cards', '链接备份');
  const generated2 = await findWorldbook(dir2, '甲');
  const config2 = { ...(await readYAML(dir2, generated2.file)) };
  delete config2.关联;
  await writeYAML(dir2, generated2.file, config2);
  const elsewhere = path.join(root2, 'elsewhere');
  await fs.mkdir(elsewhere, { recursive: true });
  await fs.mkdir(path.join(root2, 'work'), { recursive: true });
  if (!await junction(elsewhere, path.join(root2, 'work', 'layout-backups'))) { t.skip('当前环境不能创建目录链接'); return; }
  await assert.rejects(() => organizeWorldbook('链接备份', root2), /目录不能是链接或特殊文件/);
  assert.deepEqual(await fs.readdir(elsewhere), [], '备份不能写进链接目标');
  assert.equal((await readYAML(dir2, generated2.file)).关联, undefined, '拒绝后工程没有改动');
});

// ---------- 模板新建的世界书 ----------

test('newCard 的世界书按模板分类落位，正文路径由 index 与配置决定', async t => {
  const root = await tempRoot(t, 'tcs-layout-newcard-');
  const dir = await newCard('模板卡', { root, modules: ['worldbook'] });
  const entries = await worldbookEntries(dir);
  assert.deepEqual(entries.map(item => [item.config.名称, item.config.文件]), [
    ['世界观', 'src/worldbook/世界设定/世界观.md'],
    ['地理总览', 'src/worldbook/地理/地理总览.md'],
    ['旧书店', 'src/worldbook/地理/旧书店.md'],
    ['角色总览', 'src/worldbook/角色/角色总览.md'],
    ['书店店主', 'src/worldbook/角色/书店店主.md'],
    ['信息边界', 'src/worldbook/规则/信息边界.md'],
  ], '模板 category 决定分类，正文与配置同 stem');
  for (const item of entries) assert.equal(await hasFile(dir, item.config.文件), true, item.config.文件);
});
