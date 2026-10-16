import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { ROOT, exists, readJSON, sha256 } from '../tools/lib/files.mjs';
import { createOperations } from '../tools/lib/studio-operations.mjs';
import { createStudioServer } from '../tools/studio.mjs';
import { chunk, parsePNG, readCardPNG, writeCardPNG } from '../tools/lib/png.mjs';
import { loadProject } from '../tools/lib/project.mjs';

async function workspace(t) {
  await fs.mkdir(path.join(ROOT, 'work'), { recursive: true });
  const root = await fs.mkdtemp(path.join(ROOT, 'work/test-studio-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
function pngImage({ width = 2, height = 2, texts = [] } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...texts.map(({ keyword, value }) => chunk('tEXt', Buffer.from(`${keyword}\0${value}`, 'latin1'))),
    chunk('IDAT', deflateSync(Buffer.alloc(height * (1 + width * 4)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function corrupt(image) {
  const bytes = Buffer.from(image);
  bytes[bytes.indexOf('IDAT') + 4] ^= 0xff;
  return bytes;
}
const toBase64 = bytes => Buffer.from(bytes).toString('base64');
const hasTextKeyword = (chunks, keyword) => chunks.some(c => c.type === 'tEXt' && c.data.toString('latin1').toLowerCase().startsWith(`${keyword}\0`));
const idat = chunks => chunks.find(c => c.type === 'IDAT').data;
async function sampleCard(name) {
  const card = await readJSON(path.join(ROOT, 'templates/base/card.json'));
  card.data.name = name;
  card.data.description = `${name} 的原始描述`;
  card.data.tags = ['来源标签'];
  return card;
}
async function treeHash(dir) {
  const output = {};
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) output[path.relative(dir, file).split(path.sep).join('/')] = sha256(await fs.readFile(file));
    }
  }
  await visit(dir);
  return output;
}
const withoutManifest = hash => Object.fromEntries(Object.entries(hash).filter(([file]) => !['project.json', 'CONTENTS.md'].includes(file)));
async function request(base, options = {}) {
  const target = new URL(options.path ?? '/', base);
  const headers = { connection: 'close' };
  if (options.token !== undefined) headers['x-studio-token'] = options.token;
  if (options.origin !== undefined) headers.origin = options.origin;
  if (options.host !== undefined) headers.host = options.host;
  let payload = null;
  if (options.body !== undefined) {
    payload = Buffer.from(JSON.stringify(options.body));
    headers['content-type'] = options.contentType ?? 'application/json';
    headers['content-length'] = String(payload.length);
  }
  return await new Promise((resolve, reject) => {
    const req = http.request({ hostname: target.hostname, port: target.port, path: target.pathname + target.search, method: options.method ?? 'GET', headers }, res => {
      const parts = [];
      res.on('data', part => parts.push(part));
      res.on('end', () => {
        const buffer = Buffer.concat(parts);
        let json; try { json = JSON.parse(buffer.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, buffer, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('JSON and PNG imports preserve original bytes and reject unknown extensions', async t => {
  const root = await workspace(t);
  const ops = createOperations({ root, openFolder: async () => { throw new Error('Tests must not open system folders'); } });
  const card = await sampleCard('导入源');
  const jsonBytes = Buffer.from(JSON.stringify(card, null, 2) + '\n');
  const imported = await ops.importCard({ filename: '来源卡.json', base64: toBase64(jsonBytes), name: 'JSON 卡' });
  assert.equal(imported.ok, true);
  assert.equal(imported.name, 'JSON 卡');
  const fromJSON = await loadProject('JSON 卡', root);
  assert.equal(fromJSON.project.original.file, 'original/input.json');
  assert.equal(fromJSON.project.original.sha256, sha256(jsonBytes));
  assert.deepEqual(await fs.readFile(path.join(fromJSON.dir, 'original/input.json')), jsonBytes);
  assert.deepEqual(fromJSON.card, card);
  assert.equal(fromJSON.project.avatar, null);

  const image = pngImage();
  const pngBytes = writeCardPNG(image, card);
  await ops.importCard({ filename: '来源卡.PNG', base64: toBase64(pngBytes), name: 'PNG 卡' });
  const fromPNG = await loadProject('PNG 卡', root);
  assert.equal(fromPNG.project.original.file, 'original/input.png');
  assert.equal(fromPNG.project.original.sha256, sha256(pngBytes));
  assert.deepEqual(await fs.readFile(path.join(fromPNG.dir, 'original/input.png')), pngBytes);
  assert.deepEqual(await fs.readFile(path.join(fromPNG.dir, fromPNG.project.avatar)), pngBytes);
  assert.deepEqual(fromPNG.card, card);

  for (const filename of ['来源卡.card', '来源卡.png.bak', '来源卡']) {
    await assert.rejects(ops.importCard({ filename, base64: toBase64(jsonBytes), name: '未知扩展' }), /PNG or JSON/);
  }
  assert.equal(await exists(path.join(root, 'cards', '未知扩展')), false);
  assert.deepEqual((await ops.listCards()).cards.map(c => c.name), ['JSON 卡', 'PNG 卡']);
});

test('Directory and character names can change independently without modifying original hashes', async t => {
  const root = await workspace(t);
  const ops = createOperations({ root });
  const card = await sampleCard('原名');
  await ops.importCard({ filename: '改名.json', base64: toBase64(Buffer.from(JSON.stringify(card, null, 2) + '\n')), name: '旧目录' });
  await ops.buildCard({ name: '旧目录' });
  const originalOf = async name => {
    const loaded = await loadProject(name, root);
    return { loaded, hash: sha256(await fs.readFile(path.join(loaded.dir, loaded.project.original.file))) };
  };

  const renamed = await ops.renameCard({ name: '旧目录', newName: '新目录' });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.name, '新目录');
  assert.equal(await exists(path.join(root, 'cards', '旧目录')), false);
  let current = await originalOf('新目录');
  assert.equal(current.loaded.project.name, '新目录');
  assert.equal(current.loaded.card.data.name, '原名', 'Directory-only renames retain the character display name');
  assert.equal(current.hash, current.loaded.project.original.sha256);
  assert.equal(await exists(path.join(root, 'dist', '旧目录', '旧目录.json')), true, 'Renaming retains the previous output directory');

  await ops.renameCard({ name: '新目录', newName: '新目录', characterName: '改名后' });
  current = await originalOf('新目录');
  assert.equal(current.loaded.card.data.name, '改名后', 'Character-only renames retain the directory name');
  assert.equal(current.loaded.project.name, '新目录');
  assert.equal(current.hash, current.loaded.project.original.sha256);

  const both = await ops.renameCard({ name: '新目录', newName: '双改目录', characterName: '双改名' });
  assert.equal(both.name, '双改目录');
  current = await originalOf('双改目录');
  assert.equal(current.loaded.project.name, '双改目录');
  assert.equal(current.loaded.card.data.name, '双改名');
  assert.equal(current.hash, current.loaded.project.original.sha256);

  const listed = (await ops.listCards()).cards;
  assert.deepEqual(listed.map(c => c.name), ['双改目录']);
  assert.equal(listed[0].characterName, '双改名');
  assert.equal(listed[0].error, undefined);

  await ops.newCard({ name: 'Alpha' });
  // Case-only renames can fail the existing-path check first on case-insensitive filesystems.
  await assert.rejects(ops.renameCard({ name: 'Alpha', newName: 'ALPHA' }), /letter case|already exists/);
  assert.equal(await exists(path.join(root, 'cards', 'Alpha')), true);
  assert.equal((await loadProject('Alpha', root)).card.data.name, 'Alpha');
});

test('Copies preserve source cards and can be edited independently', async t => {
  const root = await workspace(t);
  const ops = createOperations({ root });
  await ops.newCard({ name: '源卡' });
  const sourceDir = path.join(root, 'cards', '源卡');
  const before = await treeHash(sourceDir);

  const copy = await ops.duplicateCard({ name: '源卡', newName: '副本' });
  assert.equal(copy.ok, true);
  assert.equal(copy.name, '副本');
  assert.deepEqual(await treeHash(sourceDir), before, 'Source card directory must remain byte-identical');
  const source = await loadProject('源卡', root);
  const duplicated = await loadProject('副本', root);
  assert.equal(duplicated.project.name, '副本');
  assert.equal(source.project.name, '源卡');
  assert.deepEqual(duplicated.card, source.card);
  assert.deepEqual(withoutManifest(await treeHash(duplicated.dir)), withoutManifest(await treeHash(source.dir)), 'Copies match source content apart from the manifest and navigation');

  await ops.renameCard({ name: '副本', newName: '副本', characterName: '副本角色' });
  assert.equal((await loadProject('源卡', root)).card.data.name, '源卡');
  assert.equal((await loadProject('副本', root)).card.data.name, '副本角色');
  assert.deepEqual(await treeHash(sourceDir), before);
});

test('Duplicate names reject creation, import, rename, and copying without changing existing cards', async t => {
  const root = await workspace(t);
  const ops = createOperations({ root });
  const jsonBytes = Buffer.from(JSON.stringify(await sampleCard('重名源'), null, 2) + '\n');
  await ops.newCard({ name: '占位' });
  const guard = await treeHash(path.join(root, 'cards', '占位'));

  await assert.rejects(ops.newCard({ name: '占位' }), /that name already exists|already exists/);
  await assert.rejects(ops.importCard({ filename: '重名.json', base64: toBase64(jsonBytes), name: '占位' }), /that name already exists|already exists/);
  await assert.rejects(ops.duplicateCard({ name: '占位', newName: '占位' }), /that name already exists|already exists/);
  await ops.newCard({ name: '另一个' });
  await assert.rejects(ops.renameCard({ name: '另一个', newName: '占位' }), /that name already exists|already exists/);
  await assert.rejects(ops.renameCard({ name: '另一个', newName: '占位', characterName: '改不动' }), /that name already exists|already exists/);
  await assert.rejects(ops.duplicateCard({ name: '另一个', newName: '占位' }), /that name already exists|already exists/);
  await ops.newCard({ name: 'Case' });
  await assert.rejects(ops.newCard({ name: 'case' }), /that name already exists|already exists/);
  await assert.rejects(ops.duplicateCard({ name: '另一个', newName: 'CASE' }), /that name already exists|already exists/);

  assert.deepEqual(await treeHash(path.join(root, 'cards', '占位')), guard);
  assert.equal((await loadProject('另一个', root)).card.data.name, '另一个');
  assert.equal((await loadProject('Case', root)).card.data.name, 'Case');
});

test('Cover builds produce matching JSON and PNG data with no foreign character metadata', async t => {
  const root = await workspace(t);
  const ops = createOperations({ root });
  await ops.newCard({ name: '封面卡' });
  const foreign = await sampleCard('外来角色');
  const cover = pngImage({ width: 3, height: 2, texts: [{ keyword: 'chara', value: toBase64(Buffer.from(JSON.stringify(foreign))) }] });

  await ops.setCover({ name: '封面卡', base64: toBase64(cover) });
  const stored = await ops.cover('封面卡');
  assert.deepEqual(idat(parsePNG(stored)), idat(parsePNG(cover)), 'Saved cover must retain the same image');
  assert.equal(hasTextKeyword(parsePNG(stored), 'chara'), false, 'Remove foreign character metadata from cover images');

  const built = await ops.buildCard({ name: '封面卡' });
  assert.deepEqual([...built.files].sort(), ['封面卡.json', '封面卡.png']);
  const card = await readJSON(path.join(built.directory, '封面卡.json'));
  const png = await fs.readFile(path.join(built.directory, '封面卡.png'));
  assert.deepEqual(readCardPNG(png).card, card);
  assert.deepEqual(readCardPNG(png).card, (await loadProject('封面卡', root)).card);
  assert.deepEqual(idat(parsePNG(png)), idat(parsePNG(cover)), 'Built PNG must use the cover image data');
  const texts = parsePNG(png).filter(c => c.type === 'tEXt');
  assert.equal(texts.filter(c => c.data.toString('latin1').toLowerCase().startsWith('chara\0')).length, 1);
  assert.equal(texts.some(c => c.data.toString('latin1').includes(foreign.data.name)), false);
  const report = await readJSON(path.join(built.directory, 'build-report.json'));
  assert.equal(Object.hasOwn(report.artifacts, '封面卡.png'), true);
});

test('Removing a cover produces JSON-only builds', async t => {
  const root = await workspace(t);
  const ops = createOperations({ root });
  await ops.newCard({ name: '无封面卡' });
  await ops.setCover({ name: '无封面卡', base64: toBase64(pngImage()) });
  let built = await ops.buildCard({ name: '无封面卡' });
  assert.deepEqual([...built.files].sort(), ['无封面卡.json', '无封面卡.png']);
  const avatarFile = path.join(root, 'cards', '无封面卡', (await loadProject('无封面卡', root)).project.avatar);

  const removed = await ops.removeCover({ name: '无封面卡' });
  assert.equal(removed.ok, true);
  await assert.rejects(ops.cover('无封面卡'), /cover/);
  assert.equal((await loadProject('无封面卡', root)).project.avatar, null);
  assert.equal(await exists(avatarFile), true, 'Removing the cover reference retains saved image files');

  built = await ops.buildCard({ name: '无封面卡' });
  assert.deepEqual(built.files, ['无封面卡.json']);
  assert.equal(await exists(path.join(built.directory, '无封面卡.png')), false);
  assert.equal(await exists(path.join(root, 'dist', '无封面卡', '无封面卡.png')), false);
});

test('Invalid covers and escaping names leave original project bytes intact', async t => {
  const root = await workspace(t);
  const ops = createOperations({ root });
  await ops.newCard({ name: '安全卡' });
  await ops.newCard({ name: '邻居卡' });
  const guard = await treeHash(path.join(root, 'cards'));
  const image = pngImage();

  await assert.rejects(ops.setCover({ name: '安全卡', base64: '' }), /encoded|empty/);
  await assert.rejects(ops.setCover({ name: '安全卡', base64: 'abc' }), /encoded|empty/);
  await assert.rejects(ops.setCover({ name: '安全卡', base64: toBase64(Buffer.from('这不是 PNG')) }), /PNG/);
  await assert.rejects(ops.setCover({ name: '安全卡', base64: toBase64(corrupt(image)) }), /checksum failed/);
  await assert.rejects(ops.setCover({ name: '安全卡', base64: toBase64(pngImage({ width: 0, height: 4 })) }), /dimensions/);
  await assert.rejects(ops.setCover({ name: '安全卡', base64: toBase64(pngImage({ width: 8193, height: 1 })) }), /dimensions/);
  await assert.rejects(ops.setCover({ name: '../越界', base64: toBase64(image) }), /Unsafe/);
  await assert.rejects(ops.setCover({ name: '安全卡/子目录', base64: toBase64(image) }), /Unsafe/);
  await assert.rejects(ops.renameCard({ name: '安全卡', newName: '../越界' }), /Unsafe/);
  await assert.rejects(ops.renameCard({ name: '安全卡', newName: '安全卡', characterName: '' }), /Character display names/);
  await assert.rejects(ops.renameCard({ name: '../安全卡', newName: '合法' }), /Unsafe/);
  await assert.rejects(ops.duplicateCard({ name: '安全卡', newName: 'con' }), /Unsafe/);
  await assert.rejects(ops.cover('../../安全卡'), /Unsafe/);
  await assert.rejects(ops.cover('安全卡'), /cover/);
  await assert.rejects(ops.removeCover({ name: '不存在的卡' }), /ENOENT/);
  await assert.rejects(ops.open({ name: '安全卡', target: '未知' }), /Unknown/);
  await assert.rejects(ops.checkCard({ name: '../安全卡' }), /Unsafe/);

  assert.deepEqual(await treeHash(path.join(root, 'cards')), guard);
});

test('listCards flags individual broken cards without failing the list', async t => {
  const root = await workspace(t);
  const ops = createOperations({ root });
  const jsonBytes = Buffer.from(JSON.stringify(await sampleCard('被篡改'), null, 2) + '\n');
  await ops.newCard({ name: '正常卡' });
  await ops.importCard({ filename: '篡改.json', base64: toBase64(jsonBytes), name: '原件被改' });
  await fs.writeFile(path.join(root, 'cards', '原件被改', 'original', 'input.json'), '{"spec":"chara_card_v2","data":{}}');
  await fs.mkdir(path.join(root, 'cards', '坏 JSON'));
  await fs.writeFile(path.join(root, 'cards', '坏 JSON', 'project.json'), '{ 不是 JSON');
  await fs.mkdir(path.join(root, 'cards', '空目录'));

  const listed = await ops.listCards();
  assert.equal(listed.ok, true);
  const names = listed.cards.map(c => c.name).sort();
  assert.deepEqual(names, ['空目录', '正常卡', '坏 JSON', '原件被改'].sort());
  const good = listed.cards.find(c => c.name === '正常卡');
  assert.equal(good.characterName, '正常卡');
  assert.equal(good.error, undefined);
  assert.equal(good.hasCover, false);
  for (const name of ['空目录', '坏 JSON', '原件被改']) {
    const broken = listed.cards.find(c => c.name === name);
    assert.equal(typeof broken.error, 'string');
    assert.ok(broken.error.length > 0, `${name} must include an error message`);
  }
});

test('Opening folders uses the injected callback without launching a file manager', async t => {
  const root = await workspace(t);
  const opened = [];
  const ops = createOperations({ root, openFolder: async dir => { opened.push(dir); } });
  await ops.newCard({ name: '打开卡' });
  await ops.buildCard({ name: '打开卡' });

  await ops.open({ name: '打开卡', target: 'root' });
  await ops.open({ name: '打开卡', target: 'card' });
  await ops.open({ name: '打开卡', target: 'source' });
  await ops.open({ name: '打开卡', target: 'dist' });
  assert.deepEqual(opened, [
    root,
    path.join(root, 'cards', '打开卡'),
    path.join(root, 'cards', '打开卡', 'src'),
    path.join(root, 'dist', '打开卡'),
  ]);

  await assert.rejects(ops.open({ name: '打开卡', target: '未知' }), /Unknown/);
  await assert.rejects(ops.open({ name: '没有这张卡', target: 'card' }), /ENOENT/);
  assert.equal(opened.length, 4);
});

test('HTTP validates token, Origin, and Host before mutations', async t => {
  const root = await workspace(t);
  const opened = [];
  const app = await createStudioServer({ root, token: 'studio-test-token', port: 0, openFolder: async dir => { opened.push(dir); } });
  t.after(() => app.close());
  const origin = app.url;
  const port = new URL(app.url).port;
  const token = 'studio-test-token';

  assert.equal((await request(app.url, { path: '/api/ping' })).status, 403);
  assert.equal((await request(app.url, { path: '/api/ping', token: 'wrong-token' })).status, 403);
  assert.equal((await request(app.url, { path: '/api/ping', token, origin: 'https://evil.example.com' })).status, 403);
  assert.equal((await request(app.url, { path: '/api/ping', token, origin })).status, 200);
  assert.equal((await request(app.url, { path: '/api/ping', token, host: 'evil.example.com' })).status, 403);
  assert.equal((await request(app.url, { path: '/api/ping', token, host: `localhost:${port}` })).status, 403);
  const ping = await request(app.url, { path: '/api/ping', token });
  assert.equal(ping.json.app, 'TavernCardStudio-local');
  assert.equal(ping.json.root, path.resolve(root));

  assert.equal((await request(app.url, { path: '/api/cards' })).status, 403);
  assert.equal((await request(app.url, { path: '/api/cards', token, origin: 'https://evil.example.com' })).status, 403);
  const empty = await request(app.url, { path: '/api/cards', token });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.cards, []);

  assert.equal((await request(app.url, { method: 'POST', path: '/api/new', body: { name: '未授权' } })).status, 403);
  assert.equal((await request(app.url, { method: 'POST', path: '/api/new', token, origin: 'https://evil.example.com', body: { name: '坏来源' } })).status, 403);
  assert.equal((await request(app.url, { method: 'POST', path: '/api/new', token, host: 'evil.example.com', body: { name: '坏主机' } })).status, 403);
  assert.deepEqual((await request(app.url, { path: '/api/cards', token })).json.cards, [], 'Rejected requests must not create cards');

  const created = await request(app.url, { method: 'POST', path: '/api/new', token, origin, body: { name: '网页卡' } });
  assert.equal(created.status, 200);
  assert.equal(created.json.ok, true);
  assert.equal((await request(app.url, { method: 'POST', path: '/api/new', token, contentType: 'text/plain', body: { name: '纯文本' } })).status, 400);
  assert.equal(await exists(path.join(root, 'cards', '纯文本')), false);

  const openedCard = await request(app.url, { method: 'POST', path: '/api/open', token, body: { name: '网页卡', target: 'card' } });
  assert.equal(openedCard.status, 200);
  assert.deepEqual(opened, [path.join(root, 'cards', '网页卡')]);

  const image = pngImage();
  const coverResponse = await request(app.url, { method: 'POST', path: '/api/cover', token, body: { name: '网页卡', base64: toBase64(image) } });
  assert.equal(coverResponse.status, 200);
  assert.equal((await request(app.url, { path: `/api/cover?name=${encodeURIComponent('网页卡')}` })).status, 403);
  const cover = await request(app.url, { path: `/api/cover?name=${encodeURIComponent('网页卡')}`, token });
  assert.equal(cover.status, 200);
  assert.equal(cover.headers['content-type'], 'image/png');
  assert.deepEqual(idat(parsePNG(cover.buffer)), idat(parsePNG(image)));

  const built = await request(app.url, { method: 'POST', path: '/api/build', token, body: { name: '网页卡' } });
  assert.equal(built.status, 200);
  assert.equal(built.json.ok, true);
  assert.deepEqual([...built.json.files].sort(), ['网页卡.json', '网页卡.png']);

  const shutdown = await request(app.url, { method: 'POST', path: '/api/shutdown', token, body: {} });
  assert.equal(shutdown.status, 200);
  await new Promise(resolve => setTimeout(resolve, 300));
  await assert.rejects(request(app.url, { path: '/api/ping', token }));
});
