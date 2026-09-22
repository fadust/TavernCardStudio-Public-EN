// 世界书顺序重排（arrangeWorldbook）的独立测试：只使用公开 API 与 node:test，不触碰真实 cards/。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { newCard } from '../tools/lib/templates.mjs';
import { loadProject, semanticDiff, splitCard } from '../tools/lib/project.mjs';
import { readYAML, writeYAML } from '../tools/lib/authoring.mjs';
import { BUDGET_NOTICE, arrangeWorldbook } from '../tools/lib/arrange.mjs';
import { jsonText, sha256, walk } from '../tools/lib/files.mjs';

// ---------- 测试辅助 ----------

async function tempRoot(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  return root;
}
async function readText(dir, relative) { return fs.readFile(path.join(dir, relative), 'utf8'); }
async function writeText(dir, relative, content) {
  const file = path.join(dir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  return fs.writeFile(file, content);
}
async function hasFile(dir, relative) {
  try { await fs.access(path.join(dir, relative)); return true; } catch { return false; }
}
async function snapshot(dir) {
  const result = {};
  for (const file of (await walk(dir)).sort()) result[path.relative(dir, file).split(path.sep).join('/')] = sha256(await fs.readFile(file));
  return result;
}
async function tmpLeftovers(root) {
  const names = await fs.readdir(path.join(root, 'cards'));
  return names.filter(name => name.startsWith('.tmp-'));
}
function bookCard(name, entries) {
  return { spec: 'chara_card_v2', spec_version: '2.0', name, data: { name, first_mes: '你好', extensions: {}, character_book: { name, entries } } };
}
function entry(id, comment, content, spec = {}) {
  const { position = 0, order = 100, depth = 4, role = 0, extra = {}, ...rest } = spec;
  return {
    id, keys: [], comment, content, enabled: true, constant: false, insertion_order: order,
    position: position === 0 ? 'before_char' : 'after_char',
    extensions: { position, depth, role, ...extra },
    ...rest,
  };
}
// 导入卡里常见完全没有 extensions 的条目：只保留顶层字段。
function bareEntry(id, comment, content, position, order) {
  return { id, keys: [comment], comment, content, enabled: true, constant: false, insertion_order: order, position };
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
  assert.ok(found, '世界书条目应存在: ' + title);
  return found;
}
function outlineOf(card) {
  const copy = structuredClone(card);
  copy.data.character_book.entries = [];
  return copy;
}

// ---------- 手写条目 ----------

test('arrange 按 prompt 阅读序重排手写条目、连续编号并保持 ID', async t => {
  const root = await tempRoot(t, 'tcs-arrange-hand-');
  const dir = await newCard('手写序', { root });
  const 甲 = 'src/worldbook/未分类/甲.yaml';
  const 乙 = 'src/worldbook/未分类/乙.yaml';
  const 丙 = 'src/worldbook/未分类/丙.yaml';
  await writeYAML(dir, 甲, { 名称: '甲', 关键词: ['甲'], 顺序: 30, 位置: '角色定义之前', 文件: 'src/worldbook/未分类/甲.md' });
  await writeYAML(dir, 乙, { 名称: '乙', 关键词: ['乙'], 顺序: 20, 位置: '角色定义之后', 文件: 'src/worldbook/未分类/乙.md' });
  await writeYAML(dir, 丙, { 名称: '丙', 关键词: ['丙'], 顺序: 10, 位置: '角色定义之后', 文件: 'src/worldbook/未分类/丙.md' });
  await writeText(dir, 'src/worldbook/未分类/甲.md', '甲正文');
  await writeText(dir, 'src/worldbook/未分类/乙.md', '乙正文');
  await writeText(dir, 'src/worldbook/未分类/丙.md', '丙正文');
  const index = await readYAML(dir, 'src/index.yaml');
  index.世界书.条目 = [乙, 丙, 甲];
  await writeYAML(dir, 'src/index.yaml', index);

  const before = await loadProject('手写序', root);
  const ids = new Map(before.card.data.character_book.entries.map(item => [item.comment, item.id]));
  assert.deepEqual([...ids.keys()], ['乙', '丙', '甲'], '初始索引顺序就是乙、丙、甲');

  const result = await arrangeWorldbook('手写序', root);
  assert.equal(result.ok, true);
  assert.equal(result.arranged, true);
  assert.equal(result.order, 'prompt');
  assert.equal(result.budgetNotice, BUDGET_NOTICE);
  assert.match(result.budgetNotice, /预算/);
  assert.ok(result.backup.startsWith('work/order-backups/手写序-'), '备份落在 work/order-backups');
  assert.deepEqual(result.changes, [
    { name: '甲', file: 甲, from: 2, to: 0, orderFrom: 30, orderTo: 1 },
    { name: '丙', file: 丙, from: 1, to: 1, orderFrom: 10, orderTo: 2 },
    { name: '乙', file: 乙, from: 0, to: 2, orderFrom: 20, orderTo: 3 },
  ]);

  const after = await loadProject('手写序', root);
  assert.deepEqual(after.card.data.character_book.entries.map(item => [item.comment, item.insertion_order, item.extensions.display_index]), [['甲', 1, 0], ['丙', 2, 1], ['乙', 3, 2]]);
  assert.deepEqual(after.card.data.character_book.entries.map(item => [item.comment, item.id]), [['甲', ids.get('甲')], ['丙', ids.get('丙')], ['乙', ids.get('乙')]], '手写条目的 ID 不随重排变化');
  assert.deepEqual((await readYAML(dir, 'src/index.yaml')).世界书.条目, [甲, 丙, 乙]);
  assert.equal(await readText(dir, 'src/worldbook/未分类/乙.md'), '乙正文');
  assert.deepEqual(semanticDiff(outlineOf(before.card), outlineOf(after.card)), [], '条目以外的卡数据不变');

  // 备份保留重排前的完整工程
  assert.deepEqual((await readYAML(root, result.backup + '/src/index.yaml')).世界书.条目, [乙, 丙, 甲]);
  assert.equal((await readYAML(root, result.backup + '/' + 甲)).顺序, 30);
  assert.equal(await readText(root, result.backup + '/src/worldbook/未分类/甲.md'), '甲正文');

  // 目标序列与编号已满足：noop，不写文件、不新增备份
  const stable = await snapshot(dir);
  assert.deepEqual(await arrangeWorldbook('手写序', root), { name: '手写序', ok: true, arranged: false, order: 'prompt', backup: null, changes: [], budgetNotice: BUDGET_NOTICE });
  assert.deepEqual(await snapshot(dir), stable, '第二次重排不写文件');
  assert.equal((await fs.readdir(path.join(root, 'work/order-backups'))).length, 1, '重复执行不再新增备份');
  assert.deepEqual(await tmpLeftovers(root), []);
});

// ---------- 导入卡 ----------

test('arrange 保真导入卡的未知字段与构建绑定，构建指针随索引重排', async t => {
  const root = await tempRoot(t, 'tcs-arrange-import-');
  const card = bookCard('导入序', [
    entry(11, '店主', '店主正文', { position: 1, order: 10, extra: { 未知扩展: '保留' }, 未知条目字段: { keep: [1, 2] }, keys: ['店主', '老板'] }),
    { ...entry(12, '世界观', '世界观正文', { position: 0, order: 20 }), constant: true },
  ]);
  const dir = await importCard(root, '导入序', card);
  const world = await findWorldbook(dir, '世界观');
  const shop = await findWorldbook(dir, '店主');
  await writeYAML(dir, world.file, { ...world.config, 构建: { 类型: 'script', 入口: 'src/worldbook/未分类/世界观.js' } });
  await writeText(dir, 'src/worldbook/未分类/世界观.js', 'console.info("世界观");');

  const before = await loadProject('导入序', root);
  assert.deepEqual(before.project.builds, [{ kind: 'script', entry: 'src/worldbook/未分类/世界观.js', pointer: '/data/character_book/entries/1/content' }]);
  assert.deepEqual(before.card.data.character_book.entries.map(item => item.comment), ['店主', '世界观']);

  const result = await arrangeWorldbook('导入序', root);
  assert.equal(result.arranged, true);
  const after = await loadProject('导入序', root);
  assert.deepEqual(after.project.builds, [{ kind: 'script', entry: 'src/worldbook/未分类/世界观.js', pointer: '/data/character_book/entries/0/content' }], '构建指针跟着条目一起移动');
  assert.deepEqual((await readYAML(dir, 'src/index.yaml')).世界书.条目, [world.file, shop.file]);
  assert.deepEqual(after.card.data.character_book.entries.map(item => [item.comment, item.id, item.insertion_order, item.extensions.display_index]), [
    ['世界观', 12, 1, 0],
    ['店主', 11, 2, 1],
  ]);
  const moved = after.card.data.character_book.entries[1];
  assert.deepEqual(moved.未知条目字段, { keep: [1, 2] }, '未知条目字段保留');
  assert.equal(moved.extensions.未知扩展, '保留');
  assert.equal(moved.content, '店主正文');
  assert.deepEqual(moved.keys, ['店主', '老板'], '关键词保留');
  assert.equal(await readText(dir, 'src/worldbook/未分类/世界观.js'), 'console.info("世界观");');
  const stripSorting = item => {
    const copy = structuredClone(item);
    delete copy.insertion_order;
    if (copy.extensions) { delete copy.extensions.display_index; if (!Object.keys(copy.extensions).length) delete copy.extensions; }
    return copy;
  };
  const fingerprint = value => value.data.character_book.entries.map(item => JSON.stringify(stripSorting(item))).sort();
  assert.deepEqual(fingerprint(after.card), fingerprint(before.card), '除顺序编号与 display_index 外，条目内容集合不变');
  assert.deepEqual(semanticDiff(outlineOf(before.card), outlineOf(after.card)), [], '条目以外的卡数据不变');
  assert.deepEqual(await tmpLeftovers(root), []);
});

// ---------- 总索引注释 ----------

test('arrange 重排总索引时保留注释并让注释跟着条目移动', async t => {
  const root = await tempRoot(t, 'tcs-arrange-comment-');
  const dir = await newCard('注释序', { root });
  await writeYAML(dir, 'src/worldbook/未分类/甲.yaml', { 名称: '甲', 关键词: ['甲'], 顺序: 1, 位置: '角色定义之后', 文件: 'src/worldbook/未分类/甲.md' });
  await writeYAML(dir, 'src/worldbook/未分类/乙.yaml', { 名称: '乙', 关键词: ['乙'], 顺序: 2, 位置: '角色定义之前', 文件: 'src/worldbook/未分类/乙.md' });
  await writeText(dir, 'src/worldbook/未分类/甲.md', '甲正文');
  await writeText(dir, 'src/worldbook/未分类/乙.md', '乙正文');
  const raw = await readText(dir, 'src/index.yaml');
  const commented = raw.replace('  条目: []', ['  条目:', '    # 甲条目：角色定义之后', '    - src/worldbook/未分类/甲.yaml', '    - src/worldbook/未分类/乙.yaml # 乙条目：角色定义之前'].join('\n'));
  assert.notEqual(commented, raw, '测试要真的写入注释');
  await writeText(dir, 'src/index.yaml', commented);

  const result = await arrangeWorldbook('注释序', root);
  assert.equal(result.arranged, true);
  const text = await readText(dir, 'src/index.yaml');
  assert.ok(text.includes('    # 甲条目：角色定义之后\n    - src/worldbook/未分类/甲.yaml'), '条目注释跟着条目移动');
  assert.ok(text.includes('- src/worldbook/未分类/乙.yaml # 乙条目：角色定义之前'), '行内注释保留');
  assert.ok(text.indexOf('未分类/乙.yaml') < text.indexOf('未分类/甲.yaml'), '乙排在甲之前');
  assert.deepEqual((await readYAML(dir, 'src/index.yaml')).世界书.条目, ['src/worldbook/未分类/乙.yaml', 'src/worldbook/未分类/甲.yaml']);
});

// ---------- noop 与特殊位置 ----------

test('连续编号但缺 display_index 的导入卡在同一次重排里补齐展示序号', async t => {
  const root = await tempRoot(t, 'tcs-arrange-display-');
  const card = bookCard('补序号', [
    entry(1, '甲', '甲正文', { position: 0, order: 1 }),
    entry(2, '乙', '乙正文', { position: 1, order: 2 }),
  ]);
  const dir = await importCard(root, '补序号', card);
  const before = await loadProject('补序号', root);
  assert.deepEqual(before.card.data.character_book.entries.map(item => item.extensions.display_index), [undefined, undefined], '导入卡没有展示序号');
  const indexText = await readText(dir, 'src/index.yaml');
  const beforeSnapshot = await snapshot(dir);

  const result = await arrangeWorldbook('补序号', root);
  assert.equal(result.ok, true);
  assert.equal(result.arranged, true, '缺 display_index 也要补齐');
  assert.deepEqual(result.changes, [], '次序与编号本来就没变，changes 为空');
  assert.ok(result.backup.startsWith('work/order-backups/补序号-'));

  const after = await loadProject('补序号', root);
  assert.deepEqual(after.card.data.character_book.entries.map(item => item.insertion_order), [1, 2], '连续编号不被改写');
  assert.deepEqual(after.card.data.character_book.entries.map(item => item.extensions.display_index), [0, 1], '展示序号按排列补齐');
  assert.equal(await readText(dir, 'src/index.yaml'), indexText, '索引排列不变，不重写索引');
  const afterSnapshot = await snapshot(dir);
  const changed = Object.keys(afterSnapshot).filter(key => beforeSnapshot[key] !== afterSnapshot[key]).sort();
  assert.deepEqual(changed, ['.card/state.json', 'project.json'], '只写状态与摘要，不重写索引和条目 YAML');

  const stable = await snapshot(dir);
  assert.deepEqual(await arrangeWorldbook('补序号', root), { name: '补序号', ok: true, arranged: false, order: 'prompt', backup: null, changes: [], budgetNotice: BUDGET_NOTICE }, '补齐后再次运行 noop');
  assert.deepEqual(await snapshot(dir), stable, 'noop 不写文件');
  assert.equal((await fs.readdir(path.join(root, 'work/order-backups'))).length, 1, 'noop 不新增备份');
  assert.deepEqual(await tmpLeftovers(root), []);
});

test('次序、编号与展示序号都已到位时 arrange 直接 noop，不写文件、不建备份', async t => {
  const root = await tempRoot(t, 'tcs-arrange-noop-');
  const card = bookCard('已排好', [
    entry(1, '甲', '甲正文', { position: 0, order: 1, extra: { display_index: 0 } }),
    entry(2, '乙', '乙正文', { position: 1, order: 2, extra: { display_index: 1 } }),
  ]);
  const dir = await importCard(root, '已排好', card);
  const before = await loadProject('已排好', root);
  assert.deepEqual(before.card.data.character_book.entries.map(item => item.extensions.display_index), [0, 1], '前提：卡内已有正确的展示序号');
  const stable = await snapshot(dir);
  assert.deepEqual(await arrangeWorldbook('已排好', root), { name: '已排好', ok: true, arranged: false, order: 'prompt', backup: null, changes: [], budgetNotice: BUDGET_NOTICE });
  assert.deepEqual(await snapshot(dir), stable, 'noop 不写文件');
  assert.equal(await hasFile(root, 'work/order-backups'), false, 'noop 不建备份目录');
  assert.deepEqual(await tmpLeftovers(root), []);
});

test('特殊注入位置在 prompt 模式被拒绝，index 模式按现有索引连续编号', async t => {
  const root = await tempRoot(t, 'tcs-arrange-special-');
  const card = bookCard('特殊位置', [
    entry(1, '甲', '甲正文', { position: 2, order: 50 }),
    entry(2, '乙', '乙正文', { position: 0, order: 40 }),
    entry(3, '丙', '丙正文', { position: 4, order: 60, depth: 2 }),
  ]);
  const dir = await importCard(root, '特殊位置', card);
  const before = await snapshot(dir);
  await assert.rejects(() => arrangeWorldbook('特殊位置', root), /宿主/);
  assert.deepEqual(await snapshot(dir), before, '拒绝后工程不变');
  assert.equal(await hasFile(root, 'work/order-backups'), false, '拒绝时不写备份');
  assert.deepEqual(await tmpLeftovers(root), []);

  const result = await arrangeWorldbook('特殊位置', root, { order: 'index' });
  assert.equal(result.ok, true);
  assert.equal(result.arranged, true);
  assert.equal(result.order, 'index');
  assert.deepEqual(result.changes.map(change => [change.file, change.orderFrom, change.orderTo]), [
    ['src/worldbook/未分类/甲.yaml', 50, 1],
    ['src/worldbook/未分类/乙.yaml', 40, 2],
    ['src/worldbook/未分类/丙.yaml', 60, 3],
  ]);
  const after = await loadProject('特殊位置', root);
  assert.deepEqual(after.card.data.character_book.entries.map(item => [item.comment, item.insertion_order, item.extensions.display_index]), [['甲', 1, 0], ['乙', 2, 1], ['丙', 3, 2]], 'index 模式保持原索引次序，只连续编号');
  assert.deepEqual((await readYAML(dir, 'src/index.yaml')).世界书.条目, ['src/worldbook/未分类/甲.yaml', 'src/worldbook/未分类/乙.yaml', 'src/worldbook/未分类/丙.yaml']);
  assert.deepEqual(after.card.data.character_book.entries.map(item => item.extensions.position), [2, 0, 4], '位置与深度原样保留');
  assert.deepEqual(await tmpLeftovers(root), []);
});

test('arrange 拒绝未知顺序模式与 v1 工程，空世界书直接 noop', async t => {
  const root = await tempRoot(t, 'tcs-arrange-guard-');
  await importCard(root, '守护', bookCard('守护', [entry(1, '甲', '甲正文')]));
  await assert.rejects(() => arrangeWorldbook('守护', root, { order: '顺序' }), /顺序模式/);

  const file = path.join(root, '旧版.json');
  await fs.writeFile(file, JSON.stringify(bookCard('旧版', [entry(1, '甲', '甲正文')]), null, 2));
  await splitCard(file, { name: '旧版', root, formatVersion: 1 });
  await assert.rejects(() => arrangeWorldbook('旧版', root), /迁移到 v2/);

  const empty = await newCard('无世界书', { root });
  const stable = await snapshot(empty);
  assert.deepEqual(await arrangeWorldbook('无世界书', root), { name: '无世界书', ok: true, arranged: false, order: 'prompt', backup: null, changes: [], budgetNotice: BUDGET_NOTICE });
  assert.deepEqual(await snapshot(empty), stable, '空世界书不写文件');
  assert.deepEqual(await tmpLeftovers(root), []);
});

test('arrange 把未启用条目排到列表末尾维护区', async t => {
  const root = await tempRoot(t, 'tcs-arrange-disabled-');
  const card = bookCard('停用序', [
    entry(1, '甲', '甲正文', { position: 0, order: 30 }),
    { ...entry(2, '停用', '停用正文', { position: 0, order: 10 }), enabled: false },
    entry(3, '乙', '乙正文', { position: 1, order: 20 }),
  ]);
  const dir = await importCard(root, '停用序', card);
  const result = await arrangeWorldbook('停用序', root);
  assert.equal(result.arranged, true);
  const after = await loadProject('停用序', root);
  assert.deepEqual(after.card.data.character_book.entries.map(item => [item.comment, item.enabled, item.insertion_order, item.extensions.display_index]), [
    ['甲', true, 1, 0],
    ['乙', true, 2, 1],
    ['停用', false, 3, 2],
  ], '启用条目按位置排序，未启用条目留在末尾维护区');
  const files = (await worldbookEntries(dir)).map(item => [item.config.名称, item.config.顺序]);
  assert.deepEqual(files, [['甲', 1], ['乙', 2], ['停用', 3]]);
  assert.equal(await readText(dir, 'src/worldbook/未分类/停用.md'), '停用正文');
});

test('导入卡条目没有 extensions 时，连续编号只补 display_index 容器', async t => {
  const root = await tempRoot(t, 'tcs-arrange-noext-');
  const card = bookCard('无扩展', [
    bareEntry(1, '甲', '甲正文', 'before_char', 1),
    bareEntry(2, '乙', '乙正文', 'after_char', 2),
  ]);
  const dir = await importCard(root, '无扩展', card);
  const before = await loadProject('无扩展', root);
  assert.deepEqual(before.card.data.character_book.entries.map(item => item.extensions), [undefined, undefined], '前提：条目没有 extensions');
  const beforeSnapshot = await snapshot(dir);

  const result = await arrangeWorldbook('无扩展', root);
  assert.equal(result.arranged, true, '缺 display_index 要补');
  assert.deepEqual(result.changes, [], '次序与编号没变');

  const after = await loadProject('无扩展', root);
  assert.deepEqual(after.card.data.character_book.entries.map(item => [item.comment, item.insertion_order, item.extensions]), [
    ['甲', 1, { display_index: 0 }],
    ['乙', 2, { display_index: 1 }],
  ], '允许新增 extensions 容器，且只放 display_index');
  const afterSnapshot = await snapshot(dir);
  assert.deepEqual(Object.keys(afterSnapshot).filter(key => beforeSnapshot[key] !== afterSnapshot[key]).sort(), ['.card/state.json', 'project.json'], '条目 YAML 与索引不重写');
  assert.deepEqual(await tmpLeftovers(root), []);
});

test('导入卡条目没有 extensions 时也能按阅读序重排', async t => {
  const root = await tempRoot(t, 'tcs-arrange-noext-order-');
  const card = bookCard('无扩展重排', [
    bareEntry(1, '甲', '甲正文', 'before_char', 1),
    bareEntry(2, '乙', '乙正文', 'after_char', 2),
    bareEntry(3, '丙', '丙正文', 'before_char', 3),
  ]);
  const dir = await importCard(root, '无扩展重排', card);
  const result = await arrangeWorldbook('无扩展重排', root);
  assert.equal(result.arranged, true);
  assert.deepEqual(result.changes.map(change => [change.name, change.orderFrom, change.orderTo]), [
    ['丙', 3, 2],
    ['乙', 2, 3],
  ]);
  const after = await loadProject('无扩展重排', root);
  assert.deepEqual(after.card.data.character_book.entries.map(item => [item.comment, item.insertion_order, item.extensions]), [
    ['甲', 1, { display_index: 0 }],
    ['丙', 2, { display_index: 1 }],
    ['乙', 3, { display_index: 2 }],
  ]);
  assert.deepEqual((await readYAML(dir, 'src/index.yaml')).世界书.条目, [
    'src/worldbook/未分类/甲.yaml',
    'src/worldbook/未分类/丙.yaml',
    'src/worldbook/未分类/乙.yaml',
  ]);
  assert.equal(await readText(dir, 'src/worldbook/未分类/乙.md'), '乙正文');
  assert.deepEqual(await tmpLeftovers(root), []);
});

test('state 记录缺 关联 时按路径找回，arrange 不写 关联 也不改记录配置', async t => {
  const root = await tempRoot(t, 'tcs-arrange-rekey-');
  const card = bookCard('缺关联', [
    entry(1, '甲', '甲正文', { position: 0, order: 1 }),
    entry(2, '乙', '乙正文', { position: 1, order: 2 }),
  ]);
  const dir = await importCard(root, '缺关联', card);
  // 造出 organize 会留下的形态：YAML 与记录配置都还没有 关联，记录靠 file 路径认领条目。
  const target = (await worldbookEntries(dir))[0];
  const config = { ...target.config };
  const key = config.关联;
  assert.equal(typeof key, 'string', '前提：导入时写过关联');
  delete config.关联;
  await writeYAML(dir, target.file, config);
  const state = JSON.parse(await readText(dir, '.card/state.json'));
  delete state.records[key].config.关联;
  const bytes = jsonText(state);
  await writeText(dir, '.card/state.json', bytes);
  const manifest = JSON.parse(await readText(dir, 'project.json'));
  manifest.state.sha256 = sha256(Buffer.from(bytes, 'utf8'));
  await writeText(dir, 'project.json', jsonText(manifest));

  const before = await loadProject('缺关联', root);
  assert.deepEqual(before.unreferenced, [], '缺 关联 的记录靠路径被认领，不算未引用');
  assert.equal((await readYAML(dir, target.file)).关联, undefined);

  const result = await arrangeWorldbook('缺关联', root);
  assert.equal(result.arranged, true, '缺 display_index 要补');
  const after = await loadProject('缺关联', root);
  assert.equal((await readYAML(dir, target.file)).关联, undefined, 'arrange 不补写 关联');
  const stateAfter = JSON.parse(await readText(dir, '.card/state.json'));
  assert.equal(Object.hasOwn(stateAfter.records[key].config, '关联'), false, '记录配置不被改写');
  assert.equal(Object.keys(stateAfter.records).length, 2, '不新建重复记录');
  assert.deepEqual(after.card.data.character_book.entries.map(item => [item.comment, item.extensions.display_index]), [['甲', 0], ['乙', 1]]);
  assert.deepEqual(after.unreferenced, []);
  assert.deepEqual(await tmpLeftovers(root), []);
});

test('条目缺失或异常的顺序在 prompt 模式被拒绝，index 模式编号修正', async t => {
  const root = await tempRoot(t, 'tcs-arrange-badorder-');
  const card = bookCard('异常顺序', [
    { id: 1, keys: ['甲'], comment: '甲', content: '甲正文', enabled: true, constant: false, position: 'before_char' },
    { id: 2, keys: ['乙'], comment: '乙', content: '乙正文', enabled: true, constant: false, insertion_order: null, position: 'after_char' },
  ]);
  const dir = await importCard(root, '异常顺序', card);
  const before = await loadProject('异常顺序', root);
  assert.deepEqual(before.card.data.character_book.entries.map(item => item.insertion_order), [undefined, null], '前提：一条缺顺序，一条是 null');
  const stable = await snapshot(dir);
  await assert.rejects(() => arrangeWorldbook('异常顺序', root), /--order index/);
  assert.deepEqual(await snapshot(dir), stable, '拒绝后工程不变');
  assert.equal(await hasFile(root, 'work/order-backups'), false, '拒绝时不写备份');

  const result = await arrangeWorldbook('异常顺序', root, { order: 'index' });
  assert.equal(result.arranged, true);
  assert.deepEqual(result.changes.map(change => [change.name, change.orderFrom, change.orderTo]), [['甲', null, 1], ['乙', null, 2]]);
  const after = await loadProject('异常顺序', root);
  assert.deepEqual(after.card.data.character_book.entries.map(item => [item.comment, item.insertion_order, item.extensions]), [
    ['甲', 1, { display_index: 0 }],
    ['乙', 2, { display_index: 1 }],
  ], 'index 模式按现有索引写成连续编号');
  assert.deepEqual((await worldbookEntries(dir)).map(item => item.config.顺序), [1, 2]);
  assert.deepEqual(await tmpLeftovers(root), []);
});
