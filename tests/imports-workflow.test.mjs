import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { ROOT, readJSON, sha256 } from '../tools/lib/files.mjs';
import { loadProject, splitCard } from '../tools/lib/project.mjs';
import { createOperations } from '../tools/lib/studio-operations.mjs';
import { buildCard } from '../tools/lib/build.mjs';
import { main } from '../tools/card.mjs';
import { chunk, writeCardPNG } from '../tools/lib/png.mjs';

// Import overview: imports/<original filename> preserves exact card bytes; original/ is the internal verification copy.
// Archives reuse identical named content and number differing content; failed splits leave no partial archives.

async function workspace(t) {
  await fs.mkdir(path.join(ROOT, 'work'), { recursive: true });
  const root = await fs.mkdtemp(path.join(ROOT, 'work/test-imports-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const toBase64 = bytes => Buffer.from(bytes).toString('base64');
const cardBytes = card => Buffer.from(JSON.stringify(card, null, 2) + '\n');
const readBytes = (...parts) => fs.readFile(path.join(...parts));
async function put(root, relative, content) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return file;
}
async function entries(root, relative) {
  try { return (await fs.readdir(path.join(root, relative))).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
const tempNames = names => names.filter(name => name.startsWith('.tmp-'));
async function sampleCard(name) {
  const card = await readJSON(path.join(ROOT, 'templates/base/card.json'));
  card.data.name = name;
  card.data.description = `${name} 的原始描述`;
  card.data.first_mes = `第一条：${name}\n\n第二段 ${name}`;
  card.data.tags = ['来源标签'];
  return card;
}
function pngImage({ width = 2, height = 2 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(height * (1 + width * 4)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test("splitting external files archives exact bytes in imports while original remains an internal verification copy", async t => {
  const root = await workspace(t);
  const card = await sampleCard('归档源');
  const bytes = cardBytes(card);
  const source = await put(root, path.join('素材', '来源卡.json'), bytes);

  const dir = await splitCard(source, { name: '归档卡', root });
  assert.equal(dir, path.join(root, 'cards', '归档卡'), 'split 仍返回工程目录');

  const loaded = await loadProject('归档卡', root);
  assert.equal(loaded.project.original.importPath, 'imports/来源卡.json');
  assert.deepEqual(await entries(root, 'imports'), ['来源卡.json']);
  assert.deepEqual(await readBytes(root, 'imports', '来源卡.json'), bytes, '归档必须与输入原件逐字节一致');
  assert.equal(loaded.project.original.file, 'original/input.json');
  assert.equal(loaded.project.original.sha256, sha256(bytes));
  assert.deepEqual(await readBytes(root, 'cards', '归档卡', 'original', 'input.json'), bytes);
  assert.deepEqual(loaded.card, card, '归档不改内容，拆分结果与原卡一致');
});

test("PNG cards are archived byte-for-byte with avatar and original taken from the input", async t => {
  const root = await workspace(t);
  const card = await sampleCard('图片源');
  const bytes = writeCardPNG(pngImage({ width: 3, height: 2 }), card);
  const source = await put(root, path.join('素材', '图片卡.PNG'), bytes);

  await splitCard(source, { name: '图片卡', root });
  const loaded = await loadProject('图片卡', root);
  assert.equal(loaded.project.original.importPath, 'imports/图片卡.PNG');
  assert.deepEqual(await entries(root, 'imports'), ['图片卡.PNG']);
  assert.deepEqual(await readBytes(root, 'imports', '图片卡.PNG'), bytes, 'PNG 归档保持原始编码，不重新生成');
  assert.equal(loaded.project.original.file, 'original/input.png');
  assert.equal(loaded.project.original.sha256, sha256(bytes));
  assert.deepEqual(await readBytes(loaded.dir, loaded.project.avatar), bytes, 'PNG 原卡同时作为头像源');
});

test("same-name archives reuse identical bytes and number differing content without overwriting", async t => {
  const root = await workspace(t);
  const first = await sampleCard('复用源');
  await splitCard(await put(root, path.join('素材', '来源.json'), cardBytes(first)), { name: '复用一', root });
  await splitCard(await put(root, path.join('另一处', '来源.json'), cardBytes(first)), { name: '复用二', root });
  assert.deepEqual(await entries(root, 'imports'), ['来源.json'], '同名同字节不再新增副本');
  assert.deepEqual(await readBytes(root, 'imports', '来源.json'), cardBytes(first));
  assert.equal((await loadProject('复用一', root)).project.original.importPath, 'imports/来源.json');
  assert.equal((await loadProject('复用二', root)).project.original.importPath, 'imports/来源.json');

  const second = await sampleCard('另一版');
  await splitCard(await put(root, path.join('第三处', '来源.json'), cardBytes(second)), { name: '另一版卡', root });
  assert.deepEqual(await entries(root, 'imports'), ['来源 (2).json', '来源.json']);
  assert.deepEqual(await readBytes(root, 'imports', '来源.json'), cardBytes(first), '先到的归档保持原字节');
  assert.deepEqual(await readBytes(root, 'imports', '来源 (2).json'), cardBytes(second));
  assert.equal((await loadProject('另一版卡', root)).project.original.importPath, 'imports/来源 (2).json');
});

test("splitting files already in imports avoids overwriting or duplicate copying", async t => {
  const root = await workspace(t);
  const bytes = cardBytes(await sampleCard('自归档'));
  const inbox = await put(root, path.join('imports', '内档.json'), bytes);

  await splitCard(inbox, { name: '内档卡', root });
  assert.deepEqual(await entries(root, 'imports'), ['内档.json']);
  assert.deepEqual(await readBytes(root, 'imports', '内档.json'), bytes, '拆分输入的原件不能被改写');
  assert.equal((await loadProject('内档卡', root)).project.original.importPath, 'imports/内档.json');

  await splitCard(inbox, { name: '内档卡二', root });
  assert.deepEqual(await entries(root, 'imports'), ['内档.json']);
  assert.deepEqual(await readBytes(root, 'imports', '内档.json'), bytes);
  assert.equal((await loadProject('内档卡二', root)).project.original.importPath, 'imports/内档.json');
});

test("invalid inputs, duplicate projects, and creation failures leave archives unchanged", async t => {
  const root = await workspace(t);
  const rejected = [
    ['坏JSON.json', '{ 不是 JSON', /Invalid card JSON/],
    ['旧版.json', JSON.stringify({ spec: 'chara_card_v1', data: {} }), /Unsupported card format/],
    ['数组.json', '[1,2]', /must be a JSON object/],
    ['不支持.txt', 'hello', /supported/],
  ];
  for (const [filename, content, message] of rejected) {
    await assert.rejects(splitCard(await put(root, path.join('素材', filename), content), { name: '失败卡', root }), message);
  }
  assert.deepEqual(await entries(root, 'imports'), [], '非法原件不产生归档');
  assert.deepEqual(await entries(root, 'cards'), [], '非法原件不产生工程');

  const occupied = cardBytes(await sampleCard('占位源'));
  await splitCard(await put(root, path.join('素材', '占位.json'), occupied), { name: '占位卡', root });
  await assert.rejects(splitCard(await put(root, path.join('素材', '第二个.json'), cardBytes(await sampleCard('另一个'))), { name: '占位卡', root }), /Already exists/);
  assert.deepEqual(await entries(root, 'imports'), ['占位.json'], '重名工程不会多留一份归档');

  const broken = await sampleCard('无法创作');
  broken.data.alternate_greetings = [42];
  const brokenBytes = cardBytes(broken);
  const brokenFile = await put(root, path.join('素材', '失败源.json'), brokenBytes);
  await assert.rejects(splitCard(brokenFile, { name: '创建失败卡', root }), /greeting is not text/);
  assert.deepEqual(await entries(root, 'imports'), ['占位.json'], '创建失败要清掉本次新建的归档');
  assert.deepEqual(tempNames(await entries(root, 'cards')), [], '创建失败不留临时工程目录');
  assert.equal((await loadProject('占位卡', root)).project.original.importPath, 'imports/占位.json');

  await put(root, path.join('imports', '失败源.json'), brokenBytes);
  await assert.rejects(splitCard(brokenFile, { name: '创建失败卡二', root }), /greeting is not text/);
  assert.deepEqual(await entries(root, 'imports'), ['占位.json', '失败源.json'].sort(), '复用已有归档时不能因创建失败删掉它');
  assert.deepEqual(await readBytes(root, 'imports', '失败源.json'), brokenBytes);
});

test("UI imports allow source edits and builds without changing originals and share projects with the CLI", async t => {
  const root = await workspace(t);
  const ops = createOperations({ root, openFolder: async () => { throw new Error('测试中不应打开系统文件夹'); } });
  const card = await sampleCard('界面源');
  const bytes = cardBytes(card);

  const imported = await ops.importCard({ filename: '界面来源.json', base64: toBase64(bytes), name: '界面卡' });
  assert.equal(imported.ok, true);
  assert.equal(imported.importPath, 'imports/界面来源.json', '上传文件名要保留到归档路径');
  assert.match(imported.message, /imports\/界面来源\.json/);
  assert.deepEqual(await entries(root, 'imports'), ['界面来源.json']);
  assert.deepEqual((await entries(root, 'work')).filter(name => name.startsWith('studio-import-')), [], '上传临时目录要清理');

  const originalFile = path.join(root, 'cards', '界面卡', 'original', 'input.json');
  const archive = await readBytes(root, 'imports', '界面来源.json');
  const original = await fs.readFile(originalFile);
  assert.deepEqual(archive, bytes);
  assert.deepEqual(original, bytes);

  const source = path.join(root, 'cards', '界面卡', 'src', 'text', 'first_mes.md');
  assert.equal(await fs.readFile(source, 'utf8'), card.data.first_mes, '拆分结果落在可编辑的 src 正文里');

  const edited = '手工改写的第一条消息\n\n第二段：界面编辑也要生效\n';
  await fs.writeFile(source, edited);
  const gui = await buildCard('界面卡', root);
  assert.deepEqual(gui.files, ['界面卡.json']);
  assert.equal((await readJSON(path.join(root, 'dist', '界面卡', '界面卡.json'))).data.first_mes, edited, '打包读取编辑后的 src 正文');
  assert.deepEqual(await fs.readFile(originalFile), original, '编辑 src 不改内部原件');
  assert.deepEqual(await readBytes(root, 'imports', '界面来源.json'), bytes, '编辑 src 不改完整原卡归档');
  assert.equal(sha256(await fs.readFile(originalFile)), (await loadProject('界面卡', root)).project.original.sha256);

  const cliEdited = '命令行打包也读这条消息\n';
  await fs.writeFile(source, cliEdited);
  const cli = await main(['build', '界面卡'], root);
  assert.equal(cli.ok, true);
  assert.equal(cli.results[0].ok, true);
  assert.deepEqual(cli.results[0].files, ['界面卡.json']);
  assert.equal((await readJSON(path.join(root, 'dist', '界面卡', '界面卡.json'))).data.first_mes, cliEdited, '命令行对同一工程读到同一份编辑文件');
  assert.deepEqual(await readBytes(root, 'imports', '界面来源.json'), bytes);
  assert.deepEqual(await fs.readFile(originalFile), original);
  assert.deepEqual(await entries(root, 'imports'), ['界面来源.json']);
});

test("projects load and build after archive deletion using independently verified internal originals", async t => {
  const root = await workspace(t);
  const card = await sampleCard('独立源');
  const bytes = cardBytes(card);
  await splitCard(await put(root, path.join('素材', '独立来源.json'), bytes), { name: '独立卡', root });
  assert.equal((await loadProject('独立卡', root)).project.original.importPath, 'imports/独立来源.json');

  await fs.rm(path.join(root, 'imports', '独立来源.json'));
  assert.deepEqual(await entries(root, 'imports'), []);

  const loaded = await loadProject('独立卡', root);
  assert.equal(loaded.project.original.file, 'original/input.json');
  assert.equal(loaded.project.original.sha256, sha256(bytes));
  assert.deepEqual(await readBytes(root, 'cards', '独立卡', 'original', 'input.json'), bytes);
  assert.deepEqual(loaded.card, card);

  const built = await buildCard('独立卡', root);
  assert.deepEqual(built.files, ['独立卡.json']);
  assert.deepEqual(await readJSON(path.join(root, 'dist', '独立卡', '独立卡.json')), card);
});
