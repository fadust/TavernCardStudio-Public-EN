// 创作格式 v2：仅使用公开 API 的独立测试。
// 只依赖 tools/lib/{templates,project,authoring,files,png}.mjs 与 node:test；不改动工具实现。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { newCard } from '../tools/lib/templates.mjs';
import { loadProject, migrateProject, semanticDiff, splitCard } from '../tools/lib/project.mjs';
import { writeAuthoring, loadAuthoring, writeYAML, readYAML, helperScriptLists } from '../tools/lib/authoring.mjs';
import { jsonText, sha256, write, writeJSON } from '../tools/lib/files.mjs';
import { chunk, readCardPNG, writeCardPNG } from '../tools/lib/png.mjs';

const REPO = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

// ---------- 测试辅助 ----------

async function tempRoot(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  return root;
}

const CARD_TEMPLATE = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  name: '旧卡名称',
  description: '卡级描述',
  creatorcomment: '旧版备注',
  tags: ['旧标签'],
  data: {
      name: '旧版卡名',
      description: '她站在雨里。',
      personality: '沉默寡言',
      scenario: '雨夜的车站',
      first_mes: '「你来了。」',
      mes_example: '<START>\n{{char}}: ……',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: ['备选一', '备选二'],
      group_only_greetings: ['群聊一'],
      tags: ['旧标签'],
      creator: '旧作者',
      character_version: '1.0',
    extensions: {},
  },
};

function baseCard() {
  return structuredClone(CARD_TEMPLATE);
}

function cardWithHelper() {
  const card = baseCard();
  card.data.extensions.regex_scripts = [
    {
      id: 'r1',
      scriptName: '[隐藏]变量更新',
      findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gs',
      replaceString: '隐藏一的替换',
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: true,
      promptOnly: true,
      runOnEdit: false,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    },
    {
      id: 'r2',
      scriptName: '显示备注',
      findRegex: '/<note>(.*?)<\\/note>/g',
      replaceString: '隐藏二的替换',
      trimStrings: [],
      placement: [0],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    },
  ];
  card.data.extensions.tavern_helper = {
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
            content: 'console.info("变量结构");',
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
      {
        type: 'script',
        enabled: true,
        name: '顶层脚本',
        id: 's3',
        content: 'console.info("顶层");',
        info: '',
        button: { enabled: false, buttons: [] },
        data: {},
        export_with: { data: true, button: false },
      },
    ],
    variables: { counter: 0 },
  };
  return card;
}

async function splitJSON(t, card, name, prefix) {
  const root = await tempRoot(t, prefix);
  const file = path.join(root, name + '.json');
  await fs.writeFile(file, JSON.stringify(card, null, 2));
  const dir = await splitCard(file, { name, root });
  return { root, dir, file };
}

async function dirEntries(dir, relative) {
  try { return (await fs.readdir(path.join(dir, relative))).sort(); }
  catch (error) { if (error.code === 'ENOENT') return null; return Promise.reject(error); }
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
async function readProjectJSON(dir) { return JSON.parse(await readText(dir, 'project.json')); }
async function writeProjectJSON(dir, project) { await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project, null, 2)); }

// 只使用公开 API 的 PNG 构造；与 build.test.mjs 相同的最小可用做法。
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function ihdr(width = 1, height = 1) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0); data.writeUInt32BE(height, 4);
  data[8] = 8; data[9] = 2; data[10] = 0; data[11] = 0; data[12] = 0;
  return chunk('IHDR', data);
}
function idat(width = 1, height = 1) {
  const rows = [];
  for (let y = 0; y < height; y++) rows.push(Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, y + 1)]));
  return chunk('IDAT', deflateSync(Buffer.concat(rows)));
}
function textChunk(keyword, value) {
  const NUL = String.fromCharCode(0);
  return chunk('tEXt', Buffer.concat([Buffer.from(keyword + NUL, 'latin1'), Buffer.from(value, 'latin1')]));
}
function cardPNG(keyword, card, extra = []) {
  const data = Buffer.from(JSON.stringify(card), 'utf8').toString('base64');
  return Buffer.concat([PNG_SIGNATURE, ihdr(), ...extra, textChunk(keyword, data), idat(), chunk('IEND', Buffer.alloc(0))]);
}
async function writeCardFile(root, relative, card) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(card, null, 2));
  return file;
}

// ---------- 新建与默认分布 ----------

test('newCard 默认 schemaVersion 2，无 src/card.json，只写第一条消息', async t => {
  const root = await tempRoot(t, 'tcs-v2-new-');
  const dir = await newCard('默认骨架', { root, modules: ['worldbook'] });
  const project = await readProjectJSON(dir);
  const loaded = await loadProject('默认骨架', root);
  const index = await readYAML(dir, 'src/index.yaml');

  assert.equal(project.schemaVersion, 2, '新建直接产出 v2');
  assert.equal(project.source, 'src/index.yaml');
  assert.deepEqual(Object.keys(project.state).sort(), ['file', 'sha256']);
  assert.equal(project.state.file, '.card/state.json');
  assert.equal(await hasFile(dir, 'src/card.json'), false, 'v2 不再生成 src/card.json');
  assert.deepEqual(await dirEntries(dir, 'src/text'), ['creator_notes.md', 'description.md', 'first_mes.md', 'mes_example.md', 'personality.md', 'post_history_instructions.md', 'scenario.md', 'system_prompt.md']);
  for (const name of ['description.md', 'personality.md', 'scenario.md', 'mes_example.md']) assert.equal(await readText(dir, 'src/text/' + name), '', '新卡默认留空 ' + name);

  assert.equal(index.文本['第一条消息'], 'src/text/first_mes.md');
  assert.notEqual(await readText(dir, 'src/text/first_mes.md'), '', '开场白保留模板内容');
  assert.equal(loaded.card.data.description, '');
  assert.equal(loaded.card.data.personality, '');
  assert.equal(loaded.card.data.scenario, '');
  assert.equal(loaded.card.data.mes_example, '');
  assert.deepEqual(loaded.card.data.character_book.entries.map(entry => entry.comment), ['世界观', '地理总览', '旧书店', '角色总览', '书店店主', '信息边界'], 'worldbook 模板条目保留');

  await t.test('纯文字卡不带可选模块内容', async () => {
    const textOnly = await newCard('纯文字骨架', { root });
    const textOnlyLoaded = await loadProject('纯文字骨架', root);
    assert.deepEqual(textOnlyLoaded.project.modules, []);
    assert.deepEqual(textOnlyLoaded.project.builds, []);
    assert.equal(textOnlyLoaded.card.data.extensions && Object.keys(textOnlyLoaded.card.data.extensions).length, 0);
    assert.equal(textOnlyLoaded.card.data.character_book, undefined);
    assert.equal(await hasFile(textOnly, 'src/card.json'), false);
  });
});

test('导入卡的非空描述、性格、场景、对话示例保留', async t => {
  const card = baseCard();
  const { root, dir } = await splitJSON(t, card, '导入保留', 'tcs-v2-import-keep-');
  const loaded = await loadProject('导入保留', root);

  assert.equal(loaded.card.data.description, card.data.description);
  assert.equal(loaded.card.data.personality, card.data.personality);
  assert.equal(loaded.card.data.scenario, card.data.scenario);
  assert.equal(loaded.card.data.mes_example, card.data.mes_example);
  assert.equal(await readText(dir, 'src/text/description.md'), card.data.description);
  assert.equal(await readText(dir, 'src/text/personality.md'), card.data.personality);
  assert.deepEqual(semanticDiff(card, loaded.card), [], '导入后立即加载应无差异');
});

// ---------- YAML 元数据与文本 ----------

test('YAML 中文元数据与正文可改后重新读取', async t => {
  const card = baseCard();
  const { root, dir } = await splitJSON(t, card, '元数据', 'tcs-v2-yaml-');
  const index = await readYAML(dir, 'src/index.yaml');
  const rawIndex = await readText(dir, 'src/index.yaml');

  assert.match(rawIndex, /角色:/);
  assert.match(rawIndex, /名称:/);
  assert.doesNotMatch(rawIndex, /\\u[0-9a-fA-F]{4}/, 'YAML 不应把中文写成转义序列');
  assert.equal(index.角色.名称, card.data.name);
  assert.equal(index.文本.第一条消息, 'src/text/first_mes.md');

  index.角色.名称 = '雨夜旅人';
  index.角色.作者 = '测试作者';
  index.角色.版本 = '2.1';
  index.角色.标签 = ['奇幻', '雨夜'];
  await writeYAML(dir, 'src/index.yaml', index);
  await writeText(dir, 'src/text/first_mes.md', '「雨停了。」');

  const reloaded = await loadProject('元数据', root);
  assert.equal(reloaded.card.data.name, '雨夜旅人');
  assert.equal(reloaded.card.data.creator, '测试作者');
  assert.equal(reloaded.card.data.character_version, '2.1');
  assert.deepEqual(reloaded.card.data.tags, ['奇幻', '雨夜']);
  assert.equal(reloaded.card.data.first_mes, '「雨停了。」');
  const indexAgain = await readYAML(dir, 'src/index.yaml');
  assert.equal(indexAgain.角色.作者, '测试作者', 'YAML 写回后仍是中文');
  assert.equal((await readText(dir, 'src/index.yaml')).includes('测试作者'), true);
});

test('世界书条目的增删与重排按索引生效', async t => {
  const card = baseCard();
  card.data.character_book = {
    name: '测试世界书',
    entries: [
      { id: 0, keys: ['甲'], secondary_keys: [], comment: '甲', content: '甲的内容', enabled: true, constant: false, selective: true, insertion_order: 10, position: 'before_char', use_regex: false, extensions: { position: 0, depth: 4, role: 0 } },
      { id: 1, keys: ['乙'], secondary_keys: [], comment: '乙', content: '乙的内容', enabled: true, constant: true, selective: false, insertion_order: 20, position: 'after_char', use_regex: false, extensions: { position: 1, depth: 4, role: 0 } },
    ],
  };
  const { root, dir } = await splitJSON(t, card, '世界书', 'tcs-v2-worldbook-');

  let index = await readYAML(dir, 'src/index.yaml');
  assert.equal(index.世界书.条目.length, 2);
  const [first, second] = index.世界书.条目;

  index.世界书.条目 = [second, first];
  await writeYAML(dir, 'src/index.yaml', index);
  let loaded = await loadProject('世界书', root);
  assert.deepEqual(loaded.card.data.character_book.entries.map(entry => entry.comment), ['乙', '甲'], '重排索引即改变运行时顺序');
  assert.deepEqual(loaded.card.data.character_book.entries.map(entry => entry.content), ['乙的内容', '甲的内容']);

  const added = 'src/worldbook/新增-丙.yaml';
  await writeYAML(dir, added, { 名称: '丙', 启用: true, 关键词: ['丙'], 顺序: 30, 文件: 'src/worldbook/新增-丙.md' });
  await writeText(dir, 'src/worldbook/新增-丙.md', '丙的内容');
  index.世界书.条目 = [second, added, first];
  await writeYAML(dir, 'src/index.yaml', index);
  loaded = await loadProject('世界书', root);
  assert.deepEqual(loaded.card.data.character_book.entries.map(entry => entry.comment), ['乙', '丙', '甲']);
  const addedEntry = loaded.card.data.character_book.entries[1];
  assert.equal(addedEntry.content, '丙的内容');
  assert.equal(typeof addedEntry.id, 'number', '新条目 ID 由工具生成');
  assert.equal(addedEntry.keys[0], '丙');

  index.世界书.条目 = [second, first];
  await writeYAML(dir, 'src/index.yaml', index);
  loaded = await loadProject('世界书', root);
  assert.deepEqual(loaded.card.data.character_book.entries.map(entry => entry.comment), ['乙', '甲'], '移除引用即退出打包');
  assert.equal(await hasFile(dir, 'src/worldbook/新增-丙.yaml'), true, '未引用的 YAML 可以保留');
});

test('正则条目的增删与重排按索引生效，替换文本独立可改', async t => {
  const card = cardWithHelper();
  const { root, dir } = await splitJSON(t, card, '正则', 'tcs-v2-regex-');

  let index = await readYAML(dir, 'src/index.yaml');
  assert.equal(index.正则.length, 2);
  const [first, second] = index.正则;
  const firstConfig = await readYAML(dir, first);
  assert.equal(firstConfig.关联.startsWith('regex-'), true, '导入条目带工具生成的关联');
  assert.equal(firstConfig.名称, '[隐藏]变量更新');

  await writeText(dir, firstConfig.替换文件, '改过的替换文本');
  index.正则 = [second, first];
  await writeYAML(dir, 'src/index.yaml', index);
  let loaded = await loadProject('正则', root);
  let regexes = loaded.card.data.extensions.regex_scripts;
  assert.deepEqual(regexes.map(regex => regex.scriptName), ['显示备注', '[隐藏]变量更新']);
  assert.deepEqual(regexes.map(regex => regex.replaceString), ['隐藏二的替换', '改过的替换文本']);
  assert.deepEqual(regexes[0].placement, [0]);
  assert.deepEqual(regexes[1].placement, [2]);

  const added = 'src/regex/新增-清理.yaml';
  await writeYAML(dir, added, { 名称: '清理', 查找: '/ +$/g', 替换文件: 'src/regex/新增-清理.txt', 作用于: ['AI输出'] });
  await writeText(dir, 'src/regex/新增-清理.txt', '');
  index.正则 = [second, added, first];
  await writeYAML(dir, 'src/index.yaml', index);
  loaded = await loadProject('正则', root);
  regexes = loaded.card.data.extensions.regex_scripts;
  assert.deepEqual(regexes.map(regex => regex.scriptName), ['显示备注', '清理', '[隐藏]变量更新']);
  assert.deepEqual(regexes[1].placement, [2]);
  assert.equal(regexes[1].replaceString, '');
  assert.equal(regexes[2].replaceString, '改过的替换文本');

  index.正则 = [added, second];
  await writeYAML(dir, 'src/index.yaml', index);
  loaded = await loadProject('正则', root);
  assert.deepEqual(loaded.card.data.extensions.regex_scripts.map(regex => regex.scriptName), ['清理', '显示备注']);
});

test('脚本文件夹嵌套的增删与重排', async t => {
  const card = cardWithHelper();
  card.data.extensions.tavern_helper.scripts[1].scripts = [
    {
      type: 'script',
      enabled: true,
      name: '内层脚本',
      id: 's4',
      content: 'console.info("内层");',
      info: '',
      button: { enabled: false, buttons: [] },
      data: {},
      export_with: { data: true, button: false },
    },
  ];
  card.data.extensions.tavern_helper.scripts.splice(1, 0, {
    type: 'folder',
    enabled: true,
    name: '外层文件夹',
    id: 'f2',
    icon: 'fa-folder',
    color: 'green',
    scripts: [
      {
        type: 'script',
        enabled: true,
        name: '子脚本',
        id: 's5',
        content: 'console.info("子脚本");',
        info: '子说明',
        button: { enabled: false, buttons: [] },
        data: { nested: [1, 2] },
        export_with: { data: true, button: true },
      },
    ],
  });
  const { root, dir } = await splitJSON(t, card, '脚本', 'tcs-v2-script-');

  let index = await readYAML(dir, 'src/index.yaml');
  assert.equal(index.脚本.length, 3, '顶层脚本条目按索引列出');
  const folderFile = index.脚本[1];
  const folderConfig = await readYAML(dir, folderFile);
  assert.equal(folderConfig.类型, '文件夹');
  assert.equal(folderConfig.脚本.length, 1);
  assert.equal((await readYAML(dir, folderConfig.脚本[0])).名称, '子脚本');

  index.脚本 = [index.脚本[2], index.脚本[1], index.脚本[0]];
  await writeYAML(dir, 'src/index.yaml', index);
  let loaded = await loadProject('脚本', root);
  let scripts = loaded.card.data.extensions.tavern_helper.scripts;
  assert.deepEqual(scripts.map(script => script.name), ['顶层脚本', '外层文件夹', '变量']);
  assert.deepEqual(scripts[0].data, {});
  assert.deepEqual(scripts[1].scripts.map(child => child.name), ['子脚本']);
  assert.deepEqual(scripts[2].scripts.map(child => child.name), ['变量结构', '备用脚本']);
  assert.deepEqual(scripts[2].scripts[1].button, { enabled: true, buttons: [{ name: '重载', visible: true }] });
  assert.deepEqual(scripts[2].scripts[1].export_with, { data: false, button: false });
  assert.deepEqual(loaded.card.data.extensions.tavern_helper.variables, { counter: 0 });

  const added = 'src/scripts/新增-收尾.yaml';
  await writeYAML(dir, added, { 名称: '收尾', 类型: '脚本', 启用: false, 说明: '新脚本', 数据: { a: 1 }, 文件: 'src/scripts/新增-收尾.js' });
  await writeText(dir, 'src/scripts/新增-收尾.js', 'console.info("收尾");');
  index.脚本 = [added, index.脚本[0]];
  await writeYAML(dir, 'src/index.yaml', index);
  loaded = await loadProject('脚本', root);
  scripts = loaded.card.data.extensions.tavern_helper.scripts;
  assert.deepEqual(scripts.map(script => script.name), ['收尾', '顶层脚本']);
  assert.equal(scripts[0].enabled, false);
  assert.deepEqual(scripts[0].data, { a: 1 });
  assert.equal(scripts[0].content, 'console.info("收尾");');
  assert.match(scripts[0].id, /^[a-f0-9]{32}$/, '新脚本 ID 由工具生成');
});

test('开场白的增删与重排按索引生效', async t => {
  const { root, dir } = await splitJSON(t, baseCard(), '开场白', 'tcs-v2-greetings-');
  let index = await readYAML(dir, 'src/index.yaml');
  assert.equal(index.备选开场白.length, 2);
  assert.equal(index.群聊开场白.length, 1);
  let loaded = await loadProject('开场白', root);
  assert.deepEqual(loaded.card.data.alternate_greetings, ['备选一', '备选二']);
  assert.deepEqual(loaded.card.data.group_only_greetings, ['群聊一']);

  const added = 'src/greetings/新-前言.md';
  await writeText(dir, added, '新的开场');
  index.备选开场白 = [added, index.备选开场白[1], index.备选开场白[0]];
  await writeYAML(dir, 'src/index.yaml', index);
  loaded = await loadProject('开场白', root);
  assert.deepEqual(loaded.card.data.alternate_greetings, ['新的开场', '备选二', '备选一'], '新增与重排按索引生效');

  index = await readYAML(dir, 'src/index.yaml');
  index.备选开场白 = [index.备选开场白[2]];
  index.群聊开场白 = [];
  await writeYAML(dir, 'src/index.yaml', index);
  loaded = await loadProject('开场白', root);
  assert.deepEqual(loaded.card.data.alternate_greetings, ['备选一'], '移除引用即退出打包');
  assert.deepEqual(loaded.card.data.group_only_greetings, [], '群聊开场白同样按索引');
});

test('同一开场白文件被多段引用会被拒绝', async t => {
  const { root, dir } = await splitJSON(t, baseCard(), '重复开场白', 'tcs-v2-greetings-dup-');
  const index = await readYAML(dir, 'src/index.yaml');
  index.备选开场白 = [...index.备选开场白, index.群聊开场白[0]];
  await writeYAML(dir, 'src/index.yaml', index);
  await assert.rejects(() => loadProject('重复开场白', root), /重复源文件引用或循环引用/);
});

// ---------- 构建绑定 ----------

test('正则与脚本条目的构建绑定跟随条目，重排后指针与入口不错位', async t => {
  const card = baseCard();
  card.data.extensions.regex_scripts = [];
  card.data.extensions.tavern_helper = { scripts: [], variables: {} };
  const { root, dir } = await splitJSON(t, card, '构建绑定', 'tcs-v2-builds-');

  const htmlEntry = 'src/regex/001-界面.yaml';
  await writeYAML(dir, htmlEntry, { 名称: '界面', 查找: '/<CardStatus\/>/g', 替换文件: 'src/regex/001-界面.txt', 构建: { 类型: 'html', 入口: 'src/ui/html/index.html' } });
  await writeText(dir, 'src/regex/001-界面.txt', '');
  await writeText(dir, 'src/ui/html/index.html', '<main>界面</main>');
  const scriptEntry = 'src/scripts/001-脚本.yaml';
  await writeYAML(dir, scriptEntry, { 名称: '脚本', 类型: '脚本', 文件: 'src/scripts/001-脚本.js', 构建: { 类型: 'script', 入口: 'src/scripts/001-脚本.js' } });
  await writeText(dir, 'src/scripts/001-脚本.js', 'console.info("脚本");');
  const index = await readYAML(dir, 'src/index.yaml');
  index.正则 = [htmlEntry];
  index.脚本 = [scriptEntry];
  await writeYAML(dir, 'src/index.yaml', index);

  let loaded = await loadProject('构建绑定', root);
  assert.deepEqual(loaded.project.builds.map(build => build.kind).sort(), ['html', 'script']);

  const htmlBuild = loaded.project.builds.find(build => build.kind === 'html');
  assert.deepEqual(htmlBuild, { kind: 'html', entry: 'src/ui/html/index.html', pointer: '/data/extensions/regex_scripts/0/replaceString' });
  assert.equal(loaded.project.fields.find(field => field.pointer === htmlBuild.pointer).file, 'src/regex/001-界面.txt');

  const second = 'src/scripts/002-脚本.yaml';
  await writeYAML(dir, second, { 名称: '脚本二', 类型: '脚本', 文件: 'src/scripts/002-脚本.js' });
  await writeText(dir, 'src/scripts/002-脚本.js', 'console.info("脚本二");');
  index.脚本 = [second, scriptEntry];
  await writeYAML(dir, 'src/index.yaml', index);
  loaded = await loadProject('构建绑定', root);
  const scriptBuild = loaded.project.builds.find(build => build.kind === 'script');
  assert.deepEqual(scriptBuild, { kind: 'script', entry: 'src/scripts/001-脚本.js', pointer: '/data/extensions/tavern_helper/scripts/1/content' });
  assert.equal(loaded.project.fields.find(field => field.pointer === scriptBuild.pointer).file, 'src/scripts/001-脚本.js');
  assert.equal(await readText(dir, scriptBuild.entry), 'console.info("脚本");');
});

test('世界书条目的构建绑定跟随条目，重排后指针与入口不错位', async t => {
  const card = baseCard();
  card.data.character_book = {
    name: '构建世界书',
    entries: [
      { id: 0, keys: [], secondary_keys: [], comment: '甲', content: '甲的内容', enabled: true, constant: false, selective: true, insertion_order: 10, position: 'before_char', use_regex: false, extensions: { position: 0, depth: 4, role: 0 } },
      { id: 1, keys: [], secondary_keys: [], comment: '乙', content: '乙的内容', enabled: true, constant: false, selective: true, insertion_order: 20, position: 'before_char', use_regex: false, extensions: { position: 0, depth: 4, role: 0 } },
    ],
  };
  const { root, dir } = await splitJSON(t, card, '构建世界书', 'tcs-v2-wbbuild-');

  let index = await readYAML(dir, 'src/index.yaml');
  const [first, second] = index.世界书.条目;
  const firstConfig = await readYAML(dir, first);
  assert.equal(firstConfig.文件, 'src/worldbook/001-甲.md');
  firstConfig.构建 = { 类型: 'script', 入口: 'src/worldbook/001-甲.js' };
  await writeYAML(dir, first, firstConfig);
  await writeText(dir, 'src/worldbook/001-甲.js', 'console.info("甲构建");');

  let loaded = await loadProject('构建世界书', root);
  assert.deepEqual(loaded.project.builds, [{ kind: 'script', entry: 'src/worldbook/001-甲.js', pointer: '/data/character_book/entries/0/content' }]);

  index.世界书.条目 = [second, first];
  await writeYAML(dir, 'src/index.yaml', index);
  loaded = await loadProject('构建世界书', root);
  assert.deepEqual(loaded.project.builds, [{ kind: 'script', entry: 'src/worldbook/001-甲.js', pointer: '/data/character_book/entries/1/content' }], '重排后指针跟着条目');
  assert.equal(loaded.card.data.character_book.entries[1].comment, '甲');
  assert.equal(loaded.project.fields.find(field => field.pointer === loaded.project.builds[0].pointer).file, 'src/worldbook/001-甲.md');
  assert.equal(await readText(dir, loaded.project.builds[0].entry), 'console.info("甲构建");');

  index.世界书.条目 = [first, second];
  await writeYAML(dir, 'src/index.yaml', index);
  loaded = await loadProject('构建世界书', root);
  assert.deepEqual(loaded.project.builds, [{ kind: 'script', entry: 'src/worldbook/001-甲.js', pointer: '/data/character_book/entries/0/content' }]);
});

test('HTML 模块的界面构建绑定仍指向正则替换字段', async t => {
  const root = await tempRoot(t, 'tcs-v2-ui-build-');
  await newCard('界面构建', { root, modules: ['html'] });
  const loaded = await loadProject('界面构建', root);
  const uiBuild = loaded.project.builds.find(build => build.kind === 'html');
  assert.ok(uiBuild, 'HTML 模块应登记 html 构建');
  assert.match(uiBuild.pointer, /^\/data\/extensions\/regex_scripts\/\d+\/replaceString$/);
  assert.equal(await hasFile(loaded.dir, uiBuild.entry), true);
  const field = loaded.project.fields.find(candidate => candidate.pointer === uiBuild.pointer);
  assert.ok(field, '构建目标必须是已拆分字段');
  assert.match(field.file, /^src\/regex\/.*\.txt$/);
});

// ---------- 新条目省略关联 ----------

test('新配置条目可省略关联，默认 ID 与名称由工具生成', async t => {
  const card = baseCard();
  const { root, dir } = await splitJSON(t, card, '省略关联', 'tcs-v2-nokey-');
  const index = await readYAML(dir, 'src/index.yaml');

  const worldbookFile = 'src/worldbook/999-无关联.yaml';
  await writeYAML(dir, worldbookFile, { 名称: '无关联世界书', 关键词: ['无关联'], 文件: 'src/worldbook/999-无关联.md' });
  await writeText(dir, 'src/worldbook/999-无关联.md', '无关联正文');
  index.世界书 = index.世界书 ?? { 条目: [] };
  index.世界书.条目 = [worldbookFile];
  await writeYAML(dir, 'src/index.yaml', index);

  const regexFile = 'src/regex/999-无关联.yaml';
  await writeYAML(dir, regexFile, { 名称: '无关联正则', 查找: '/x/g', 替换文件: 'src/regex/999-无关联.txt' });
  await writeText(dir, 'src/regex/999-无关联.txt', '替换');
  const scriptFile = 'src/scripts/999-无关联.yaml';
  await writeYAML(dir, scriptFile, { 名称: '无关联脚本', 类型: '脚本', 文件: 'src/scripts/999-无关联.js' });
  await writeText(dir, 'src/scripts/999-无关联.js', 'console.info("无关联");');
  const secondIndex = await readYAML(dir, 'src/index.yaml');
  secondIndex.正则 = [regexFile];
  secondIndex.脚本 = [scriptFile];
  await writeYAML(dir, 'src/index.yaml', secondIndex);

  const loaded = await loadProject('省略关联', root);
  const entry = loaded.card.data.character_book.entries[0];
  assert.equal(entry.comment, '无关联世界书', '当前默认名称取 YAML 的 名称');
  assert.equal(entry.content, '无关联正文');
  assert.equal(Number.isInteger(entry.id), true, '默认 ID 由工具生成');
  assert.equal(entry.enabled, true);
  const regex = loaded.card.data.extensions.regex_scripts[0];
  assert.equal(regex.scriptName, '无关联正则');
  assert.equal(regex.replaceString, '替换');
  assert.match(regex.id, /^[a-f0-9]{32}$/);
  const script = loaded.card.data.extensions.tavern_helper.scripts[0];
  assert.equal(script.name, '无关联脚本');
  assert.equal(script.type, 'script');
  assert.equal(script.content, 'console.info("无关联");');
  assert.match(script.id, /^[a-f0-9]{32}$/);
});

// ---------- 未知字段与兼容数据 ----------

test('未知字段、legacy 与嵌套脚本文件夹不丢失', async t => {
  const card = cardWithHelper();
  card.data.extensions['第三方插件'] = { 配置: { nested: [{ deep: [1, '中文', { ok: true, list: [] }] }] }, 开关: false };
  card.data.character_book = {
    name: '兼容世界书',
    entries: [{ id: 7, keys: ['甲'], secondary_keys: ['乙'], comment: '甲', content: '甲正文', enabled: true, constant: false, selective: true, insertion_order: 3, position: 'before_char', use_regex: true, extensions: { position: 0, depth: 2, role: 1, probability: 60, useProbability: true, vectorized: false }, 未知条目字段: { keep: [1, 2] } }],
  };
  card.data.nickname = '别名';
  card.data.group_only_greetings = ['群聊一'];
  const { root, dir } = await splitJSON(t, card, '兼容', 'tcs-v2-compat-');

  const loaded = await loadProject('兼容', root);
  assert.deepEqual(semanticDiff(card, loaded.card), [], '未知与 legacy 数据应原样保留');
  assert.deepEqual(loaded.card.data.extensions['第三方插件'], card.data.extensions['第三方插件']);
  assert.deepEqual(loaded.card.data.character_book.entries[0]['未知条目字段'], { keep: [1, 2] });
  assert.equal(loaded.card.description, card.description);
  assert.equal(loaded.card.creatorcomment, card.creatorcomment);
  assert.deepEqual(loaded.card.tags, card.tags);
  assert.equal(await readText(dir, 'src/legacy/description.md'), card.description);
  assert.equal(await readText(dir, 'src/legacy/creatorcomment.md'), card.creatorcomment);

  const index = await readYAML(dir, 'src/index.yaml');
  assert.deepEqual(Object.keys(index.兼容文本).sort(), ['legacy/creatorcomment', 'legacy/description'], '兼容文本按原始指针登记');
  assert.equal(index.兼容文本['legacy/description'], 'src/legacy/description.md');
  assert.equal(index.兼容文本['legacy/creatorcomment'], 'src/legacy/creatorcomment.md');
  assert.equal(loaded.project.fields.some(field => field.pointer === '/description'), true);
  assert.equal(loaded.project.fields.some(field => field.pointer === '/creatorcomment'), true);

  let folderFile;
  for (const file of index.脚本) {
    const config = await readYAML(dir, file);
    if (config.名称 === '变量') { folderFile = file; break; }
  }
  assert.ok(folderFile, '文件夹条目应出现在索引里');
  const folderConfig = await readYAML(dir, folderFile);
  assert.equal(folderConfig.类型, '文件夹');
  const nested = folderConfig.脚本[0];
  assert.equal((await readYAML(dir, nested)).名称, '变量结构');
  assert.equal((await readYAML(dir, folderConfig.脚本[1])).名称, '备用脚本');
  const nestedBody = nested.replace(/\.yaml$/, '.js');
  assert.equal(await readText(dir, nestedBody), 'console.info("变量结构");');

  const state = JSON.parse(await readText(dir, '.card/state.json'));
  assert.deepEqual(state.card.data.nickname, '别名');
  assert.equal(state.version, 2);
});

test('兼容文本覆盖的旧字段可以继续编辑并打包', async t => {
  const root = await tempRoot(t, 'tcs-v2-compat-text-');
  const dir = await writeV1Project(root, '兼容旧字段');
  const loaded = await loadProject('兼容旧字段', root);
  const manifest = await writeAuthoring(dir, loaded.card, loaded.project);
  const roundtrip = await loadAuthoring(dir, manifest);
  assert.equal(roundtrip.card.depth_prompt.prompt, '旧深度提示', '根层深度提示按兼容文本保留');
  assert.equal(roundtrip.card.data.personality, '沉默寡言');

  const index = await readYAML(dir, 'src/index.yaml');
  const key = Object.keys(index.兼容文本).find(title => title.endsWith('depth_prompt'));
  assert.ok(key, '深度提示应登记在兼容文本里');
  assert.equal(index.兼容文本[key], 'src/text/depth_prompt.md');

  await writeText(dir, 'src/text/depth_prompt.md', '改过的深度提示');
  const reloaded = await loadProject('兼容旧字段', root);
  assert.equal(reloaded.card.depth_prompt.prompt, '改过的深度提示');
});

// ---------- JSON 与 PNG 往返 ----------

test('JSON 拆分后加载语义等价，可反复加载', async t => {
  const card = cardWithHelper();
  const { root, dir } = await splitJSON(t, card, '往返', 'tcs-v2-roundtrip-');
  const first = await loadProject('往返', root);
  assert.deepEqual(semanticDiff(card, first.card), []);
  const second = await loadProject('往返', root);
  assert.deepEqual(semanticDiff(first.card, second.card), []);
  assert.equal(await hasFile(dir, 'src/card.json'), false);
  assert.equal(first.project.source, 'src/index.yaml');
});

test('PNG 导入后保留卡内容与图像数据，重新打包不丢块', async t => {
  const root = await tempRoot(t, 'tcs-v2-png-');
  const card = baseCard();
  card.data.extensions = {
    regex_scripts: cardWithHelper().data.extensions.regex_scripts,
    tavern_helper: cardWithHelper().data.extensions.tavern_helper,
    unknown: { nested: [null, false, 0, { preserved: '陌生插件信息' }] },
  };
  card.data.alternate_greetings = ['', '第一行\r\n第二行'];
  const image = cardPNG('chara', card, [textChunk('Author', 'Original artist')]);
  const file = path.join(root, '输入.png');
  await fs.writeFile(file, image);

  const dir = await splitCard(file, { name: 'PNG往返', root });
  const loaded = await loadProject('PNG往返', root);
  assert.equal(Object.keys(loaded.project).includes('fields'), true, '加载结果仍带临时 fields');
  assert.deepEqual(semanticDiff(card, loaded.card), [], 'PNG 导入后语义等价');
  assert.equal(loaded.project.original.file, 'original/input.png');
  assert.equal(await hasFile(dir, 'src/card.json'), false);
  assert.equal(await hasFile(dir, 'src/assets/avatar.png'), true);

  const rebuilt = writeCardPNG(await fs.readFile(path.join(dir, 'original', 'input.png')), loaded.card);
  assert.deepEqual(readCardPNG(rebuilt).card, loaded.card);
  const imageBytes = await fs.readFile(file);
  for (const type of ['IDAT']) {
    assert.deepEqual(
      chunkData(rebuilt, type),
      chunkData(imageBytes, type),
      '图像数据块 ' + type + ' 应逐字节保留',
    );
  }
  assert.equal(textKeywordValue(rebuilt, 'author'), 'Original artist', '无关 tEXt 块保留');
});

function chunkData(bytes, type) {
  return parseChunks(bytes).find(chunkItem => chunkItem.type === type).data;
}
function parseChunks(bytes) {
  const result = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('latin1');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    result.push({ type, data });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return result;
}
function textKeywordValue(bytes, keyword) {
  for (const item of parseChunks(bytes)) {
    if (item.type !== 'tEXt') continue;
    const split = item.data.indexOf(0);
    if (item.data.subarray(0, split).toString('latin1').toLowerCase() !== keyword) continue;
    return item.data.subarray(split + 1).toString('latin1');
  }
  return undefined;
}

// ---------- 错误路径 ----------

test('非法键、重复关联、重复文件、越界与 state 篡改被拒绝', async t => {
  const card = cardWithHelper();
  card.data.character_book = { name: '防御世界书', entries: [{ id: 0, keys: ['甲'], comment: '甲', content: '甲正文', extensions: { position: 0, depth: 4, role: 0 } }] };
  const { root, dir } = await splitJSON(t, card, '防御', 'tcs-v2-guard-');
  const indexPath = 'src/index.yaml';
  const baseline = await readText(dir, indexPath);
  const baselineProject = await readText(dir, 'project.json');
  const baselineState = await readText(dir, '.card/state.json');
  const editFiles = {};
  for (const file of (await readYAML(dir, indexPath)).世界书.条目) editFiles[file] = await readText(dir, file);
  const restore = async () => {
    await writeText(dir, indexPath, baseline);
    await writeText(dir, 'project.json', baselineProject);
    await writeText(dir, '.card/state.json', baselineState);
    for (const [file, content] of Object.entries(editFiles)) await writeText(dir, file, content);
  };

  const index = await readYAML(dir, indexPath);
  const regexFile = index.正则[0];
  const worldbookFiles = index.世界书.条目;

  const expectReject = async (mutate, expected, label) => {
    await restore();
    const next = await readYAML(dir, indexPath);
    await mutate(next);
    await writeYAML(dir, indexPath, next);
    await assert.rejects(() => loadProject('防御', root), expected, label);
  };

  await expectReject(async next => { next.意外顶层 = 1; }, /未知设置/);

  await expectReject(async next => { next.文本.不存在 = 'src/text/first_mes.md'; }, /未知设置/);

  const firstConfig = await readYAML(dir, regexFile);
  await writeYAML(dir, regexFile, { ...firstConfig, 未知设置: true });
  await assert.rejects(() => loadProject('防御', root), /未知设置/);
  await writeYAML(dir, regexFile, firstConfig);

  // 关联跟着条目文件走：把两份配置对调后仍各自读取自己的原件，加载成功。
  await restore();
  const swapped = await readYAML(dir, indexPath);
  const swappedA = await readYAML(dir, swapped.正则[0]);
  const swappedB = await readYAML(dir, swapped.正则[1]);
  await writeYAML(dir, swapped.正则[0], swappedB);
  await writeYAML(dir, swapped.正则[1], swappedA);
  const swappedLoaded = await loadProject('防御', root);
  assert.deepEqual(swappedLoaded.card.data.extensions.regex_scripts.map(regex => regex.scriptName), ['显示备注', '[隐藏]变量更新'], '条目顺序由索引决定');
  assert.deepEqual(swappedLoaded.card.data.extensions.regex_scripts.map(regex => regex.replaceString), ['隐藏二的替换', '隐藏一的替换'], '正文与关联跟着各自的配置文件');

  // 世界书条目的 关联 指向正则记录：类型不匹配必须被拒绝。
  await expectReject(async next => {
    const regexKey = (await readYAML(dir, next.正则[0])).关联;
    const file = 'src/worldbook/错关联.yaml';
    await writeYAML(dir, file, { 名称: '错关联', 关联: regexKey, 文件: 'src/worldbook/错关联.md' });
    await writeText(dir, 'src/worldbook/错关联.md', '错');
    next.世界书.条目 = [worldbookFiles[0], file];
  }, /未知或不匹配的关联/);
  // 两条世界书 YAML 写同一个 关联：重复必须被拒绝。
  const duplicatedKey = 'src/worldbook/重复关联.yaml';
  await expectReject(async next => {
    const firstConfig2 = await readYAML(dir, next.世界书.条目[0]);
    await writeYAML(dir, duplicatedKey, { 名称: '重复关联', 关联: firstConfig2.关联, 文件: 'src/worldbook/重复关联.md' });
    await writeText(dir, 'src/worldbook/重复关联.md', '重复');
    next.世界书.条目 = [worldbookFiles[0], duplicatedKey];
  }, /重复或无效关联/);
  await restore();
  await loadProject('防御', root);

  await expectReject(async next => {
    const duplicated = 'src/worldbook/重复引用.yaml';
    const first = await readYAML(dir, next.世界书.条目[0]);
    await writeYAML(dir, duplicated, { 名称: '重复', 文件: first.文件 });
    next.世界书.条目 = [next.世界书.条目[0], duplicated];
  }, /重复源文件引用/);

  await expectReject(async next => {
    const first = await readYAML(dir, next.世界书.条目[0]);
    first.文件 = '../外面.md';
    await writeYAML(dir, next.世界书.条目[0], first);
  }, /路径越界|必须使用项目内相对路径|必须放在 src\//);
  await expectReject(async next => {
    const first = await readYAML(dir, next.世界书.条目[0]);
    first.文件 = 'src/../../外面.md';
    await writeYAML(dir, next.世界书.条目[0], first);
  }, /路径越界|必须使用项目内相对路径|必须放在 src\//);
  // 起点写成 src/ 但真实路径落在 src/ 之外：必须拒绝。
  await writeText(dir, '外面.md', '越界');
  await expectReject(async next => {
    const first = await readYAML(dir, next.世界书.条目[0]);
    first.文件 = 'src/../外面.md';
    await writeYAML(dir, next.世界书.条目[0], first);
  }, /源文件路径越界/);

  await expectReject(async next => {
    const first = await readYAML(dir, next.世界书.条目[0]);
    first.文件 = 'D:/外面.md';
    await writeYAML(dir, next.世界书.条目[0], first);
  }, /路径越界|必须使用项目内相对路径|必须放在 src\//);

  await restore();
  const tampered = JSON.parse(baselineState);
  tampered.card.data.first_mes = '被改过的正文';
  tampered.records = {};
  await writeText(dir, '.card/state.json', jsonText(tampered));
  await assert.rejects(() => loadProject('防御', root), /兼容数据校验失败/);
  await restore();
  await loadProject('防御', root);

  const state = JSON.parse(baselineState);
  state.card.data.extensions['第三方'] = { keep: true };
  const bytes = jsonText(state);
  const project = JSON.parse(baselineProject);
  project.state.sha256 = sha256(Buffer.from(bytes));
  await writeText(dir, '.card/state.json', bytes);
  await writeText(dir, 'project.json', jsonText(project));
  const loaded = await loadProject('防御', root);
  assert.deepEqual(loaded.card.data.extensions['第三方'], { keep: true }, 'state 由工具维护，同步哈希后才生效');
  await restore();

  const outside = path.join(root, '外面.md');
  await write(outside, '外面');
  await restore();
  const link = path.join(dir, 'src', '链接.md');
  let linked = true;
  try { await fs.symlink(outside, link, 'file'); } catch { linked = false; }
  if (linked) {
    const linkedIndex = await readYAML(dir, indexPath);
    const first = await readYAML(dir, linkedIndex.世界书.条目[0]);
    first.文件 = 'src/链接.md';
    await writeYAML(dir, linkedIndex.世界书.条目[0], first);
    await assert.rejects(() => loadProject('防御', root), /符号链接指向项目外/);
  }
  await restore();
  await loadProject('防御', root);
});

test('循环与自引用脚本文件夹被拒绝且不无限递归', async t => {
  const card = baseCard();
  card.data.extensions.tavern_helper = { scripts: [], variables: {} };
  const { root, dir } = await splitJSON(t, card, '循环', 'tcs-v2-cycle-');

  const folderFile = 'src/scripts/001-文件夹.yaml';
  await writeYAML(dir, folderFile, { 名称: '文件夹', 类型: '文件夹', 脚本: [folderFile] });
  const index = await readYAML(dir, 'src/index.yaml');
  index.脚本 = [folderFile];
  await writeYAML(dir, 'src/index.yaml', index);

  await assert.rejects(() => loadProject('循环', root), /重复源文件引用或循环引用/);
});

// ---------- 迁移 ----------

// v1 工程：字段在 src/card.json 里留空，正文来自被拆分的文件。
function v1Card() {
  const card = baseCard();
  delete card.description;
  delete card.creatorcomment;
  const data = card.data;
  for (const key of ['creator_notes', 'system_prompt', 'post_history_instructions']) delete data[key];
  data.description = '';
  data.name = '';
  data.first_mes = '';
  data.personality = '';
  data.scenario = '';
  data.mes_example = '';
  data.alternate_greetings = [''];
  data.group_only_greetings = [''];
  card.depth_prompt = { prompt: '', depth: 4 };
  return card;
}
function v1Project(name) {
  return {
    schemaVersion: 1,
    name,
    modules: ['worldbook'],
    fields: [
      { pointer: '/data/name', file: 'src/text/name.md' },
      { pointer: '/data/description', file: 'src/text/description.md' },
      { pointer: '/data/personality', file: 'src/text/personality.md' },
      { pointer: '/data/scenario', file: 'src/text/scenario.md' },
      { pointer: '/data/first_mes', file: 'src/text/first_mes.md' },
      { pointer: '/data/mes_example', file: 'src/text/mes_example.md' },
      { pointer: '/data/alternate_greetings/0', file: 'src/greetings/alt-1.md' },
      { pointer: '/data/group_only_greetings/0', file: 'src/greetings/group-1.md' },
      { pointer: '/depth_prompt/prompt', file: 'src/text/depth_prompt.md' },
    ],
    avatar: null,
    builds: [{ kind: 'script', pointer: '/data/first_mes', entry: 'src/text/first_mes.md' }],
    dependencies: [],
    runtimeVerified: null,
    original: { baseline: 'original/card.json', baselineSha256: '0'.repeat(64) },
  };
}
async function writeV1Project(root, name) {
  const dir = path.join(root, 'cards', name);
  const card = v1Card();
  const project = v1Project(name);
  await writeJSON(path.join(dir, 'src/card.json'), card);
  await write(path.join(dir, 'src/text/name.md'), '雨夜旅人');
  await write(path.join(dir, 'src/text/description.md'), '她站在雨里。');
  await write(path.join(dir, 'src/text/personality.md'), '沉默寡言');
  await write(path.join(dir, 'src/text/scenario.md'), '雨夜的车站');
  await write(path.join(dir, 'src/text/first_mes.md'), '「你来了。」');
  await write(path.join(dir, 'src/text/mes_example.md'), '示例对话');
  await write(path.join(dir, 'src/greetings/alt-1.md'), '备选一');
  await write(path.join(dir, 'src/greetings/group-1.md'), '群聊一');
  await write(path.join(dir, 'src/text/depth_prompt.md'), '旧深度提示');
  const baseline = jsonText(card);
  await write(path.join(dir, 'original/card.json'), baseline);
  project.original.baselineSha256 = sha256(Buffer.from(baseline));
  await writeJSON(path.join(dir, 'project.json'), project);
  await write(path.join(dir, '创作说明.md'), '# 创作说明\n');
  await writeJSON(path.join(dir, 'tests/regex.json'), []);
  return dir;
}

test('v1 手写工程可加载，writeAuthoring 直接生成 v2', async t => {
  const root = await tempRoot(t, 'tcs-v2-authoring-');
  const dir = await writeV1Project(root, '手写旧工程');
  const loaded = await loadProject('手写旧工程', root);
  assert.equal(loaded.card.data.first_mes, '「你来了。」');
  assert.equal(loaded.project.schemaVersion, 1);

  const manifest = await writeAuthoring(dir, loaded.card, loaded.project);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.source, 'src/index.yaml');
  assert.equal(await hasFile(dir, 'src/card.json'), false);
  const roundtrip = await loadAuthoring(dir, manifest);
  assert.equal(roundtrip.card.data.description, '她站在雨里。');
  assert.equal(roundtrip.card.data.first_mes, '「你来了。」');
  assert.deepEqual(roundtrip.card.data.alternate_greetings, ['备选一']);
  assert.deepEqual(roundtrip.project.builds, loaded.project.builds, 'v1 的构建项应原样保留');
  assert.deepEqual(roundtrip.card, loaded.card);
  assert.equal(roundtrip.project.fields.some(field => field.pointer === '/data/first_mes'), true);
});

test('旧版工程迁移到 v2 并保留编辑内容与原件快照', async t => {
  const root = await tempRoot(t, 'tcs-v2-migrate-');
  const dir = await writeV1Project(root, '旧工程');
  const before = await readText(dir, 'src/card.json');

  const result = await migrateProject('旧工程', root);
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(result.source, 'src/index.yaml');

  const project = await readJSONProject(dir);
  assert.equal(project.schemaVersion, 2);
  assert.equal(project.source, 'src/index.yaml');
  assert.equal(project.state.file, '.card/state.json');
  const loaded = await loadProject('旧工程', root);
  assert.equal(loaded.card.data.name, '雨夜旅人');
  assert.equal(loaded.card.data.description, '她站在雨里。');
  assert.equal(loaded.card.data.personality, '沉默寡言');
  assert.equal(loaded.card.data.first_mes, '「你来了。」');
  assert.deepEqual(loaded.card.data.alternate_greetings, ['备选一']);
  assert.deepEqual(loaded.card.data.group_only_greetings, ['群聊一']);
  assert.equal(loaded.card.depth_prompt.prompt, '旧深度提示');
  assert.deepEqual(loaded.project.builds, [{ kind: 'script', entry: 'src/text/first_mes.md', pointer: '/data/first_mes' }], '迁移保留构建绑定');
  assert.equal(await hasFile(dir, 'src/card.json'), false);
  assert.equal(await readText(dir, '.card/migration-v1/src-card.json'), before, '迁移前快照保留');
  assert.equal(await hasFile(dir, '.card/migration-v1/project.json'), true);
});

test('迁移保真校验失败时原工程不变且不留临时目录', async t => {
  const root = await tempRoot(t, 'tcs-v2-migrate-fail-');
  const dir = await writeV1Project(root, '坏工程');
  const project = await readJSONProject(dir);
  project.fields.push({ pointer: '/data/personality', file: 'src/text/description.md' });
  await writeJSON(path.join(dir, 'project.json'), project);
  const beforeProject = await readText(dir, 'project.json');
  const beforeCard = await readText(dir, 'src/card.json');

  await assert.rejects(() => migrateProject('坏工程', root), /重复字段映射|重复源文件映射/);
  assert.equal(await readText(dir, 'project.json'), beforeProject, '失败时原工程未改动');
  assert.equal(await readText(dir, 'src/card.json'), beforeCard);
  assert.equal(await hasFile(dir, 'src/index.yaml'), false, '失败时不应留下 v2 入口');
  const leftovers = (await fs.readdir(path.join(root, 'cards'))).filter(entry => entry.startsWith('.tmp-'));
  assert.deepEqual(leftovers, [], '失败时不留临时目录');
});

// ---------- 旧 v1 未拆分内容的自动补全 ----------

// 含大块脚本数据的卡，用于 数据文件 拆分。
function largeDataCard() {
  const card = baseCard();
  card.data.extensions.tavern_helper = {
    scripts: [{
      type: 'script', enabled: true, name: '旧脚本', id: 'old-1', content: 'console.info("旧脚本");', info: '', button: { enabled: false, buttons: [] }, data: { 记录: 'x'.repeat(2500) }, export_with: { data: true, button: false },
    }],
    variables: {},
  };
  return card;
}

// 手写旧 v1 工程：所有已知文本都没登记在 fields 里，正文只留在 src/card.json。
async function writePartialV1Project(root, name) {
  const dir = path.join(root, 'cards', name);
  const card = baseCard();
  card.data.name = '';
  const project = v1Project(name);
  project.fields = [{ pointer: '/data/name', file: 'src/text/name.md' }];
  project.builds = [];
  await writeJSON(path.join(dir, 'src/card.json'), card);
  await write(path.join(dir, 'src/text/name.md'), '雨夜旅人');
  await write(path.join(dir, 'src/greetings/alt-1.md'), '备选一');
  await write(path.join(dir, 'src/greetings/group-1.md'), '群聊一');
  const baseline = jsonText(card);
  await write(path.join(dir, 'original/card.json'), baseline);
  project.original = { baseline: 'original/card.json', baselineSha256: sha256(Buffer.from(baseline)) };
  await writeJSON(path.join(dir, 'project.json'), project);
  await write(path.join(dir, '创作说明.md'), '# 创作说明\n');
  await writeJSON(path.join(dir, 'tests/regex.json'), []);
  return { dir, card };
}

test('旧 v1 的未拆分文本与开场白由 writeAuthoring 自动补全', async t => {
  const root = await tempRoot(t, 'tcs-v2-autofill-');
  const { dir, card } = await writePartialV1Project(root, '旧未拆分');
  const loadedV1 = await loadProject('旧未拆分', root);
  const manifest = await writeAuthoring(dir, loadedV1.card, loadedV1.project);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(await hasFile(dir, 'src/card.json'), false);

  assert.equal(await readText(dir, 'src/text/first_mes.md'), '「你来了。」');
  assert.equal(await readText(dir, 'src/text/description.md'), '她站在雨里。');
  assert.equal(await readText(dir, 'src/greetings/alternate_greetings-1.md'), '备选一');
  const roundtrip = await loadAuthoring(dir, manifest);
  assert.deepEqual(roundtrip.card.data.alternate_greetings, ['备选一', '备选二'], '未拆分开场白全部自动补全');

  const index = await readYAML(dir, 'src/index.yaml');
  assert.equal(index.文本['角色描述'], 'src/text/description.md');
  assert.equal(index.文本['性格'], 'src/text/personality.md');
  assert.equal(index.文本['场景'], 'src/text/scenario.md');
  assert.equal(index.文本['第一条消息'], 'src/text/first_mes.md');
  assert.equal(index.文本['对话示例'], 'src/text/mes_example.md');
  assert.deepEqual(index.备选开场白, ['src/greetings/alternate_greetings-1.md', 'src/greetings/alternate_greetings-2.md']);
  assert.deepEqual(index.群聊开场白, ['src/greetings/group_only_greetings-1.md']);

  assert.equal(roundtrip.card.data.name, '雨夜旅人');
  assert.equal(roundtrip.card.data.description, '她站在雨里。');
  assert.equal(roundtrip.card.data.personality, '沉默寡言');
  assert.equal(roundtrip.card.data.scenario, '雨夜的车站');
  assert.equal(roundtrip.card.data.first_mes, '「你来了。」');
  assert.equal(roundtrip.card.data.mes_example, card.data.mes_example);
  assert.deepEqual(roundtrip.card.data.group_only_greetings, ['群聊一']);
  assert.deepEqual(semanticDiff(loadedV1.card, roundtrip.card), [], '整卡保真');
});

test('文本、开场白与兼容文本支持 {文件,构建} 引用', async t => {
  const card = cardWithHelper();
  card.data.character_book = { name: '构建文本世界书', entries: [{ id: 0, keys: [], comment: '甲', content: '甲正文', extensions: { position: 0 } }] };
  const { root, dir } = await splitJSON(t, card, '文本构建', 'tcs-v2-textbuild-');
  const index = await readYAML(dir, 'src/index.yaml');

  const firstMes = index.文本['第一条消息'];
  await writeText(dir, 'src/ui/first/app.js', 'console.info("开场构建");');
  index.文本['第一条消息'] = { 文件: firstMes, 构建: { 类型: 'script', 入口: 'src/ui/first/app.js' } };
  const greeting = index.备选开场白[0];
  await writeText(dir, 'src/ui/greet/app.js', 'console.info("开场白构建");');
  index.备选开场白[0] = { 文件: greeting, 构建: { 类型: 'script', 入口: 'src/ui/greet/app.js' } };
  const compatKey = Object.keys(index.兼容文本)[0];
  const compatFile = index.兼容文本[compatKey];
  await writeText(dir, 'src/ui/compat/app.js', 'console.info("兼容构建");');
  index.兼容文本[compatKey] = { 文件: compatFile, 构建: { 类型: 'script', 入口: 'src/ui/compat/app.js' } };
  await writeYAML(dir, 'src/index.yaml', index);

  const loaded = await loadProject('文本构建', root);
  const builds = loaded.project.builds;
  assert.deepEqual(builds.find(build => build.pointer === '/data/first_mes'), { kind: 'script', entry: 'src/ui/first/app.js', pointer: '/data/first_mes' });
  assert.deepEqual(builds.find(build => build.pointer === '/data/alternate_greetings/0'), { kind: 'script', entry: 'src/ui/greet/app.js', pointer: '/data/alternate_greetings/0' });
  assert.deepEqual(builds.find(build => build.entry === 'src/ui/compat/app.js'), { kind: 'script', entry: 'src/ui/compat/app.js', pointer: loaded.project.fields.find(field => field.file === compatFile).pointer });
  assert.equal(await readText(dir, firstMes), card.data.first_mes);
});

test('大量脚本数据拆到 .data.yaml 并可重新加载', async t => {
  const { root, dir } = await splitJSON(t, largeDataCard(), '大数据', 'tcs-v2-data-');
  assert.equal(await hasFile(dir, 'src/scripts/001-旧脚本.data.yaml'), true, '大块数据单独成文件');
  const loaded = await loadProject('大数据', root);
  const script = loaded.card.data.extensions.tavern_helper.scripts[0];
  assert.equal(script.name, '旧脚本');
  assert.equal(script.data.记录, 'x'.repeat(2500));

  const index = await readYAML(dir, 'src/index.yaml');
  const scriptFile = index.脚本[0];
  const config = await readYAML(dir, scriptFile);
  assert.equal(config.数据, undefined, '大块数据不再内联在条目 YAML');
  assert.match(config.数据文件, /\.data\.yaml$/, '大数据落到 数据文件');
  const dataFile = await readYAML(dir, config.数据文件);
  assert.equal(dataFile.记录, 'x'.repeat(2500));
});

test('设置类型检查拒绝新值，导入的异常原值保持保真', async t => {
  const card = baseCard();
  card.data.character_book = {
    name: '类型检查',
    entries: [{
      id: 0, keys: ['甲'], secondary_keys: [], comment: '甲', content: '甲正文', enabled: true, constant: false, selective: true,
      insertion_order: 3, position: 'before_char', use_regex: false,
      extensions: { position: 0, depth: 2, role: 0, probability: 100, useProbability: true, selectiveLogic: 99, 导入异常: { keep: true } },
    }],
  };
  const { root, dir } = await splitJSON(t, card, '类型检查', 'tcs-v2-settings-');
  const loaded = await loadProject('类型检查', root);
  assert.deepEqual(loaded.card.data.character_book.entries[0].extensions['导入异常'], { keep: true }, '未知扩展原值保留');
  assert.equal(loaded.card.data.character_book.entries[0].extensions.selectiveLogic, 99);

  const index = await readYAML(dir, 'src/index.yaml');
  const worldbookFile = index.世界书.条目[0];
  const config = await readYAML(dir, worldbookFile);
  const baseline = await readText(dir, worldbookFile);

  config.启用 = 'yes';
  await writeYAML(dir, worldbookFile, config);
  await assert.rejects(() => loadProject('类型检查', root), /启用 必须是 true\/false/);

  config.启用 = true;
  config.关键词 = '甲';
  await writeYAML(dir, worldbookFile, config);
  await assert.rejects(() => loadProject('类型检查', root), /关键词 必须是文本列表/);

  config.关键词 = ['甲'];
  config.顺序 = 3.5;
  await writeYAML(dir, worldbookFile, config);
  await assert.rejects(() => loadProject('类型检查', root), /顺序 必须是整数或 null/);

  await writeText(dir, worldbookFile, baseline);
  const restored = await loadProject('类型检查', root);
  assert.deepEqual(semanticDiff(card, restored.card), [], '恢复原值后仍逐字保真');
});

+
// ---------- helper 脚本列表识别与必需索引 ----------

test('helperScriptLists 只识别 helper 顶层脚本列表', () => {
  const pointer = '/data/extensions/tavern_helper';
  assert.deepEqual(helperScriptLists({ scripts: [] }, pointer), [{ list: [], pointer: pointer + '/scripts' }]);
  const direct = [{ type: 'script', name: 'a' }, { type: 'folder', name: 'b' }];
  assert.deepEqual(helperScriptLists(direct, pointer), [{ list: direct, pointer }]);
  const tupleList = [['scripts', [{ type: 'script', name: '旧' }]]];
  assert.deepEqual(helperScriptLists(tupleList, pointer), [{ list: tupleList[0][1], pointer: pointer + '/0/1' }]);
  assert.deepEqual(helperScriptLists({ scripts: [{ type: 'script', name: 'a' }], variables: { 数据: [{ type: 'script', name: '误判' }] } }, pointer).length, 1, 'variables 里的脚本形状不另算一组');
  assert.deepEqual(helperScriptLists(null, pointer), []);
  assert.deepEqual(helperScriptLists({ variables: {} }, pointer), []);
  assert.deepEqual(helperScriptLists([{ 名称: '不是脚本' }], pointer), []);
});

test('extractFields 不把 variables 与脚本 data 里的脚本形状当脚本拆分', async t => {
  const card = baseCard();
  card.data.extensions.tavern_helper = {
    scripts: [{
      type: 'script', enabled: true, name: '真脚本', id: 'real', content: 'console.info("真");', info: '', button: { enabled: false, buttons: [] },
      data: { 嵌套: [{ type: 'script', name: '数据里的假脚本', id: 'fake', content: '不应拆分' }] },
      export_with: { data: true, button: false },
    }],
    variables: { 记录: [{ type: 'script', name: '变量里的假脚本', id: 'fake2', content: '不应拆分' }] },
  };
  const { root, dir } = await splitJSON(t, card, '识别', 'tcs-v2-helper-');
  const loaded = await loadProject('识别', root);
  assert.deepEqual(semanticDiff(card, loaded.card), [], '假脚本原样留在 data / variables');
  assert.equal(await hasFile(dir, 'src/scripts/001-真脚本.js'), true);
  const scriptFields = loaded.project.fields.filter(field => field.pointer.endsWith('/content'));
  assert.deepEqual(scriptFields.map(field => field.pointer), ['/data/extensions/tavern_helper/scripts/0/content']);
  const index = await readYAML(dir, 'src/index.yaml');
  assert.equal(index.脚本.length, 1);
  const state = JSON.parse(await readText(dir, '.card/state.json'));
  assert.deepEqual(state.card.data.extensions.tavern_helper.scripts[0].data.嵌套[0].content, '不应拆分');
  assert.deepEqual(state.card.data.extensions.tavern_helper.variables.记录[0].content, '不应拆分');
});

test('必需索引区段缺失或未清空时被拒绝', async t => {
  const { root, dir } = await splitJSON(t, baseCard(), '必需区段', 'tcs-v2-required-');
  const baseline = await readText(dir, 'src/index.yaml');
  const restore = () => writeText(dir, 'src/index.yaml', baseline);
  const expectReject = async (mutate, expected) => {
    await restore();
    const index = await readYAML(dir, 'src/index.yaml');
    await mutate(index);
    await writeYAML(dir, 'src/index.yaml', index);
    await assert.rejects(() => loadProject('必需区段', root), expected);
  };

  await expectReject(index => { delete index.角色; }, /缺少 角色/);
  await expectReject(index => { delete index.文本; }, /缺少 文本/);
  await expectReject(index => { delete index.备选开场白; }, /缺少 备选开场白/);
  await expectReject(index => { delete index.群聊开场白; }, /缺少 群聊开场白/);
  await expectReject(index => { delete index.正则; }, /缺少 正则/);
  await expectReject(index => { delete index.脚本; }, /缺少 脚本/);
  await expectReject(index => { delete index.世界书.条目; }, /世界书缺少条目列表/);
  await restore();

  const index = await readYAML(dir, 'src/index.yaml');
  index.文本 = {};
  index.备选开场白 = [];
  index.群聊开场白 = [];
  index.世界书 = { 条目: [] };
  index.正则 = [];
  index.脚本 = [];
  await writeYAML(dir, 'src/index.yaml', index);
  const loaded = await loadProject('必需区段', root);
  assert.ok(Array.isArray(loaded.card.data.alternate_greetings) || loaded.card.data.alternate_greetings === undefined);
  assert.ok(Array.isArray(loaded.card.data.group_only_greetings) || loaded.card.data.group_only_greetings === undefined);
  assert.ok(loaded.card.data.extensions.regex_scripts === undefined || Array.isArray(loaded.card.data.extensions.regex_scripts));
  const kept = await readYAML(dir, 'src/index.yaml');
  for (const section of ['角色', '文本', '备选开场白', '群聊开场白', '世界书', '正则', '脚本']) assert.ok(section in kept, section + ' 区段保留');
  assert.deepEqual(kept.世界书.条目, []);
});

test('文件夹脚本缺少脚本列表会被拒绝', async t => {
  const card = baseCard();
  card.data.extensions.tavern_helper = { scripts: [{ type: 'folder', enabled: true, name: '空文件夹', id: 'f0', scripts: [] }], variables: {} };
  const { root, dir } = await splitJSON(t, card, '空文件夹', 'tcs-v2-folder-');
  const index = await readYAML(dir, 'src/index.yaml');
  const folderFile = index.脚本[0];
  const config = await readYAML(dir, folderFile);
  delete config.脚本;
  await writeYAML(dir, folderFile, config);
  await assert.rejects(() => loadProject('空文件夹', root), /缺少脚本列表/);
});

// ---------- 关联丢失后的自动找回 ----------

test('缺 关联 但原路径能对上时自动找回未知字段与原 ID', async t => {
  const card = cardWithHelper();
  card.data.character_book = { name: '找回世界书', entries: [{ id: 0, keys: ['书店'], comment: '旧书店', content: '旧书店正文', extensions: { position: 0, depth: 4, role: 0 } }] };
  const { root, dir } = await splitJSON(t, card, '找回', 'tcs-v2-recover-');
  const index = await readYAML(dir, 'src/index.yaml');
  const worldbookFile = index.世界书.条目[0];
  const worldbookBody = '旧书店正文';
  const worldbookConfig = await readYAML(dir, worldbookFile);
  const worldbookKey = worldbookConfig.关联;
  await writeText(dir, worldbookConfig.文件, worldbookBody);
  delete worldbookConfig.关联;
  await writeYAML(dir, worldbookFile, worldbookConfig);

  const scriptEntry = await findScriptEntry(dir, index, '顶层脚本');
  assert.ok(scriptEntry, '顶层脚本条目应存在');
  const scriptKey = scriptEntry.config.关联;
  const scriptBody = 'console.info("顶层");';
  await writeText(dir, scriptEntry.config.文件, scriptBody);
  delete scriptEntry.config.关联;
  await writeYAML(dir, scriptEntry.file, scriptEntry.config);

  const state = JSON.parse(await readText(dir, '.card/state.json'));
  const originalEntry = state.records[worldbookKey].base;
  const originalScript = state.records[scriptKey].base;
  assert.equal(originalEntry.content, worldbookBody);
  assert.equal(originalScript.content, scriptBody);

  const loaded = await loadProject('找回', root);
  const byName = loaded.card.data.extensions.tavern_helper.scripts;
  const recovered = {
    folder: byName.find(script => script.name === '变量'),
    top: byName.find(script => script.name === '顶层脚本'),
  };
  assert.deepEqual(recovered.folder, card.data.extensions.tavern_helper.scripts[0], '未知字段随关联找回');
  const sourceTop = card.data.extensions.tavern_helper.scripts.find(script => script.name === '顶层脚本');
  const expectedTop = structuredClone(sourceTop);
  expectedTop.id = originalScript.id;
  assert.deepEqual(recovered.top, expectedTop, '顶层脚本按原 ID 找回，顺序由索引决定');
  assert.equal(loaded.card.data.character_book.entries[0].id, originalEntry.id, '原 ID 沿用');
  assert.deepEqual(loaded.unreferenced, [], '所有记录都被索引引用');
});

test('改名或新增文件没有关联时按新条目处理，旧条目进入 unreferenced', async t => {
  const card = cardWithHelper();
  const { root, dir } = await splitJSON(t, card, '改名', 'tcs-v2-rename-');
  const index = await readYAML(dir, 'src/index.yaml');
  const scriptEntry = await findScriptEntry(dir, index, '顶层脚本');
  assert.ok(scriptEntry, '顶层脚本条目应存在');
  const state = JSON.parse(await readText(dir, '.card/state.json'));
  const originalKey = scriptEntry.config.关联;
  const originalScript = state.records[originalKey].base;
  const renamed = 'src/scripts/005-改名脚本.yaml';
  delete scriptEntry.config.关联;
  await writeYAML(dir, renamed, { ...scriptEntry.config, 名称: '改名脚本' });
  await writeText(dir, 'src/scripts/005-改名脚本.js', originalScript.content);
  index.脚本 = index.脚本.map(file => (file === scriptEntry.file ? renamed : file));
  await writeYAML(dir, 'src/index.yaml', index);

  const loaded = await loadProject('改名', root);
  const scripts = loaded.card.data.extensions.tavern_helper.scripts;
  const scriptAt = index.脚本.indexOf(renamed);
  const renamedScript = scripts[scriptAt];
  assert.equal(renamedScript.name, '改名脚本');
  assert.notEqual(renamedScript.id, originalScript.id, '新文件不冒充旧条目');
  assert.match(renamedScript.id, /^[a-f0-9]{32}$/, '按新条目生成稳定 ID');
  assert.deepEqual(renamedScript.data, {}, '旧条目的 data 不跟着新文件走');
  assert.equal(loaded.unreferenced.length, 1);
  assert.equal(loaded.unreferenced[0].association, originalKey);
  assert.equal(loaded.unreferenced[0].name, '顶层脚本');
});

// ---------- 源文件范围与配置路径避让 ----------

test('源文件必须解析到 src/ 内，src/../original 被拒绝', async t => {
  const card = cardWithHelper();
  card.data.character_book = { name: '源范围世界书', entries: [{ id: 0, keys: ['书店'], comment: '旧书店', content: '旧书店正文', extensions: { position: 0, depth: 4, role: 0 } }] };
  const { root, dir } = await splitJSON(t, card, '源范围', 'tcs-v2-srcscope-');
  await writeText(dir, 'original/外面.md', '外面');
  const index = await readYAML(dir, 'src/index.yaml');
  const first = await readYAML(dir, index.世界书.条目[0]);
  first.文件 = 'src/../original/外面.md';
  await writeYAML(dir, index.世界书.条目[0], first);
  await assert.rejects(() => loadProject('源范围', root), /源文件路径越界/);

  first.文件 = 'src/worldbook/001-旧书店.md';
  await writeYAML(dir, index.世界书.条目[0], first);
  const restored = await loadProject('源范围', root);
  assert.deepEqual(restored.card.data.character_book.entries.map(entry => entry.comment), ['旧书店']);
});

test('配置 YAML 避让同 stem 与无扩展名正文，不覆盖已有文件', async t => {
  const root = await tempRoot(t, 'tcs-v2-avoid-');
  const dir = path.join(root, 'cards', '路径避让');
  await fs.mkdir(path.dirname(dir), { recursive: true });
  const card = {
    spec: 'chara_card_v2', spec_version: '2.0',
    data: { name: '路径避让', first_mes: '你好', extensions: { tavern_helper: { scripts: [], variables: {} } } },
  };
  await writeJSON(path.join(dir, 'src/card.json'), card);
  await write(path.join(dir, 'original/card.json'), jsonText(card));
  await write(path.join(dir, 'project.json'), jsonText({ schemaVersion: 1, name: '路径避让', modules: [], fields: [], builds: [], dependencies: [], runtimeVerified: null, original: { baseline: 'original/card.json', baselineSha256: sha256(Buffer.from(jsonText(card))) } }));
  await write(path.join(dir, '创作说明.md'), '# 创作说明\n');
  await writeJSON(path.join(dir, 'tests/regex.json'), []);
  // 世界书正文与 001-甲.yaml 同 stem；脚本正文没有扩展名。
  await write(path.join(dir, 'src/worldbook/001-甲.md'), '甲正文');
  await write(path.join(dir, 'src/scripts/raw-script'), 'console.info("裸脚本");');
  const card2 = structuredClone(card);
  card2.data.character_book = { name: '路径避让', entries: [{ id: 0, keys: [], comment: '甲', content: '甲正文', extensions: { position: 0 } }] };
  card2.data.extensions.tavern_helper.scripts = [{ type: 'script', enabled: true, name: '裸脚本', id: 'raw', content: 'console.info("裸脚本");', info: '', button: { enabled: false, buttons: [] }, data: {}, export_with: { data: true, button: false } }];
  const next = await writeAuthoring(dir, card2, { schemaVersion: 1, name: '路径避让', modules: [], fields: [], builds: [] });
  assert.equal(next.schemaVersion, 2);
  const index = await readYAML(dir, 'src/index.yaml');
  assert.notEqual(index.世界书.条目[0].replace(/\.yaml$/, ''), 'src/worldbook/001-甲.md', 'YAML 不能覆盖同 stem 正文');
  assert.notEqual(index.脚本[0].replace(/\.yaml$/, ''), 'src/scripts/raw-script', 'YAML 不能覆盖无扩展名正文');
  assert.equal(await readText(dir, 'src/worldbook/001-甲.md'), '甲正文', '正文保持不变');
  assert.equal(await readText(dir, 'src/scripts/raw-script'), 'console.info("裸脚本");');
});


test('正文扩展名非文本与非法 UTF-8 被拒绝', async t => {
  const card = cardWithHelper();
  card.data.character_book = { name: '正文检查', entries: [{ id: 0, keys: ['书店'], comment: '旧书店', content: '旧书店正文', extensions: { position: 0, depth: 4, role: 0 } }] };
  const { root, dir } = await splitJSON(t, card, '正文检查', 'tcs-v2-body-');
  const index = await readYAML(dir, 'src/index.yaml');
  const worldbookFile = index.世界书.条目[0];
  const worldbookConfig = await readYAML(dir, worldbookFile);
  await writeText(dir, 'src/worldbook/001-旧书店.png', 'not png');
  worldbookConfig.文件 = 'src/worldbook/001-旧书店.png';
  await writeYAML(dir, worldbookFile, worldbookConfig);
  await assert.rejects(() => loadProject('正文检查', root), /正文必须是文本文件/);

  worldbookConfig.文件 = 'src/worldbook/001-旧书店.md';
  await writeYAML(dir, worldbookFile, worldbookConfig);
  await fs.writeFile(path.join(dir, worldbookConfig.文件), Buffer.from([0xff, 0xfe, 0xfd]));
  await assert.rejects(() => loadProject('正文检查', root), /无法读取 UTF-8 正文/);
});

test('新改枚举必须有效，导入的异常枚举不改则保真', async t => {
  const card = baseCard();
  card.data.character_book = { name: '枚举检查', entries: [{
    id: 0, keys: ['甲'], comment: '甲', content: '甲正文', enabled: true, constant: false, selective: true, insertion_order: 3, position: 'before_char', use_regex: false,
    extensions: { position: 0, depth: 2, role: 0, selectiveLogic: 99 },
  }] };
  const { root, dir } = await splitJSON(t, card, '枚举检查', 'tcs-v2-enum-');
  const loaded = await loadProject('枚举检查', root);
  assert.equal(loaded.card.data.character_book.entries[0].extensions.selectiveLogic, 99, '导入的异常枚举原样保留');

  const index = await readYAML(dir, 'src/index.yaml');
  const worldbookFile = index.世界书.条目[0];
  const baseline = await readText(dir, worldbookFile);

  const config = await readYAML(dir, worldbookFile);
  config.位置 = '不存在的深度';
  await writeYAML(dir, worldbookFile, config);
  await assert.rejects(() => loadProject('枚举检查', root), /未知值/);

  await writeText(dir, worldbookFile, baseline);
  const config2 = await readYAML(dir, worldbookFile);
  config2.角色 = '不存在的角色';
  await writeYAML(dir, worldbookFile, config2);
  await assert.rejects(() => loadProject('枚举检查', root), /未知值/);

  await writeText(dir, worldbookFile, baseline);
  const config3 = await readYAML(dir, worldbookFile);
  config3.位置 = '指定深度';
  config3.角色 = '用户';
  await writeYAML(dir, worldbookFile, config3);
  const edited = await loadProject('枚举检查', root);
  const entry = edited.card.data.character_book.entries[0];
  assert.equal(entry.extensions.position, 4);
  assert.equal(entry.position, 'after_char');
  assert.equal(entry.extensions.role, 1);
});


test('脚本按钮、导出设置与数据的新值类型被拒绝，导入异常值不改则保真', async t => {
  const invalidCard = baseCard();
  invalidCard.data.extensions.tavern_helper = {
    scripts: [{
      type: 'script', enabled: null, name: '旧脚本', id: 'old-1', content: 'console.info("旧脚本");', info: '',
      button: { enabled: 'yes', buttons: [{ name: '重载', visible: 'true' }] },
      data: { a: 1 }, export_with: { data: 'yes', button: true },
    }],
    variables: {},
  };
  const invalidSplit = await splitJSON(t, invalidCard, '按钮保真', 'tcs-v2-script-fidelity-');
  const invalidLoaded = await loadProject('按钮保真', invalidSplit.root);
  const imported = invalidLoaded.card.data.extensions.tavern_helper.scripts[0];
  assert.equal(imported.enabled, null, '导入异常 启用 原样保真');
  assert.deepEqual(imported.button, { enabled: 'yes', buttons: [{ name: '重载', visible: 'true' }] }, '导入异常按钮原样保真');
  assert.deepEqual(imported.export_with, { data: 'yes', button: true }, '导入异常导出设置原样保真');
  assert.deepEqual(imported.data, { a: 1 });
  assert.deepEqual(semanticDiff(invalidCard, invalidLoaded.card), [], '未改动的异常值整卡保真');

  const card = baseCard();
  card.data.extensions.tavern_helper = {
    scripts: [{
      type: 'script', enabled: true, name: '新脚本', id: 'new-1', content: 'console.info("新脚本");', info: '',
      button: { enabled: true, buttons: [{ name: '重载', visible: true }] },
      data: { a: 1 }, export_with: { data: true, button: true },
    }],
    variables: {},
  };
  card.data.character_book = { name: '按钮检查', entries: [{ id: 0, keys: [], comment: '甲', content: '甲正文', extensions: { position: 0, depth: 4, role: 0 } }] };
  const { root, dir } = await splitJSON(t, card, '按钮检查', 'tcs-v2-script-check-');
  const index = await readYAML(dir, 'src/index.yaml');
  const worldbookFile = index.世界书.条目[0];
  const scriptEntry = await findScriptEntry(dir, index, '新脚本');
  assert.ok(scriptEntry, '脚本条目应存在');
  const baseline = await readText(dir, scriptEntry.file);

  const expectReject = async (mutate, expected, label) => {
    await writeText(dir, scriptEntry.file, baseline);
    const config = await readYAML(dir, scriptEntry.file);
    await mutate(config);
    await writeYAML(dir, scriptEntry.file, config);
    await assert.rejects(() => loadProject('按钮检查', root), expected, label);
  };

  await expectReject(config => { config.启用 = null; }, /启用 必须是 true\/false/, '启用 null 拒绝');
  await expectReject(config => { config.按钮 = { enabled: 'yes', buttons: [] }; }, /按钮应包含布尔 enabled/, '按钮 enabled 非 bool');
  await expectReject(config => { config.按钮 = { enabled: true, buttons: [{ visible: true }] }; }, /按钮应包含布尔 enabled/, '按钮缺 name');
  await expectReject(config => { config.按钮 = { enabled: true, buttons: [{ name: '重载' }] }; }, /按钮应包含布尔 enabled/, '按钮缺 visible');
  await expectReject(config => { config.按钮 = { enabled: true, buttons: [{ name: '重载', visible: 'true' }] }; }, /按钮应包含布尔 enabled/, '按钮 visible 非 bool');
  await expectReject(config => { config.导出设置 = { data: 'yes', button: true }; }, /导出设置只接受 data\/button 布尔开关/, '导出设置 data 非 bool');
  await expectReject(config => { config.导出设置 = { data: true, 未知开关: true }; }, /导出设置只接受 data\/button 布尔开关/, '导出设置额外键');
  await expectReject(config => { config.数据 = '不是对象'; }, /数据必须是对象/, '数据非对象');

  // 只省略其中一个键是允许的（PartialDeep 契约）。
  await writeText(dir, scriptEntry.file, baseline);
  const partial = await readYAML(dir, scriptEntry.file);
  partial.导出设置 = { data: true };
  await writeYAML(dir, scriptEntry.file, partial);
  const partialLoaded = await loadProject('按钮检查', root);
  assert.deepEqual(partialLoaded.card.data.extensions.tavern_helper.scripts[0].export_with, { data: true });

  // 世界书上的 区分大小写/全词匹配 允许 null，其它布尔开关不允许。
  const worldbookBaseline = await readText(dir, worldbookFile);
  const worldbookConfig = await readYAML(dir, worldbookFile);
  worldbookConfig.区分大小写 = null;
  worldbookConfig.全词匹配 = null;
  await writeYAML(dir, worldbookFile, worldbookConfig);
  await loadProject('按钮检查', root);

  const badWorldbook = await readYAML(dir, worldbookFile);
  badWorldbook.启用 = null;
  await writeYAML(dir, worldbookFile, badWorldbook);
  await assert.rejects(() => loadProject('按钮检查', root), /启用 必须是 true\/false/);
  await writeText(dir, worldbookFile, worldbookBaseline);

  await writeText(dir, scriptEntry.file, baseline);
  const restored = await loadProject('按钮检查', root);
  assert.deepEqual(semanticDiff(card, restored.card), [], '恢复原值后整卡保真');
});

async function findScriptEntry(dir, index, name) {
  for (const file of index.脚本) {
    const config = await readYAML(dir, file);
    if (config.名称 === name) return { file, config };
  }
  return undefined;
}

async function readJSONProject(dir) {
  return JSON.parse(await readText(dir, 'project.json'));
}
