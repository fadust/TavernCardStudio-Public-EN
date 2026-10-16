// Tests for tools/inspect-card.mjs using public exports and temporary directories only.
// Fixtures are created in tests without private cards or reads and writes to repository examples.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { test } from 'node:test';

import { chunk } from '../tools/lib/png.mjs';
import { sha256 } from '../tools/lib/files.mjs';
import { DEFAULT_LIMIT, createBudget, inspectCard, main, parseArgs } from '../tools/inspect-card.mjs';

const NUL = String.fromCharCode(0);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SECRETS = [
  'ZZ_SECRET_DESCRIPTION_ZZ',
  'ZZ_SECRET_ENTRY_1_ZZ',
  'ZZ_SECRET_ENTRY_2_ZZ',
  'ZZ_SECRET_ENTRY_3_ZZ',
  'ZZ_SECRET_ENTRY_4_ZZ',
  'ZZ_SECRET_ENTRY_6_ZZ',
  'ZZ_SECRET_FIND_ZZ',
  'ZZ_SECRET_REPLACE_ZZ',
  'ZZ_SECRET_REPLACE2_ZZ',
  'ZZ_SECRET_SCRIPT_1_ZZ',
  'ZZ_SECRET_SCRIPT_2_ZZ',
  'ZZ_SECRET_SCRIPT_3_ZZ',
];

// ---------- Minimal PNG ----------

function ihdr(width = 1, height = 1) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 2;
  return chunk('IHDR', data);
}

function idat(width = 1, height = 1) {
  const rows = [];
  for (let y = 0; y < height; y++) rows.push(Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, y + 1)]));
  return chunk('IDAT', zlib.deflateSync(Buffer.concat(rows)));
}

function textChunk(keyword, value) {
  return chunk('tEXt', Buffer.concat([Buffer.from(keyword + NUL, 'latin1'), Buffer.from(value, 'latin1')]));
}

function cardChunk(keyword, card) {
  return textChunk(keyword, Buffer.from(JSON.stringify(card), 'utf8').toString('base64'));
}

function buildPNG(extraChunks = []) {
  return Buffer.concat([PNG_SIGNATURE, ihdr(), ...extraChunks, idat(), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- Fixtures ----------

function worldEntry(options) {
  const index = options.index;
  const extensions = {
    position: options.position ?? 0,
    depth: options.depth ?? 4,
    role: options.role ?? 0,
    probability: 100,
    useProbability: true,
    exclude_recursion: true,
    prevent_recursion: true,
    display_index: index,
  };
  if (options.vectorized) extensions.vectorized = true;
  if (options.group !== undefined) extensions.group = options.group;
  if (options.sticky !== undefined) extensions.sticky = options.sticky;
  if (options.cooldown !== undefined) extensions.cooldown = options.cooldown;
  if (options.delay !== undefined) extensions.delay = options.delay;
  return {
    id: index,
    keys: options.keys ?? [],
    secondary_keys: [],
    comment: options.comment,
    content: options.content ?? '',
    constant: options.constant === true,
    selective: options.selective !== false,
    enabled: options.enabled !== false,
    insertion_order: options.order ?? 100,
    position: 'before_char',
    use_regex: options.useRegex === true,
    extensions,
  };
}

function fixtureCard() {
  const entries = [
    worldEntry({ index: 0, comment: '===变量开始===', enabled: false, position: 0, order: 100, vectorized: true }),
    worldEntry({ index: 1, comment: '[initvar]变量初始化', enabled: false, constant: true, position: 0, order: 101, group: "variables", content: 'ZZ_SECRET_ENTRY_1_ZZ ' + '初'.repeat(40) }),
    worldEntry({ index: 2, comment: '[mvu_update]变量更新规则', constant: true, position: 4, depth: 0, order: 102, group: "variables", content: 'ZZ_SECRET_ENTRY_2_ZZ ' + '规'.repeat(60) }),
    worldEntry({ index: 3, comment: "Used bookshop", keys: ["Used bookshop", '书店'], useRegex: true, position: 1, order: 103, content: 'ZZ_SECRET_ENTRY_3_ZZ ' + '店'.repeat(80) }),
    worldEntry({ index: 4, comment: '深巷', keys: [], vectorized: true, position: 4, depth: 2, role: 1, order: 103, sticky: 5, cooldown: 9999, delay: 3, content: 'ZZ_SECRET_ENTRY_4_ZZ' }),
    worldEntry({ index: 5, comment: '===变量结束===', enabled: false, position: 0, order: 105, vectorized: true }),
    worldEntry({ index: 6, comment: '未连接条目', keys: [], position: 1, order: 106, content: 'ZZ_SECRET_ENTRY_6_ZZ' }),
  ];
  // Verify alias mapping with a string position field and no extensions.position.
  delete entries[6].extensions.position;
  entries[6].position = 'after_char';

  const regexScripts = [
    {
      id: 'r-long', scriptName: '长替换', findRegex: '/ZZ_SECRET_FIND_ZZ/g',
      replaceString: 'ZZ_SECRET_REPLACE_ZZ' + 'y'.repeat(9000), trimStrings: ['孤儿文本', '旧文本'],
      placement: [2], disabled: false, markdownOnly: false, promptOnly: true, runOnEdit: true,
      substituteRegex: 0, minDepth: null, maxDepth: 3,
    },
    {
      id: 'r-off', scriptName: '已禁用正则', findRegex: '<CardStatus/>',
      replaceString: 'ZZ_SECRET_REPLACE2_ZZ', trimStrings: [],
      placement: [1, 5], disabled: true, markdownOnly: true, promptOnly: false, runOnEdit: false,
      substituteRegex: 0, minDepth: 0, maxDepth: null,
    },
  ];

  const scripts = [
    {
      type: 'folder', id: 'f1', name: "variables", icon: 'fa-cog', enabled: true,
      scripts: [
        {
          type: 'script', id: 's1', name: '变量结构', enabled: true,
          content: 'import { registerMvuSchema } from \'util\';\n// ZZ_SECRET_SCRIPT_1_ZZ\n',
          info: '作者注', button: { enabled: true, buttons: [{ name: '重载', visible: true }] },
          data: { note: '元数据' }, export_with: { data: true, button: true },
        },
        {
          type: 'script', id: 's2', name: '备用脚本', enabled: false,
          content: 'console.info("备用"); // ZZ_SECRET_SCRIPT_2_ZZ',
          button: { enabled: false, buttons: [] }, data: {},
        },
      ],
    },
    { type: 'script', id: 's3', name: '顶层脚本', enabled: true, content: 'ZZ_SECRET_SCRIPT_3_ZZ' },
    { type: 'script', id: 's4', name: '副作用检测', enabled: true, content: 'globalThis.__tcs_inspect_pwned = true;' },
  ];

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '研究用样例卡',
      description: 'ZZ_SECRET_DESCRIPTION_ZZ ' + '描'.repeat(24),
      personality: '',
      scenario: '',
      first_mes: '「你来了。」',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: ['备选一', '备选二'],
      group_only_greetings: [],
      tags: ['样例'],
      extensions: { regex_scripts: regexScripts, tavern_helper: { scripts, variables: { counter: 0 } } },
      character_book: { name: '样例世界书', entries },
    },
  };
}

// ---------- Temporary directories ----------

async function tempDir(t, prefix = 'tcs-inspect-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

async function writeCard(dir, name, card) {
  const file = path.join(dir, name);
  await fs.writeFile(file, JSON.stringify(card, null, 2));
  return file;
}

function assertNoSecrets(value, secrets, label) {
  const json = JSON.stringify(value);
  for (const secret of secrets) assert.ok(!json.includes(secret), label + ' 不应包含正文片段 ' + secret);
}

// ---------- Summaries ----------

test("default summaries show hashes and counts without body text or large replacement strings", async t => {
  const dir = await tempDir(t);
  const card = fixtureCard();
  const file = await writeCard(dir, 'card.json', card);
  const bytes = await fs.readFile(file);

  const result = await main([file]);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'summary');
  assert.equal(result.limit, DEFAULT_LIMIT);
  assert.equal(result.input.sha256, sha256(bytes));
  assert.equal(result.input.bytes, bytes.length);
  assert.equal(result.input.format, 'json');
  assert.equal(result.card.sha256, sha256(Buffer.from(JSON.stringify(card), 'utf8')));
  assert.equal(result.card.spec, 'chara_card_v2');
  assert.equal(result.card.sources.worldbook, '/data/character_book');
  assert.equal(result.card.sources.regex, '/data/extensions/regex_scripts');
  assert.equal(result.card.sources.scripts, '/data/extensions/tavern_helper');

  assertNoSecrets(result, SECRETS, '默认摘要');
  assert.equal(result.texts.description.chars, card.data.description.length);
  assert.equal(result.texts.description.sha256, sha256(Buffer.from(card.data.description, 'utf8')));
  assert.equal(result.texts.description.source, '/data/description');
  assert.equal(result.texts['system_prompt'].chars, 0);
  assert.equal(result.counts.worldbook.total, 7);
  assert.equal(result.counts.greetings.alternate, 2);
  assert.equal(result.counts.tags, 1);
  assert.deepEqual(result.notes, [
    'There are 3 vector-strategy entries, of which 1 are enabled and require the host vector extension.',
    'There are 1 enabled entries with no constant, keyword, or vector trigger; ordinary scanning will not activate them.',
  ]);

  const summary = inspectCard(card);
  assert.deepEqual(summary.counts, result.counts);
  assert.equal(summary.card.sha256, result.card.sha256);
});

test("summaries count activation modes, enabled state, position, depth, order, categories, and separators", async t => {
  const dir = await tempDir(t);
  const file = await writeCard(dir, 'card.json', fixtureCard());
  const result = await main([file]);
  const worldbook = result.worldbook;

  assert.equal(worldbook.enabled, 4);
  assert.equal(worldbook.disabled, 3);
  assert.equal(worldbook.trigger.constant, 2);
  assert.equal(worldbook.trigger.keyword, 2); // Keyword mode includes disconnected entries with no keywords.
  assert.equal(worldbook.trigger.vectorized, 3);
  assert.equal(worldbook.trigger.selective, 7);
  assert.equal(worldbook.trigger.noTrigger, 1);
  assert.equal(worldbook.keys.entriesWithKeys, 1);
  assert.equal(worldbook.keys.totalKeys, 2);
  assert.equal(worldbook.keys.regexEntries, 1);
  assert.equal(worldbook.keys.regexLiteralEntries, 0);

  assert.deepEqual(worldbook.position, { 0: 3, 1: 2, 4: 2 });
  assert.deepEqual(worldbook.positionLabels, { 0: "before_character", 1: "after_character", 4: "at_depth" });
  assert.deepEqual(worldbook.depth, { 0: 1, 2: 1 });
  assert.equal(worldbook.depthMissing, 0);
  assert.deepEqual(worldbook.role, { 0: 1, 1: 1 });
  assert.deepEqual(worldbook.order, { min: 100, max: 106, distinct: 6, missing: 0, duplicates: [{ order: 103, count: 2 }] });
  assert.equal(worldbook.flags.useProbability, 7);
  assert.equal(worldbook.flags.sticky, 1);
  assert.equal(worldbook.flags.cooldown, 1);
  assert.equal(worldbook.flags.delay, 1);
  assert.equal(worldbook.flags.group, 2);

  const classification = worldbook.classification;
  assert.deepEqual(classification.separators, { total: 2, enabled: 0, disabled: 2, names: ['===变量开始===', '===变量结束==='] });
  assert.deepEqual(classification.tags, [
    { tag: null, total: 5, enabled: 3, disabled: 2, separators: 2 },
    { tag: '[initvar]', total: 1, enabled: 0, disabled: 1, separators: 0 },
    { tag: '[mvu_update]', total: 1, enabled: 1, disabled: 0, separators: 0 },
  ]);
  assert.deepEqual(classification.segments, [
    { name: '===变量开始===', total: 4, enabled: 3, disabled: 1 },
    { name: '===变量结束===', total: 1, enabled: 1, disabled: 0 },
  ]);

  assert.equal(result.counts.regex.total, 2);
  assert.equal(result.counts.regex.enabled, 1);
  assert.equal(result.counts.scripts.total, 4);
  assert.equal(result.counts.scripts.disabled, 1);
  assert.equal(result.counts.scripts.folders, 1);
  assert.equal(result.regex.items[0].placement.length, 1);
  assert.equal(result.regex.items[0].findRegex.chars, '/ZZ_SECRET_FIND_ZZ/g'.length);
  assert.equal(result.regex.items[0].findRegex.flags, 'g');
  assert.equal(result.regex.items[0].findRegex.isLiteral, true);
  assert.equal(result.regex.items[0].replaceString.chars, 9020);
  assert.equal(result.regex.items[1].enabled, false);
  assert.equal(result.scripts.folders[0].children, 2);
  assert.deepEqual(result.scripts.items.map(script => script.path), ['0.scripts.0', '0.scripts.1', '1', '2']);
  assert.equal(result.scripts.items[0].pointer, '/data/extensions/tavern_helper/scripts/0/scripts/0/content');
  assert.equal(result.scripts.items[1].enabled, false);
  assert.equal(result.scripts.items[0].buttonCount, 1);
  assert.equal(result.scripts.items[0].dataKeys, 1);
});

// ---------- Entry index and body ----------

test("--entries prints only entry index metadata", async t => {
  const dir = await tempDir(t);
  const card = fixtureCard();
  const file = await writeCard(dir, 'card.json', card);

  const result = await main([file, '--entries']);
  assert.equal(result.mode, 'entries');
  assert.deepEqual(result.entries.map(entry => entry.index), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(result.entries[3].name, "Used bookshop");
  assert.deepEqual(result.entries[3].keys.sample, ["Used bookshop", '书店']);
  assert.equal(result.entries[3].keys.count, 2);
  assert.equal(result.entries[3].position, 1);
  assert.equal(result.entries[3].positionLabel, "after_character");
  assert.equal(result.entries[3].useRegex, true);
  assert.equal(result.entries[6].position, 1);
  assert.equal(result.entries[0].separator, true);
  assert.equal(result.entries[2].tag, '[mvu_update]');
  assert.equal(result.entries[2].depth, 0);
  assert.equal(result.entries[2].contentChars, card.data.character_book.entries[2].content.length);
  assert.equal(result.entries[2].contentSha256, sha256(Buffer.from(card.data.character_book.entries[2].content, 'utf8')));
  assert.equal(result.entries[2].pointer, '/data/character_book/entries/2');
  assertNoSecrets(result, SECRETS, '--entries');
});

test("--entry supports IDs, exact names, and ordinal fallback", async t => {
  const dir = await tempDir(t);
  const card = fixtureCard();
  card.data.character_book.entries[1].id = 'entry-beta';
  card.data.character_book.entries[2].id = 'entry-alpha';
  const file = await writeCard(dir, 'card.json', card);

  const byId = await main([file, '--entry', 'entry-alpha']);
  assert.equal(byId.mode, 'entry');
  assert.equal(byId.selected.index, 2);
  assert.equal(byId.selected.id, 'entry-alpha');
  assert.equal(byId.body, card.data.character_book.entries[2].content);
  assert.equal(byId.selected.pointer, '/data/character_book/entries/2');
  assert.equal(byId.selected.contentPointer, '/data/character_book/entries/2/content');
  assert.equal(byId.selected.truncated, false);
  assert.equal(byId.selected.totalChars, byId.body.length);

  const byName = await main([file, '--entry', "Used bookshop"]);
  assert.equal(byName.selected.index, 3);
  assert.equal(byName.body, card.data.character_book.entries[3].content);
  assert.equal(byName.worldbook, undefined, '选中正文的模式不重复整份摘要');
  assert.equal(byName.texts, undefined);
  assert.equal(byName.counts.worldbook.total, 7);

  const byIndex = await main([file, '--entry', '1']);
  assert.equal(byIndex.selected.index, 1);
  assert.equal(byIndex.body, card.data.character_book.entries[1].content);

  await assert.rejects(() => main([file, '--entry', '不存在的条目']), /Cannot find worldbook entry/);
});

test("--script and --regex select exact matches with metadata", async t => {
  const dir = await tempDir(t);
  const card = fixtureCard();
  const file = await writeCard(dir, 'card.json', card);

  const byId = await main([file, '--script', 's1']);
  assert.equal(byId.mode, 'script');
  assert.equal(byId.body, card.data.extensions.tavern_helper.scripts[0].scripts[0].content);
  assert.equal(byId.selected.pointer, '/data/extensions/tavern_helper/scripts/0/scripts/0/content');
  assert.equal(byId.selected.contentSha256, sha256(Buffer.from(byId.body, 'utf8')));

  const byPath = await main([file, '--script', '0.scripts.1']);
  assert.equal(byPath.selected.id, 's2');
  assert.equal(byPath.body, card.data.extensions.tavern_helper.scripts[0].scripts[1].content);

  const byName = await main([file, '--script', '顶层脚本']);
  assert.equal(byName.selected.id, 's3');
  await assert.rejects(() => main([file, '--script', '没有这个脚本']), /Cannot find script/);

  const regex = await main([file, '--regex', 'r-long']);
  assert.equal(regex.mode, 'regex');
  assert.equal(regex.selected.id, 'r-long');
  assert.equal(regex.regex, undefined, '选中正文的模式不重复整份摘要');
  assert.equal(regex.scripts, undefined);
  assert.equal(regex.parts.findRegex.body, '/ZZ_SECRET_FIND_ZZ/g');
  assert.equal(regex.parts.findRegex.truncated, false);
  assert.equal(regex.selected.replaceString.chars, 9020);
  assert.equal(regex.parts.replaceString.totalChars, 9020);
  assert.equal(regex.parts.replaceString.chars, DEFAULT_LIMIT - '/ZZ_SECRET_FIND_ZZ/g'.length);
  assert.equal(regex.parts.replaceString.truncated, true);
  assert.equal(regex.parts.replaceString.body, card.data.extensions.regex_scripts[0].replaceString.slice(0, regex.parts.replaceString.chars));
  assert.equal(regex.parts.trimStrings.chars, 0);
  assert.equal(regex.parts.trimStrings.count, 2);
  assert.equal(regex.parts.trimStrings.totalChars, '孤儿文本\n旧文本'.length);

  const byIndex = await main([file, '--regex', '1']);
  assert.equal(byIndex.selected.id, 'r-off');
  assert.equal(byIndex.parts.replaceString.body, 'ZZ_SECRET_REPLACE2_ZZ');
  await assert.rejects(() => main([file, '--regex', 'r-none']), /Cannot find regex/);
});

// ---------- Budgets ----------

test("createBudget consumes limits sequentially and reports the total", () => {
  const budget = createBudget(10);
  const first = budget.take('abcdef');
  assert.deepEqual([first.body, first.chars, first.totalChars, first.truncated], ['abcdef', 6, 6, false]);
  const second = budget.take('ghijklmn');
  assert.deepEqual([second.body, second.chars, second.totalChars, second.truncated], ['ghij', 4, 8, true]);
  assert.equal(second.sha256, sha256(Buffer.from('ghijklmn', 'utf8')));
  assert.equal(budget.remaining, 0);
  assert.deepEqual([budget.take('x').body, budget.take('x').truncated], ['', true]);
  assert.throws(() => createBudget(-1), /non-negative integer/);
  assert.throws(() => createBudget(1.5), /non-negative integer/);
});

test("body text respects the default budget and --limit", async t => {
  const dir = await tempDir(t);
  const card = fixtureCard();
  const body = 'Z'.repeat(20000);
  card.data.character_book.entries[3].content = body;
  const file = await writeCard(dir, 'card.json', card);

  const dflt = await main([file, '--entry', "Used bookshop"]);
  assert.equal(dflt.body.length, DEFAULT_LIMIT);
  assert.equal(dflt.selected.totalChars, body.length);
  assert.equal(dflt.selected.truncated, true);
  assert.equal(dflt.selected.sha256, sha256(Buffer.from(body, 'utf8')));

  const small = await main([file, '--entry', "Used bookshop", '--limit', '100']);
  assert.equal(small.limit, 100);
  assert.equal(small.body, body.slice(0, 100));

  const none = await main([file, '--entry', "Used bookshop", '--limit', '0']);
  assert.equal(none.body, '');
  assert.equal(none.selected.truncated, true);
  assert.equal(none.selected.totalChars, body.length);

  const roomy = await main([file, '--entry', "Used bookshop", '--limit', '20000']);
  assert.equal(roomy.body, body);
  assert.equal(roomy.selected.truncated, false);

  const partial = await inspectCard(card, { mode: 'entry', selector: "Used bookshop", limit: 5 });
  assert.equal(partial.body, body.slice(0, 5));

  const script = await main([file, '--script', 's3', '--limit', '4']);
  assert.equal(script.body, 'ZZ_S');
  assert.equal(script.selected.totalChars, card.data.extensions.tavern_helper.scripts[1].content.length);
});

// ---------- PNG input ----------

test("PNG input reads chara/ccv3 and reports corruption clearly", async t => {
  const dir = await tempDir(t);
  const card = fixtureCard();
  const charaFile = path.join(dir, 'card.png');
  await fs.writeFile(charaFile, buildPNG([cardChunk('chara', card)]));

  const result = await main([charaFile]);
  assert.equal(result.input.format, 'png');
  assert.equal(result.input.metadataType, 'chara');
  assert.equal(result.input.sha256, sha256(await fs.readFile(charaFile)));
  assert.equal(result.counts.worldbook.total, 7);
  assert.equal(result.counts.scripts.total, 4);
  assertNoSecrets(result, SECRETS, 'PNG 摘要');

  const picked = await main([charaFile, '--entry', '3']);
  assert.equal(picked.body, card.data.character_book.entries[3].content);

  const both = path.join(dir, 'both.png');
  const v3 = { ...card, spec: 'chara_card_v3', spec_version: '3.0' };
  await fs.writeFile(both, buildPNG([cardChunk('chara', card), cardChunk('ccv3', v3)]));
  const preferred = await main([both]);
  assert.equal(preferred.input.metadataType, 'ccv3');
  assert.equal(preferred.card.spec, 'chara_card_v3');

  const truncated = path.join(dir, 'truncated.png');
  const image = buildPNG([cardChunk('chara', card)]);
  await fs.writeFile(truncated, image.subarray(0, image.length - 8));
  await assert.rejects(() => main([truncated]), /Truncated|out of bounds|IEND/);

  const broken = path.join(dir, 'broken.png');
  await fs.writeFile(broken, Buffer.from('这不是 PNG', 'utf8'));
  await assert.rejects(() => main([broken]), /Invalid PNG signature/);
});

// ---------- Arguments and errors ----------

test("CLI arguments are validated and --help shows usage", async t => {
  const dir = await tempDir(t);
  const file = await writeCard(dir, 'card.json', fixtureCard());

  await assert.rejects(() => main([]), /Missing input file/);
  await assert.rejects(() => main([file, '--nope']), /Unknown argument/);
  await assert.rejects(() => main([file, '--entry']), /--entry is missing a value/);
  await assert.rejects(() => main([file, '--limit', 'abc']), /--limit requires a non-negative integer/);
  await assert.rejects(() => main([file, '--limit', '-1']), /--limit requires a non-negative integer/);
  await assert.rejects(() => main([file, '--entry', '0', '--script', 's1']), /Choose only one output mode/);
  await assert.rejects(() => main([file, '--entries', '--regex', 'r-long']), /Choose only one output mode/);
  await assert.rejects(() => main([file, '再来一个.json']), /Inspect one file at a time/);
  await assert.rejects(() => main([path.join(dir, '不存在.json')]), /Cannot read/);

  const help = await main(['--help']);
  assert.equal(help.ok, true);
  assert.equal(help.defaults.limit, DEFAULT_LIMIT);
  assert.ok(help.usage[0].includes('inspect-card.mjs'));

  assert.deepEqual(parseArgs(['a.json', '--entries']), { file: 'a.json', mode: 'entries', selector: null, limit: DEFAULT_LIMIT, help: false });
  assert.equal(parseArgs(['a.json', '--regex', 'r1', '--limit', '12']).limit, 12);
  assert.throws(() => parseArgs(['a.json', '--entry', '--limit', '5']), /--entry is missing a value/);
});

test("nonobject input is rejected while legacy roots and split placeholders receive guidance", async t => {
  const dir = await tempDir(t);

  const arrayFile = path.join(dir, 'array.json');
  await fs.writeFile(arrayFile, '[1,2]');
  await assert.rejects(() => main([arrayFile]), /must be a JSON object/);
  assert.throws(() => inspectCard("text"), /must be a JSON object/);
  assert.throws(() => inspectCard([1, 2]), /must be a JSON object/);

  const legacy = {
    description: '根层描述',
    character_book: { entries: [worldEntry({ index: 0, comment: '根层条目', keys: ['根层'], content: '根层正文' })] },
    extensions: { regex_scripts: [{ id: 'r-legacy', scriptName: '根层正则', findRegex: '/a/g', replaceString: 'b', placement: [2], disabled: false, trimStrings: [] }] },
  };
  const legacyFile = await writeCard(dir, 'legacy.json', legacy);
  const legacyResult = await main([legacyFile]);
  assert.equal(legacyResult.card.spec, null);
  assert.equal(legacyResult.card.sources.worldbook, '/character_book');
  assert.equal(legacyResult.card.sources.regex, '/extensions/regex_scripts');
  assert.equal(legacyResult.texts.description.source, '/description');
  assert.equal(legacyResult.counts.regex.total, 1);
  assert.ok(legacyResult.notes.some(note => note.includes('No spec field')));

  const split = fixtureCard();
  for (const field of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions']) split.data[field] = '';
  const splitFile = await writeCard(dir, 'split.json', split);
  const splitResult = await main([splitFile]);
  assert.ok(splitResult.notes.some(note => note.includes('a split src/card.json')));
});

// ---------- Read-only inspection without execution ----------

test("inspection executes no card code, writes no files, and module imports do not run main", async t => {
  const dir = await tempDir(t);
  const card = fixtureCard();
  const file = await writeCard(dir, 'card.json', card);
  const before = await fs.readFile(file);
  const listing = await fs.readdir(dir);
  delete globalThis.__tcs_inspect_pwned;

  const result = await main([file, '--script', '副作用检测']);
  assert.equal(result.body, 'globalThis.__tcs_inspect_pwned = true;');
  assert.equal(globalThis.__tcs_inspect_pwned, undefined, '卡内脚本字符串不能被当作代码执行');
  assert.ok((await fs.readFile(file)).equals(before), '输入文件必须保持逐字节一致');
  assert.deepEqual(await fs.readdir(dir), listing, '检查过程不应在输入目录写入文件');

  const module = await import('../tools/inspect-card.mjs');
  assert.equal(typeof module.main, 'function');
  assert.equal(typeof module.inspectFile, 'function');
  assert.equal(result.notes.length, 2);
});

test("activation is independent of selective keywords and separator/category detection stays metadata-only", () => {
  const card = fixtureCard();
  card.data.character_book.entries = [
    { id: 1, comment: '[本体][系统]➡️变量开始', content: '<变量>', enabled: true, constant: true, selective: false, keys: ["variables"], extensions: { vectorized: true } },
    { id: 2, comment: '[本体][系统]无关键词', content: '', enabled: true, constant: false, selective: false, keys: [], extensions: {} },
    { id: 3, comment: '[本体][系统]➡️变量结束', content: '', enabled: false, constant: false, selective: true, keys: [], extensions: { vectorized: true } },
  ];
  const result = inspectCard(card);
  assert.equal(result.worldbook.trigger.constant, 1);
  assert.equal(result.worldbook.trigger.keyword, 1);
  assert.equal(result.worldbook.trigger.vectorized, 1);
  assert.equal(result.worldbook.trigger.conflictingFlags, 1);
  assert.equal(result.worldbook.trigger.noTrigger, 1);
  assert.deepEqual(result.worldbook.enabledStrategy, { constant: 1, keyword: 1, vectorized: 0 });
  assert.equal(result.worldbook.classification.separators.total, 2);
  assert.equal(result.worldbook.classification.separators.enabled, 1);
  assert.equal(result.worldbook.classification.allTags['[系统]'], 3);
});
