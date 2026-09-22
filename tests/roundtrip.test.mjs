// 角色卡工作区的往返与防御性检查。
// 只使用公开 API：tools/lib/png.mjs 与 tools/lib/project.mjs，不改工具本身。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { test } from 'node:test';

import { chunk, parsePNG, readCardPNG, writeCardPNG } from '../tools/lib/png.mjs';
import { loadProject, semanticDiff, splitCard as splitProject } from '../tools/lib/project.mjs';
// These tests keep the v1 compatibility contract. v2 authoring and mutation tests live in authoring-v2.test.mjs.
const splitCard = (file, options) => splitProject(file, { ...options, formatVersion: 1 });

const NUL = String.fromCharCode(0);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CARD_KEYWORDS = ['chara', 'ccv3'];

// ---------- 测试用最小 PNG ----------

function ihdr(width = 1, height = 1) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;  // 位深
  data[9] = 2;  // 真彩色
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return chunk('IHDR', data);
}

function idat(width = 1, height = 1) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, y + 1)]));
  }
  return chunk('IDAT', zlib.deflateSync(Buffer.concat(rows)));
}

function textChunk(keyword, value) {
  return chunk('tEXt', Buffer.concat([Buffer.from(keyword + NUL, 'latin1'), Buffer.from(value, 'latin1')]));
}

function cardChunk(keyword, card) {
  return textChunk(keyword, Buffer.from(JSON.stringify(card), 'utf8').toString('base64'));
}

function buildPNG(extraChunks = []) {
  return Buffer.concat([
    PNG_SIGNATURE,
    ihdr(),
    ...extraChunks,
    idat(),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function textEntries(bytes) {
  return parsePNG(bytes)
    .filter(c => c.type === 'tEXt')
    .map(c => {
      const split = c.data.indexOf(0);
      return {
        keyword: c.data.subarray(0, split).toString('latin1'),
        value: c.data.subarray(split + 1).toString('latin1'),
      };
    });
}

function cardKeywords(bytes) {
  return textEntries(bytes)
    .map(entry => entry.keyword.toLowerCase())
    .filter(keyword => CARD_KEYWORDS.includes(keyword));
}

// ---------- 测试用角色卡 ----------

function v2Card() {
  return {
    name: '测试角色',
    description: '卡级描述',
    creatorcomment: '卡片备注',
    avatar: 'none',
    talkativeness: '0.5',
    fav: false,
    tags: ['测试'],
    spec: 'chara_card_v2',
    spec_version: '2.0',
    create_date: '2026-09-18T00:00:00.000Z',
    data: {
      name: '测试角色',
      description: '她站在雨里。\r\n第二行提到 {{user}}',
      personality: '沉默寡言',
      scenario: '雨夜的车站',
      first_mes: '「你来了。」',
      mes_example: '<START>\n{{char}}: ……',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: ['备选一', '备选二'],
      group_only_greetings: [],
      character_book: {
        name: '测试世界书',
        entries: [
          {
            id: 0,
            keys: ['车站'],
            secondary_keys: [],
            comment: '车站',
            content: '一座旧车站，钟停在三点。',
            enabled: true,
            constant: false,
            selective: true,
            insertion_order: 10,
            position: 'before_char',
            use_regex: true,
            extensions: { position: 0, depth: 4, role: 0, probability: 100, useProbability: true },
          },
          {
            id: 1,
            keys: [],
            secondary_keys: [],
            comment: '规则',
            content: '',
            enabled: true,
            constant: true,
            selective: false,
            insertion_order: 200,
            position: 'after_char',
            use_regex: true,
            extensions: { position: 1, depth: 4, role: 0, probability: 100, useProbability: false },
          },
        ],
      },
      extensions: {
        regex_scripts: [
          {
            id: 'r1',
            scriptName: '[隐藏]变量更新',
            findRegex: '/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gs',
            replaceString: '',
            trimStrings: [],
            placement: [2],
            disabled: false,
            markdownOnly: false,
            promptOnly: true,
            runOnEdit: false,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null,
          },
        ],
        tavern_helper: {
          scripts: [
            {
              type: 'folder',
              enabled: true,
              name: '变量',
              id: 'f1',
              icon: 'fa-cog',
              color: 'blue',
              scripts: [
                {
                  type: 'script',
                  enabled: true,
                  name: '变量结构',
                  id: 's1',
                  content: "import { registerMvuSchema } from 'util'\nregisterMvuSchema(Schema);\n",
                  info: '作者注',
                  button: { enabled: false, buttons: [] },
                  data: { note: '元数据' },
                  export_with: { data: true, button: true },
                },
                {
                  type: 'script',
                  enabled: false,
                  name: '备用脚本',
                  id: 's2',
                  content: 'console.info("备用");',
                  info: '',
                  button: { enabled: true, buttons: [{ name: '重载', visible: true }] },
                  data: { key: 1 },
                  export_with: { data: false, button: false },
                },
              ],
            },
          ],
          variables: { counter: 0 },
        },
      },
      tags: ['测试'],
      creator: 'tester',
      character_version: '1.0',
    },
  };
}

function v3Card() {
  const card = v2Card();
  card.spec = 'chara_card_v3';
  card.spec_version = '3.0';
  card.data.assets = [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }];
  card.data.group_only_greetings = ['群聊开场'];
  card.data.source = [];
  card.data.creation_date = 1;
  card.data.modification_date = 2;
  return card;
}

// ---------- 测试辅助 ----------

async function tempRoot(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  return root;
}

async function writeCardFile(root, relative, card) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(card, null, 2));
  return file;
}

async function roundtripJSON(card, name, root) {
  const file = await writeCardFile(root, path.join('来源', name + '.json'), card);
  return roundtripFromFile(file, name, root);
}

async function roundtripFromFile(file, name, root) {
  const dir = await splitCard(file, { name, root });
  const loaded = await loadProject(name, root);
  return { ...loaded, dir, file };
}

async function roundtripPNG(card, keyword, name, root) {
  const file = path.join(root, name + '.png');
  await fs.writeFile(file, buildPNG([cardChunk(keyword, card)]));
  const dir = await splitCard(file, { name, root });
  const loaded = await loadProject(name, root);
  return { ...loaded, dir, file };
}

async function readProjectFile(dir) {
  return JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8'));
}

async function writeProjectFile(dir, project) {
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project, null, 2));
}

// ---------- semanticDiff ----------

test('semanticDiff 按字段报告差异', () => {
  const before = { data: { description: 'a', tags: ['x'] } };
  const after = { data: { description: 'b', tags: ['x', 'y'] } };
  assert.deepEqual(semanticDiff(before, after), [
    { pointer: '/data/description', change: 'changed', before: 'a', after: 'b' },
    { pointer: '/data/tags/1', change: 'added', after: 'y' },
  ]);
  assert.deepEqual(semanticDiff(before, before), []);
  assert.deepEqual(semanticDiff({ a: 1 }, { b: 1 }), [
    { pointer: '/a', change: 'removed', before: 1 },
    { pointer: '/b', change: 'added', after: 1 },
  ]);
});

// ---------- JSON 往返 ----------

test('V2 JSON 拆分后重新加载语义等价', async t => {
  const root = await tempRoot(t, 'tcs-v2-json-');
  const card = v2Card();
  const { card: loaded, project, dir, file } = await roundtripJSON(card, 'v2-json', root);

  assert.deepEqual(semanticDiff(card, loaded), [], '拆分再加载后应与原卡完全一致');
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.name, 'v2-json');
  assert.equal(project.runtimeVerified, null);
  assert.equal(project.original.file, 'original/input.json');
  assert.equal(project.original.baseline, 'original/card.json');
  assert.equal(project.avatar, null, 'JSON 导入没有头像');
  assert.equal(path.basename(file), 'v2-json.json');

  await fs.access(path.join(dir, 'original', 'input.json'));
  await fs.access(path.join(dir, 'original', 'card.json'));
  await fs.access(path.join(dir, 'src', 'card.json'));
});

test('V3 JSON 往返保留 assets 与 group_only_greetings', async t => {
  const root = await tempRoot(t, 'tcs-v3-json-');
  const card = v3Card();
  const { card: loaded, project, dir } = await roundtripJSON(card, 'v3-json', root);

  assert.deepEqual(semanticDiff(card, loaded), []);
  assert.deepEqual(loaded.data.assets, card.data.assets);
  assert.deepEqual(loaded.data.group_only_greetings, ['群聊开场']);
  const pointers = project.fields.map(field => field.pointer);
  assert.ok(pointers.includes('/data/group_only_greetings/0'));
  assert.equal(await fs.readFile(path.join(dir, 'src', 'greetings', 'group_only_greetings-1.md'), 'utf8'), '群聊开场');
});

// ---------- PNG 往返 ----------

test('V2 PNG 使用 chara 块并可往返', async t => {
  const root = await tempRoot(t, 'tcs-v2-png-');
  const card = v2Card();
  const { card: loaded, project, dir } = await roundtripPNG(card, 'chara', 'v2-png', root);

  assert.equal(readCardPNG(await fs.readFile(path.join(dir, 'original', 'input.png'))).metadataType, 'chara');
  assert.equal(project.original.file, 'original/input.png');
  assert.deepEqual(semanticDiff(card, loaded), []);

  const rebuilt = writeCardPNG(await fs.readFile(path.join(dir, 'original', 'input.png')), loaded);
  assert.deepEqual(cardKeywords(rebuilt), ['chara']);
  assert.deepEqual(semanticDiff(card, readCardPNG(rebuilt).card), []);
});

test('V3 PNG 使用 ccv3 块并可往返', async t => {
  const root = await tempRoot(t, 'tcs-v3-png-');
  const card = v3Card();
  const { card: loaded, project, dir } = await roundtripPNG(card, 'ccv3', 'v3-png', root);

  assert.equal(readCardPNG(await fs.readFile(path.join(dir, 'original', 'input.png'))).metadataType, 'ccv3');
  assert.equal(project.original.file, 'original/input.png');
  assert.deepEqual(semanticDiff(card, loaded), []);

  const rebuilt = writeCardPNG(await fs.readFile(path.join(dir, 'original', 'input.png')), loaded);
  assert.deepEqual(cardKeywords(rebuilt), ['ccv3']);
  assert.deepEqual(semanticDiff(card, readCardPNG(rebuilt).card), []);
});

test('chara 与 ccv3 同时存在时优先 ccv3', () => {
  const v2 = v2Card();
  const v3 = v3Card();
  const png = buildPNG([cardChunk('chara', v2), cardChunk('ccv3', v3)]);

  const read = readCardPNG(png);
  assert.equal(read.metadataType, 'ccv3');
  assert.deepEqual(semanticDiff(v3, read.card), []);
  assert.notDeepEqual(semanticDiff(v2, read.card), []);
});

test('写 PNG 时保留未知 tEXt 块并消除旧角色数据块', () => {
  const v2 = v2Card();
  const v3 = v3Card();
  const image = buildPNG([
    textChunk('Comment', 'keep-me'),
    cardChunk('chara', v2),
    textChunk('Software', 'tavern-card-studio'),
  ]);
  const unknownBefore = parsePNG(image)
    .filter(c => c.type === 'tEXt' && !CARD_KEYWORDS.includes(c.data.subarray(0, c.data.indexOf(0)).toString('latin1').toLowerCase()))
    .map(c => c.raw);

  const asV3 = writeCardPNG(image, v3);
  const v3Entries = textEntries(asV3);
  assert.deepEqual(cardKeywords(asV3), ['ccv3'], '写回后只应留下一个新的角色数据块');
  assert.deepEqual(
    v3Entries.filter(entry => ['comment', 'software'].includes(entry.keyword.toLowerCase())).map(entry => entry.value),
    ['keep-me', 'tavern-card-studio'],
  );
  const unknownAfter = parsePNG(asV3)
    .filter(c => c.type === 'tEXt' && !CARD_KEYWORDS.includes(c.data.subarray(0, c.data.indexOf(0)).toString('latin1').toLowerCase()))
    .map(c => c.raw);
  assert.equal(unknownAfter.length, unknownBefore.length, '未知 tEXt 块数量不应变化');
  unknownAfter.forEach((raw, index) => assert.ok(raw.equals(unknownBefore[index]), '未知 tEXt 块应逐字节保留'));
  for (const type of ['IHDR', 'IDAT']) {
    assert.ok(
      parsePNG(asV3).find(c => c.type === type).raw.equals(parsePNG(image).find(c => c.type === type).raw),
      '图像数据块 ' + type + ' 应逐字节保留',
    );
  }
  assert.deepEqual(semanticDiff(v3, readCardPNG(asV3).card), []);

  const asV2 = writeCardPNG(asV3, v2);
  assert.deepEqual(cardKeywords(asV2), ['chara'], 'V2 写回不应留下 ccv3');
  assert.deepEqual(
    textEntries(asV2).filter(entry => ['comment', 'software'].includes(entry.keyword.toLowerCase())).map(entry => entry.value),
    ['keep-me', 'tavern-card-studio'],
  );
  assert.deepEqual(semanticDiff(v2, readCardPNG(asV2).card), []);

  const mismatched = writeCardPNG(buildPNG([cardChunk('ccv3', v2)]), v2);
  assert.deepEqual(cardKeywords(mismatched), ['chara'], '写入的块类型由卡的 spec 决定，而不是来源块');
});

// ---------- PNG 防御性检查 ----------

test('CRC 损坏的 PNG 被拒绝', () => {
  const png = buildPNG([cardChunk('chara', v2Card())]);
  const broken = Buffer.from(png);
  const idatAt = broken.indexOf(Buffer.from('IDAT', 'latin1'));
  assert.notEqual(idatAt, -1);
  broken[idatAt + 4] ^= 0xff;

  assert.throws(() => parsePNG(broken), /校验失败/);
  assert.throws(() => readCardPNG(broken), /校验失败/);
});

test('截断的 PNG 被拒绝', () => {
  const png = buildPNG([cardChunk('chara', v2Card())]);
  assert.throws(() => parsePNG(png.subarray(0, png.length - 8)), /截断|越界|IEND/);
  assert.throws(() => readCardPNG(png.subarray(0, png.length - 8)), /截断|越界|IEND/);
  assert.throws(() => parsePNG(png.subarray(0, 12)), /无效 PNG 签名|截断|越界/);
  assert.throws(() => parsePNG(png.subarray(0, 40)), /截断|越界|IEND/);
  assert.throws(() => parsePNG(Buffer.concat([png, Buffer.from([0])])), /IEND 后存在无效数据/);
});

test('缺失或损坏的角色数据块被拒绝', () => {
  assert.throws(() => readCardPNG(buildPNG([textChunk('Comment', '无卡')])), /没有角色卡数据/);
  assert.throws(() => readCardPNG(buildPNG([textChunk('chara', '!!!not-base64!!!')])), /Base64/);
  assert.throws(() => readCardPNG(buildPNG([textChunk('chara', Buffer.from('{不是 JSON', 'utf8').toString('base64'))])), /不是有效 JSON/);
});

// ---------- split 的输入校验 ----------

test('split 拒绝不支持的文件类型与非法角色卡', async t => {
  const root = await tempRoot(t, 'tcs-split-guard-');
  await fs.writeFile(path.join(root, 'card.txt'), 'hello');
  await assert.rejects(() => splitCard(path.join(root, 'card.txt'), { name: 'txt', root }), /只支持/);

  await fs.writeFile(path.join(root, 'array.json'), '[1,2]');
  await assert.rejects(() => splitCard(path.join(root, 'array.json'), { name: 'array', root }), /必须是 JSON 对象/);

  await fs.writeFile(path.join(root, 'v1.json'), JSON.stringify({ spec: 'chara_card_v1', data: {} }));
  await assert.rejects(() => splitCard(path.join(root, 'v1.json'), { name: 'v1', root }), /不支持的角色卡格式/);

  await fs.writeFile(path.join(root, 'nodata.json'), JSON.stringify({ spec: 'chara_card_v2' }));
  await assert.rejects(() => splitCard(path.join(root, 'nodata.json'), { name: 'nodata', root }), /缺少 data 对象/);
});

test('中文路径与中文卡名可用', async t => {
  const root = await tempRoot(t, '角色卡工作区-');
  const card = v2Card();
  const file = await writeCardFile(root, path.join('素材', '冷面剑客.json'), card);

  const dir = await splitCard(file, { name: '冷面剑客', root });
  assert.ok(dir.includes('冷面剑客'));
  const { card: loaded, project } = await loadProject('冷面剑客', root);
  assert.deepEqual(semanticDiff(card, loaded), []);
  assert.equal(project.name, '冷面剑客');

  await assert.rejects(() => splitCard(file, { name: '冷面剑客', root }), /已存在/);
});

// ---------- 字符串保真 ----------

test('空字段、CRLF、Unicode 与 EJS／宏字符串保真', async t => {
  const root = await tempRoot(t, 'tcs-fidelity-');
  const card = v2Card();
  const crlf = String.fromCharCode(13, 10);
  const tricky = [
    String.fromCharCode(0xfeff) + '第一行',
    '第二行 🌸 {{char}} 与 {{user}}',
    '<% if (variables.好感度 > 60) { %>',
    '<%- variables.好感度 %>',
    '<% } %>',
    String.fromCharCode(9) + '缩进行',
    '',
  ].join(crlf);
  card.data.description = tricky;
  card.data.creator_notes = '';
  card.data.system_prompt = '';

  const { card: loaded, project, dir } = await roundtripJSON(card, 'fidelity', root);
  assert.deepEqual(semanticDiff(card, loaded), []);

  const description = await fs.readFile(path.join(dir, 'src', 'text', 'description.md'), 'utf8');
  assert.equal(description, tricky, '拆分出的文本应与原字符串逐字符一致');
  assert.equal(await fs.readFile(path.join(dir, 'src', 'text', 'creator_notes.md'), 'utf8'), '');
  assert.ok(project.fields.some(field => field.pointer === '/data/system_prompt'));

  const cardJSON = JSON.parse(await fs.readFile(path.join(dir, 'src', 'card.json'), 'utf8'));
  assert.equal(cardJSON.data.description, '', '已拆分字段在 card.json 中留空占位');
});

test('带 BOM 与 CRLF 的 JSON 文件可以导入', async t => {
  const root = await tempRoot(t, 'tcs-bom-');
  const card = v2Card();
  const file = path.join(root, 'bom.json');
  await fs.writeFile(file, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(JSON.stringify(card, null, 2).replace(/\n/g, '\r\n'), 'utf8'),
  ]));

  const { card: loaded, project } = await roundtripFromFile(file, 'bom', root);
  assert.deepEqual(semanticDiff(card, loaded), []);
  assert.equal(project.original.file, 'original/input.json');
});

test('非字符串字段保持原值且不拆分', async t => {
  const root = await tempRoot(t, 'tcs-nonstring-');
  const card = v2Card();
  card.data.description = 123;
  card.data.alternate_greetings = [456, '仍然是文本'];
  card.data.character_book.entries[0].content = { not: 'string' };

  const { card: loaded, project } = await roundtripJSON(card, 'nonstring', root);
  assert.deepEqual(semanticDiff(card, loaded), []);
  const pointers = project.fields.map(field => field.pointer);
  assert.equal(pointers.includes('/data/description'), false, '非字符串描述不应被拆分');
  assert.equal(pointers.includes('/data/alternate_greetings/0'), false, '非字符串开场白不应被拆分');
  assert.ok(pointers.includes('/data/alternate_greetings/1'));
  assert.equal(pointers.includes('/data/character_book/entries/0/content'), false, '非字符串条目正文不应被拆分');
});

test('未知扩展的深嵌数组与对象原样保留', async t => {
  const root = await tempRoot(t, 'tcs-unknown-ext-');
  const card = v2Card();
  card.data.extensions['第三方插件'] = {
    配置: { nested: [{ deep: [1, '中文', { ok: true, list: [] }] }] },
    开关: false,
  };

  const { card: loaded, project } = await roundtripJSON(card, 'unknown-ext', root);
  assert.deepEqual(semanticDiff(card, loaded), []);
  assert.deepEqual(loaded.data.extensions['第三方插件'], card.data.extensions['第三方插件']);
  assert.equal(project.fields.some(field => field.pointer.includes('第三方插件')), false, '未知扩展不应被拆分');
});

// ---------- 脚本与 legacy 字段 ----------

test('脚本文件夹树的结构、顺序与元数据保真', async t => {
  const root = await tempRoot(t, 'tcs-scripts-');
  const card = v2Card();
  const { card: loaded, project, dir } = await roundtripJSON(card, 'scripts', root);

  assert.deepEqual(semanticDiff(card, loaded), []);
  const folder = loaded.data.extensions.tavern_helper.scripts[0];
  assert.equal(folder.type, 'folder');
  assert.deepEqual(folder.scripts.map(script => script.id), ['s1', 's2']);
  assert.deepEqual(folder.scripts[1].button, { enabled: true, buttons: [{ name: '重载', visible: true }] });
  assert.deepEqual(folder.scripts[1].export_with, { data: false, button: false });
  assert.equal(folder.scripts[1].enabled, false);
  assert.deepEqual(loaded.data.extensions.tavern_helper.variables, { counter: 0 });

  const byPointer = new Map(project.fields.map(field => [field.pointer, field.file]));
  const first = byPointer.get('/data/extensions/tavern_helper/scripts/0/scripts/0/content');
  const second = byPointer.get('/data/extensions/tavern_helper/scripts/0/scripts/1/content');
  assert.ok(first && second, '脚本正文应各自登记为拆分字段');
  assert.equal(await fs.readFile(path.join(dir, first), 'utf8'), card.data.extensions.tavern_helper.scripts[0].scripts[0].content);
  assert.equal(await fs.readFile(path.join(dir, second), 'utf8'), card.data.extensions.tavern_helper.scripts[0].scripts[1].content);
  assert.ok(byPointer.has('/data/extensions/regex_scripts/0/replaceString'), '正则替换文本应登记为拆分字段');

  const cardJSON = JSON.parse(await fs.readFile(path.join(dir, 'src', 'card.json'), 'utf8'));
  const scripts = cardJSON.data.extensions.tavern_helper.scripts[0].scripts;
  assert.deepEqual(scripts.map(script => script.content), ['', '']);
  assert.deepEqual(scripts.map(script => script.id), ['s1', 's2'], '拆分不应打乱脚本顺序');
});

test('根层 legacy 字段同样拆分并可还原', async t => {
  const root = await tempRoot(t, 'tcs-legacy-');
  const card = v2Card();

  const { card: loaded, project, dir } = await roundtripJSON(card, 'legacy', root);
  const pointers = project.fields.map(field => field.pointer);
  assert.ok(pointers.includes('/description'), '根层描述应被拆分');
  assert.ok(pointers.includes('/creatorcomment'));
  assert.ok(pointers.includes('/data/description'));
  assert.deepEqual(semanticDiff(card, loaded), []);
  assert.equal(await fs.readFile(path.join(dir, 'src', 'legacy', 'creatorcomment.md'), 'utf8'), '卡片备注');
  assert.equal(await fs.readFile(path.join(dir, 'src', 'text', 'description.md'), 'utf8'), card.data.description);
});

// ---------- 目录与原件保护 ----------

test('split 拒绝覆盖已有目录且不留下临时目录', async t => {
  const root = await tempRoot(t, 'tcs-existing-');
  const card = v2Card();
  const file = await writeCardFile(root, 'card.json', card);

  const dir = await splitCard(file, { name: 'dup', root });
  const before = await fs.readFile(path.join(dir, 'src', 'card.json'), 'utf8');

  await assert.rejects(() => splitCard(file, { name: 'dup', root }), /已存在/);
  assert.equal(await fs.readFile(path.join(dir, 'src', 'card.json'), 'utf8'), before, '失败时不应改动已有目录');

  const leftovers = (await fs.readdir(path.join(root, 'cards'))).filter(name => name.startsWith('.tmp-'));
  assert.deepEqual(leftovers, [], '失败的导入不应留下临时目录');
});

test('篡改 original/ 原件会被检测', async t => {
  const root = await tempRoot(t, 'tcs-tamper-');
  const card = v2Card();
  const file = await writeCardFile(root, 'card.json', card);
  const dir = await splitCard(file, { name: 'tamper', root });
  const project = await readProjectFile(dir);

  const inputFile = path.join(dir, 'original', 'input.json');
  const originalBytes = await fs.readFile(inputFile);
  await fs.writeFile(inputFile, JSON.stringify({ ...card, name: '被改过的原件' }));
  await assert.rejects(() => loadProject('tamper', root), /原件校验失败/);

  await fs.writeFile(inputFile, originalBytes);
  await loadProject('tamper', root);

  await fs.writeFile(path.join(dir, project.original.baseline), '{}');
  await assert.rejects(() => loadProject('tamper', root), /原件校验失败/);
  assert.equal(project.original.baselineSha256.length, 64);
});

// ---------- manifest 校验 ----------

test('project.json 冲突与越界会被拒绝，修复后可恢复加载', async t => {
  const root = await tempRoot(t, 'tcs-manifest-');
  const card = v2Card();
  const file = await writeCardFile(root, 'card.json', card);
  const dir = await splitCard(file, { name: 'manifest', root });
  const project = await readProjectFile(dir);
  const baseline = JSON.parse(JSON.stringify(project));
  const splitFile = project.fields[0].file;
  const splitPointer = project.fields[0].pointer;

  const expectFailure = async (mutate, expected) => {
    const next = JSON.parse(JSON.stringify(baseline));
    mutate(next);
    await writeProjectFile(dir, next);
    await assert.rejects(() => loadProject('manifest', root), expected);
  };

  await expectFailure(p => { p.fields.push({ pointer: splitPointer, file: 'src/text/duplicate-pointer.md' }); }, /重复字段映射/);
  await expectFailure(p => { p.fields.push({ pointer: '/data/creator', file: splitFile }); }, /重复源文件映射/);
  await expectFailure(p => { p.fields.push({ pointer: '/data/creator', file: 'outside/creator.md' }); }, /字段源必须放在/);
  await expectFailure(p => { p.fields.push({ pointer: '/data/不存在', file: 'src/text/missing.md' }); }, /字段不存在/);
  await expectFailure(p => { p.fields.push({ pointer: '/data/name', file: 'src/text/name.md' }); }, /必须保持空字符串/);
  await expectFailure(p => { p.schemaVersion = 99; }, /不受支持/);
  await expectFailure(p => { p.builds = [{ kind: 'web', entry: splitFile, pointer: splitPointer }]; }, /未知构建类型/);
  await expectFailure(p => { p.builds = [{ kind: 'script', entry: splitFile, pointer: '/data/name' }]; }, /构建目标必须是已拆分字段/);
  await expectFailure(p => { p.builds = [{ kind: 'script', entry: 'src/scripts/缺失.js', pointer: splitPointer }]; }, /ENOENT|不存在|no such file/i);
  await expectFailure(p => {
    p.builds = [
      { kind: 'script', entry: splitFile, pointer: splitPointer },
      { kind: 'script', entry: splitFile, pointer: splitPointer },
    ];
  }, /多个构建写入同一字段/);

  await writeProjectFile(dir, baseline);
  const { card: loaded } = await loadProject('manifest', root);
  assert.deepEqual(semanticDiff(card, loaded), []);
  assert.deepEqual(await readProjectFile(dir), baseline);
});
