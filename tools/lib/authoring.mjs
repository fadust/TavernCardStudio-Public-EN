import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument, stringify } from 'yaml';
import { safeFile, inside, write, writeJSON, exists, sha256, jsonText, getPointer, setPointer } from './files.mjs';
import { validateWorldbookFolder } from './worldbook-layout.mjs';

const TEXT = { 角色描述: 'description', 性格: 'personality', 场景: 'scenario', 第一条消息: 'first_mes', 对话示例: 'mes_example', 创作者备注: 'creator_notes', 系统提示: 'system_prompt', 历史后提示: 'post_history_instructions' };
const ROLE = { 名称: 'name', 作者: 'creator', 版本: 'character_version', 标签: 'tags' };
const BOOK = { 名称: 'name', 描述: 'description', 扫描深度: 'scan_depth', 预算: 'token_budget', 递归扫描: 'recursive_scanning' };
const WORLD = { 名称: 'comment', 启用: 'enabled', 关键词: 'keys', 次要关键词: 'secondary_keys', 使用次要关键词: 'selective', 关键词使用正则: 'use_regex', 顺序: 'insertion_order', 深度: 'extensions.depth', 概率: 'extensions.probability', 使用概率: 'extensions.useProbability', 次要关键词逻辑: 'extensions.selectiveLogic', 扫描深度: 'extensions.scan_depth', 区分大小写: 'extensions.case_sensitive', 全词匹配: 'extensions.match_whole_words', 不可被递归激活: 'extensions.exclude_recursion', 不可激活其他条目: 'extensions.prevent_recursion', 延迟到递归: 'extensions.delay_until_recursion', 忽略预算: 'extensions.ignore_budget', 分组: 'extensions.group', 覆盖分组: 'extensions.group_override', 分组权重: 'extensions.group_weight', 黏性: 'extensions.sticky', 冷却: 'extensions.cooldown', 延迟: 'extensions.delay', 出口: 'extensions.outlet_name', 自动化ID: 'extensions.automation_id' };
const REGEX = { 名称: 'scriptName', 查找: 'findRegex', 裁剪: 'trimStrings', 禁用: 'disabled', 仅显示: 'markdownOnly', 仅提示词: 'promptOnly', 编辑时运行: 'runOnEdit', 宏替换模式: 'substituteRegex', 最小深度: 'minDepth', 最大深度: 'maxDepth' };
const SCRIPT = { 名称: 'name', 启用: 'enabled', 说明: 'info', 按钮: 'button', 数据: 'data', 导出设置: 'export_with', 图标: 'icon', 颜色: 'color' };
const POSITIONS = ['角色定义之前', '角色定义之后', '作者注之前', '作者注之后', '指定深度', '示例消息之前', '示例消息之后', '出口'];
const ROLES = ['系统', '用户', '助手'];
const PLACEMENTS = { 旧版显示: 0, 用户输入: 1, AI输出: 2, 快捷命令: 3, 世界书: 5, 推理: 6 };
const LOGIC = ['任一匹配', '不全部匹配', '全部不匹配', '全部匹配'];
const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function helperScriptLists(helper, pointer) {
  if (object(helper) && Array.isArray(helper.scripts)) return [{ list: helper.scripts, pointer: `${pointer}/scripts` }];
  if (!Array.isArray(helper)) return [];
  if (helper.every(v => object(v) && (['script', 'folder'].includes(v.type) || (typeof v.content === 'string' && Object.hasOwn(v, 'id'))))) return [{ list: helper, pointer }];
  return helper.flatMap((tuple, i) => Array.isArray(tuple) && tuple[0] === 'scripts' && Array.isArray(tuple[1]) ? [{ list: tuple[1], pointer: `${pointer}/${i}/1` }] : []);
}
function get(obj, key) { return key.split('.').reduce((o, k) => o?.[k], obj); }
function put(obj, key, value) {
  const parts = key.split('.'); const last = parts.pop(); let current = obj;
  for (const part of parts) { if (!object(current[part])) current[part] = {}; current = current[part]; }
  Object.defineProperty(current, last, { value: clone(value), enumerable: true, writable: true, configurable: true });
}
function project(obj, map) { return Object.fromEntries(Object.entries(map).filter(([, k]) => get(obj, k) !== undefined).map(([k, p]) => [k, clone(get(obj, p))])); }
function overlay(obj, config, map) { for (const [key, target] of Object.entries(map)) if (Object.hasOwn(config, key)) put(obj, target, config[key]); }
function enumValue(value, names, label) {
  if (Number.isInteger(value)) {
    if (Array.isArray(names) ? value >= 0 && value < names.length : Object.values(names).includes(value)) return value;
    throw new Error(`${label}: 枚举值越界 ${value}`);
  }
  const n = Array.isArray(names) ? names.indexOf(value) : names[value];
  if (n === undefined || n === -1) throw new Error(`${label}: 未知值 ${JSON.stringify(value)}`);
  return n;
}
function strictKeys(config, allowed, label) {
  if (!object(config)) throw new Error(`${label}: 必须是设置对象`);
  for (const key of Object.keys(config)) if (!allowed.includes(key)) throw new Error(`${label}: 未知设置 ${key}`);
}
function list(value, label) { if (!Array.isArray(value)) throw new Error(`${label}: 必须是列表`); return value; }
function validateSettings(config, previous, label) {
  const booleans = ['启用', '使用次要关键词', '关键词使用正则', '使用概率', '区分大小写', '全词匹配', '不可被递归激活', '不可激活其他条目', '忽略预算', '覆盖分组', '禁用', '仅显示', '仅提示词', '编辑时运行', '递归扫描'];
  const numbers = ['顺序', '深度', '概率', '扫描深度', '分组权重', '黏性', '冷却', '延迟', '宏替换模式', '最小深度', '最大深度', '预算'];
  const strings = ['名称', '作者', '版本', '描述', '分组', '出口', '自动化ID', '查找', '说明', '图标', '颜色'];
  for (const [key, value] of Object.entries(config)) {
    if (previous && isDeepStrictEqual(value, previous[key])) continue; // Imported unusual values stay lossless until edited.
    if (booleans.includes(key) && !(value === null && ['区分大小写', '全词匹配'].includes(key)) && typeof value !== 'boolean') throw new Error(`${label}: ${key} 必须是 true/false`);
    if (numbers.includes(key) && value !== null && (!Number.isFinite(value) || !Number.isInteger(value))) throw new Error(`${label}: ${key} 必须是整数或 null`);
    if (strings.includes(key) && typeof value !== 'string') throw new Error(`${label}: ${key} 必须是文本（版本号请加引号）`);
    if (['关键词', '次要关键词', '裁剪', '标签'].includes(key) && (!Array.isArray(value) || value.some(v => typeof v !== 'string'))) throw new Error(`${label}: ${key} 必须是文本列表`);
    if (['按钮', '导出设置'].includes(key) && !object(value)) throw new Error(`${label}: ${key} 必须是设置对象`);
    if (key === '按钮' && (typeof value.enabled !== 'boolean' || !Array.isArray(value.buttons) || value.buttons.some(button => !object(button) || typeof button.name !== 'string' || typeof button.visible !== 'boolean'))) throw new Error(`${label}: 按钮应包含布尔 enabled 和 buttons[{ name, visible }]`);
    if (key === '导出设置' && Object.entries(value).some(([key, flag]) => !['data', 'button'].includes(key) || typeof flag !== 'boolean')) throw new Error(`${label}: 导出设置只接受 data/button 布尔开关`);
    if (key === '数据' && !object(value)) throw new Error(`${label}: 数据必须是对象`);
  }
}
export async function readYAML(dir, file) {
  const doc = parseDocument(await fs.readFile(await safeFile(dir, file), 'utf8'), { uniqueKeys: true, strict: true });
  if (doc.errors.length || doc.warnings.length) throw new Error(`${file}: ${(doc.errors[0] ?? doc.warnings[0]).message}`);
  const value = doc.toJS({ maxAliasCount: 100 });
  const check = (v, ancestors = new Set()) => {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`${file}: 不支持非有限数值`);
    if (v && typeof v === 'object') {
      if (ancestors.has(v)) throw new Error(`${file}: 不支持循环 YAML 别名`);
      const next = new Set(ancestors).add(v); Object.values(v).forEach(child => check(child, next));
    }
  };
  check(value); return value;
}
export async function writeYAML(dir, file, value) {
  const target = inside(dir, file); let ancestor = path.dirname(target);
  while (!(await exists(ancestor))) ancestor = path.dirname(ancestor);
  const relative = path.relative(await fs.realpath(dir), await fs.realpath(ancestor));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error(`写入路径越界: ${file}`);
  if (await exists(target)) await safeFile(dir, file);
  return write(target, stringify(value, { lineWidth: 0, aliasDuplicateObjects: false }));
}

function metadata(kind, base) {
  const config = project(base, kind === 'worldbook' ? WORLD : kind === 'regex' ? REGEX : SCRIPT);
  if (kind === 'worldbook') {
    config.激活 = base.constant ? '蓝灯' : base.extensions?.vectorized ? '向量' : '绿灯';
    if (base.extensions?.position !== undefined) config.位置 = POSITIONS[base.extensions.position] ?? base.extensions.position;
    else if (base.position === 'before_char' || base.position === 'after_char') config.位置 = base.position === 'before_char' ? POSITIONS[0] : POSITIONS[1];
    if (base.extensions?.role !== undefined) config.角色 = ROLES[base.extensions.role] ?? base.extensions.role;
    if (base.extensions?.selectiveLogic !== undefined) config.次要关键词逻辑 = LOGIC[base.extensions.selectiveLogic] ?? base.extensions.selectiveLogic;
  }
  if (kind === 'regex' && Array.isArray(base.placement)) config.作用于 = base.placement.map(n => Object.keys(PLACEMENTS).find(k => PLACEMENTS[k] === n) ?? n);
  if (kind === 'script') config.类型 = base.type === 'folder' ? '文件夹' : '脚本';
  return config;
}

// Only this module knows container locations. The editable files never contain JSON pointers.
export async function writeAuthoring(dir, card, manifest) {
  if (await exists(path.join(dir, 'src/index.yaml'))) throw new Error('src/index.yaml 已存在，拒绝覆盖已有创作配置');
  const state = { version: 2, card: clone(card), records: {}, groups: [], text: {} };
  const fields = new Map(manifest.fields.map(f => [f.pointer, f.file]));
  const builds = new Map(manifest.builds.map(b => [b.pointer, b]));
  const reference = (pointer, file) => builds.has(pointer) ? { 文件: file, 构建: { 类型: builds.get(pointer).kind, 入口: builds.get(pointer).entry } } : file;
  const ensureText = async (pointer, suggested) => {
    if (fields.has(pointer)) return fields.get(pointer);
    let value; try { value = getPointer(card, pointer); } catch { return undefined; }
    if (typeof value !== 'string') return undefined;
    let file = suggested, suffix = 1;
    while (await exists(path.join(dir, file))) file = suggested.replace(/(\.[^.]+)$/, `-import-${suffix++}$1`);
    await write(path.join(dir, file), value); fields.set(pointer, file); return file;
  };
  const claimed = new Set();
  const reserved = new Set([...fields.values()].map(f => f.toLowerCase()));
  const configPath = async (body, kind, n) => {
    const stem = body ? body.replace(/\.[^./]+$/, '') : `src/${kind === 'script' ? 'scripts' : kind}/item-${n}`;
    let file = `${stem}.yaml`, count = 1;
    while (reserved.has(file.toLowerCase()) || await exists(path.join(dir, file))) file = `${stem}.settings-${count++}.yaml`;
    reserved.add(file.toLowerCase()); return file;
  };
  const index = { 角色: project(card.data, ROLE), 文本: {}, 备选开场白: [], 群聊开场白: [], 世界书: { 条目: [] }, 正则: [], 脚本: [] };
  let sequence = 0;
  const saveItem = async (kind, base, pointer) => {
    if (!object(base)) throw new Error(`${pointer}: 条目不是对象，不能转换成创作配置`);
    const contentKey = kind === 'regex' ? 'replaceString' : 'content';
    const folder = kind === 'script' && base.type === 'folder';
    const body = folder ? undefined : await ensureText(`${pointer}/${contentKey}`, `src/${kind === 'script' ? 'scripts' : kind}/import-${sequence + 1}.${kind === 'script' ? 'js' : kind === 'regex' ? 'txt' : 'md'}`);
    if (body) claimed.add(body);
    const key = `${kind}-${++sequence}`;
    const file = await configPath(body, kind, sequence);
    const config = { 关联: key, ...metadata(kind, base) };
    if (kind === 'script' && JSON.stringify(config.数据 ?? '').length > 2000) {
      const dataFile = file.replace(/\.yaml$/, '.data.yaml');
      await writeYAML(dir, dataFile, config.数据); delete config.数据; config.数据文件 = dataFile;
    }
    if (body) config[kind === 'regex' ? '替换文件' : '文件'] = body;
    const build = builds.get(`${pointer}/${contentKey}`);
    if (build) config.构建 = { 类型: build.kind, 入口: build.entry };
    if (kind === 'script' && base.type === 'folder' && Array.isArray(base.scripts)) {
      config.脚本 = [];
      for (const [i, child] of base.scripts.entries()) config.脚本.push(await saveItem('script', child, `${pointer}/scripts/${i}`));
    }
    const attachments = {};
    for (const field of manifest.fields) if (field.pointer.startsWith(pointer + '/') && !claimed.has(field.file)) {
      const label = path.basename(field.file); claimed.add(field.file);
      (config.附属文本 ??= {})[label] = reference(field.pointer, field.file);
      attachments[label] = field.pointer.slice(pointer.length);
    }
    state.records[key] = { kind, base: clone(base), config: clone(config), attachments, pointer, file };
    await writeYAML(dir, file, config); return file;
  };
  for (const [title, key] of Object.entries(TEXT)) {
    const pointer = `/data/${key}`; const file = await ensureText(pointer, `src/text/${key}.md`);
    if (file && (card.data[key] !== '' || key === 'first_mes' || builds.has(pointer))) index.文本[title] = reference(pointer, file);
  }
  for (const [title, key] of [['备选开场白', 'alternate_greetings'], ['群聊开场白', 'group_only_greetings']]) {
    if (Array.isArray(card.data[key])) {
      index[title] = [];
      for (const [i] of card.data[key].entries()) {
        const pointer = `/data/${key}/${i}`;
        const file = await ensureText(pointer, `src/greetings/${key}-${i + 1}.md`);
        if (!file) throw new Error(`${key}/${i}: 开场白不是文本，不能转换成创作配置`);
        index[title].push(reference(pointer, file));
      }
    }
  }
  if (card.data.character_book) {
    Object.assign(index.世界书, project(card.data.character_book, BOOK));
    for (const [i, entry] of (card.data.character_book.entries ?? []).entries()) index.世界书.条目.push(await saveItem('worldbook', entry, `/data/character_book/entries/${i}`));
  }
  for (const [root, ext, title] of [['/data/extensions', card.data.extensions, '正则'], ['/extensions', card.extensions, '兼容正则']]) {
    if (Array.isArray(ext?.regex_scripts)) {
      index[title] = [];
      for (const [i, r] of ext.regex_scripts.entries()) index[title].push(await saveItem('regex', r, `${root}/regex_scripts/${i}`));
    }
    const saveGroup = async (value, pointer) => {
      if (Array.isArray(value)) {
        const files = [];
        for (const [i, script] of value.entries()) files.push(await saveItem('script', script, `${pointer}/${i}`));
        const groupKey = `group-${state.groups.length + 1}`;
        const primary = !state.groups.some(g => g.primary) && root === '/data/extensions';
        state.groups.push({ key: groupKey, pointer, primary });
        if (primary) index.脚本 = files;
        else (index.兼容脚本组 ??= []).push({ 关联: groupKey, 脚本: files });
        return;
      }
    };
    for (const group of helperScriptLists(ext?.tavern_helper, `${root}/tavern_helper`)) await saveGroup(group.list, group.pointer);
    if (object(ext?.tavern_helper) && Object.hasOwn(ext.tavern_helper, 'variables')) index[root === '/data/extensions' ? '助手变量' : '兼容助手变量'] = clone(ext.tavern_helper.variables);
  }
  // Preserve all other extracted text through named references, including legacy mirrors and depth prompts.
  const used = new Set([...Object.values(TEXT).map(key => fields.get(`/data/${key}`)), ...[...index.备选开场白, ...index.群聊开场白].map(v => typeof v === 'string' ? v : v.文件)]);
  for (const file of claimed) used.add(file);
  for (const field of manifest.fields) if (!used.has(field.file)) {
    let title = field.file.replace(/^src\//, '').replace(/\.[^.]+$/, '');
    if (Object.hasOwn(state.text, title)) title = field.file.replace(/^src\//, '');
    (index.兼容文本 ??= {})[title] = reference(field.pointer, field.file); state.text[title] = field.pointer;
  }
  await writeYAML(dir, 'src/index.yaml', index);
  await writeContentNavigation(dir, manifest.name);
  const bytes = jsonText(state); await write(path.join(dir, '.card/state.json'), bytes);
  const next = { ...manifest, schemaVersion: 2, source: 'src/index.yaml', state: { file: '.card/state.json', sha256: sha256(bytes) } };
  delete next.fields; delete next.builds;
  await writeJSON(path.join(dir, 'project.json'), next);
  await fs.unlink(path.join(dir, 'src/card.json'));
  return next;
}

export async function loadAuthoring(dir, manifest) {
  if (manifest.source !== 'src/index.yaml' || manifest.state?.file !== '.card/state.json') throw new Error('创作工程 source/state 配置无效');
  const stateBytes = await fs.readFile(await safeFile(dir, manifest.state.file));
  if (sha256(stateBytes) !== manifest.state.sha256) throw new Error('兼容数据校验失败：.card/ 由工具维护，请勿手改');
  const state = JSON.parse(stateBytes); const card = clone(state.card);
  const index = await readYAML(dir, manifest.source);
  strictKeys(index, ['角色', '文本', '备选开场白', '群聊开场白', '世界书', '正则', '脚本', '兼容文本', '兼容正则', '兼容脚本组', '助手变量', '兼容助手变量'], manifest.source);
  for (const key of ['角色', '文本', '备选开场白', '群聊开场白', '世界书', '正则', '脚本']) if (!Object.hasOwn(index, key)) throw new Error(`src/index.yaml 缺少 ${key}，清空内容请保留键并使用空列表/对象`);
  const fields = [], builds = [], sources = ['src/index.yaml'], worldOrder = []; const seenFiles = new Set(), seenKeys = new Set();
  const sourceRoot = (await fs.realpath(path.join(dir, 'src'))).toLowerCase() + path.sep;
  const sourcePath = async file => {
    if (typeof file !== 'string' || !file.startsWith('src/')) throw new Error(`源文件必须放在 src/: ${file}`);
    const resolved = await safeFile(dir, file); const canonical = (await fs.realpath(resolved)).toLowerCase();
    if (!canonical.startsWith(sourceRoot)) throw new Error(`源文件路径越界，必须在 src/: ${file}`);
    return { resolved, canonical };
  };
  const useFile = async (file, body = false) => {
    const { resolved, canonical } = await sourcePath(file);
    if (seenFiles.has(canonical)) throw new Error(`重复源文件引用或循环引用: ${file}`);
    seenFiles.add(canonical); sources.push(file);
    if (!body) return readYAML(dir, file);
    const extension = path.extname(file).toLowerCase();
    if (!['', '.md', '.txt', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.html', '.css', '.json', '.yaml', '.yml', '.ejs'].includes(extension)) throw new Error(`${file}: 正文必须是文本文件，不能使用 ${extension}`);
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await fs.readFile(resolved)); }
    catch (error) { throw new Error(`${file}: 无法读取 UTF-8 正文：${error.message}`); }
  };
  const body = async (file, pointer) => { const text = await useFile(file, true); fields.push({ pointer, file }); return text; };
  const registerBuild = async (config, pointer, label) => {
    strictKeys(config, ['类型', '入口'], `${label} 构建`);
    const { 类型: type, 入口: entry } = config;
    if (!['script', 'html', 'vue'].includes(type)) throw new Error(`${label}: 无效构建类型`);
    await sourcePath(entry); builds.push({ kind: type, entry, pointer });
  };
  const textReference = async (value, pointer) => {
    if (typeof value === 'string') return body(value, pointer);
    strictKeys(value, ['文件', '构建'], '文本引用');
    const text = await body(value.文件, pointer);
    if (value.构建 !== undefined) await registerBuild(value.构建, pointer, value.文件);
    return text;
  };
  const defaultWorld = (file) => ({ id: parseInt(sha256(file).slice(0, 12), 16), keys: [], secondary_keys: [], comment: path.basename(file, '.yaml'), content: '', enabled: true, constant: false, selective: true, insertion_order: 100, position: 'before_char', use_regex: false, extensions: { position: 0, depth: 4, role: 0, exclude_recursion: true, prevent_recursion: true } });
  const makeItem = async (kind, file, pointer) => {
    const config = await useFile(file); const map = kind === 'worldbook' ? WORLD : kind === 'regex' ? REGEX : SCRIPT;
    strictKeys(config, [...Object.keys(map), '关联', '附属文本', '构建', ...(kind === 'worldbook' ? ['文件', '激活', '位置', '角色', '分类'] : kind === 'regex' ? ['替换文件', '作用于'] : ['文件', '类型', '脚本', '数据文件'])], file);
    if (kind === 'worldbook' && Object.hasOwn(config, '分类')) validateWorldbookFolder(config.分类);
    let record;
    const association = config.关联 ?? Object.keys(state.records).find(key => state.records[key].file?.toLowerCase() === file.toLowerCase());
    if (association !== undefined) {
      if (typeof association !== 'string' || seenKeys.has(association)) throw new Error(`${file}: 重复或无效关联`);
      seenKeys.add(association); record = state.records[association];
      if (!record || record.kind !== kind) throw new Error(`${file}: 未知或不匹配的关联 ${association}`);
    }
    validateSettings(config, record?.config, file);
    if (kind === 'worldbook') worldOrder.push(association ?? null);
    const stableID = sha256(`${kind}:${file}`).slice(0, 32);
    const item = record ? clone(record.base) : kind === 'worldbook' ? defaultWorld(file) : kind === 'regex' ? { id: stableID, scriptName: '', findRegex: '', replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null } : { type: config.类型 === '文件夹' ? 'folder' : 'script', id: stableID, name: '', enabled: true, ...(config.类型 === '文件夹' ? { scripts: [] } : { content: '', info: '', button: { enabled: false, buttons: [] }, data: {} }) };
    overlay(item, config, map);
    if (kind === 'worldbook') {
      if (config.次要关键词逻辑 !== undefined) put(item, 'extensions.selectiveLogic', record && isDeepStrictEqual(config.次要关键词逻辑, record.config.次要关键词逻辑) ? record.base.extensions.selectiveLogic : enumValue(config.次要关键词逻辑, LOGIC, file));
      if (config.激活 !== undefined) {
        if (!['蓝灯', '绿灯', '向量'].includes(config.激活)) throw new Error(`${file}: 激活应为蓝灯、绿灯或向量`);
        if (!record || config.激活 !== record.config.激活) { item.constant = config.激活 === '蓝灯'; put(item, 'extensions.vectorized', config.激活 === '向量'); }
      }
      if (config.位置 !== undefined && (!record || !isDeepStrictEqual(config.位置, record.config.位置))) { const n = enumValue(config.位置, POSITIONS, file); put(item, 'extensions.position', n); item.position = n === 0 ? 'before_char' : 'after_char'; }
      if (config.角色 !== undefined && (!record || !isDeepStrictEqual(config.角色, record.config.角色))) put(item, 'extensions.role', enumValue(config.角色, ROLES, file));
    }
    if (kind === 'regex' && config.作用于 !== undefined) item.placement = record && isDeepStrictEqual(config.作用于, record.config.作用于) ? clone(record.base.placement) : list(config.作用于, file).map(v => enumValue(v, PLACEMENTS, file));
    if (kind === 'script') {
      if (config.数据文件 !== undefined) {
        if (Object.hasOwn(config, '数据')) throw new Error(`${file}: 数据和数据文件不能同时设置`);
        item.data = await useFile(config.数据文件);
        if (!object(item.data) && (!record || !isDeepStrictEqual(item.data, record.base.data))) throw new Error(`${file}: 数据文件必须包含对象`);
      }
      if (!['脚本', '文件夹'].includes(config.类型)) throw new Error(`${file}: 类型应为脚本或文件夹`);
      if (record && config.类型 !== record.config.类型) throw new Error(`${file}: 不支持直接改变类型，请新增条目`);
      if (config.类型 === '文件夹') {
        if (!Object.hasOwn(config, '脚本')) throw new Error(`${file}: 文件夹缺少脚本列表，清空请写 脚本: []`);
        item.scripts = [];
        for (const child of list(config.脚本 ?? [], file)) item.scripts.push(await makeItem('script', child, `${pointer}/scripts/${item.scripts.length}`));
      }
    }
    const bodyKey = kind === 'regex' ? 'replaceString' : 'content'; const source = kind === 'regex' ? config.替换文件 : config.文件;
    if (source !== undefined) item[bodyKey] = await body(source, `${pointer}/${bodyKey}`);
    else if (!(kind === 'script' && config.类型 === '文件夹')) throw new Error(`${file}: 缺少${kind === 'regex' ? '替换文件' : '文件'}`);
    if (config.构建 !== undefined) {
      if (!source) throw new Error(`${file}: 构建缺少正文文件`);
      await registerBuild(config.构建, `${pointer}/${bodyKey}`, file);
    }
    strictKeys(config.附属文本 ?? {}, Object.keys(record?.attachments ?? {}), `${file} 附属文本`);
    for (const [title, source] of Object.entries(config.附属文本 ?? {})) {
      const relative = record.attachments[title];
      setPointer(item, relative, await textReference(source, pointer + relative));
    }
    return item;
  };
  strictKeys(index.角色 ?? {}, Object.keys(ROLE), '角色'); validateSettings(index.角色 ?? {}, project(state.card.data, ROLE), '角色'); overlay(card.data, index.角色 ?? {}, ROLE);
  strictKeys(index.文本 ?? {}, Object.keys(TEXT), '文本');
  for (const key of Object.values(TEXT)) if (typeof card.data[key] === 'string') card.data[key] = '';
  for (const [title, file] of Object.entries(index.文本 ?? {})) card.data[TEXT[title]] = await textReference(file, `/data/${TEXT[title]}`);
  for (const [title, key] of [['备选开场白', 'alternate_greetings'], ['群聊开场白', 'group_only_greetings']]) {
    const files = list(index[title] ?? [], title);
    if (files.length || Object.hasOwn(card.data, key)) card.data[key] = [];
    for (const [i, file] of files.entries()) card.data[key].push(await textReference(file, `/data/${key}/${i}`));
  }
  const book = index.世界书 ?? { 条目: [] }; strictKeys(book, [...Object.keys(BOOK), '条目'], '世界书');
  if (!Object.hasOwn(book, '条目')) throw new Error('世界书缺少条目列表，清空请写 条目: []');
  validateSettings(book, project(state.card.data.character_book ?? {}, BOOK), '世界书');
  const entries = list(book.条目 ?? [], '世界书条目');
  if (card.data.character_book || entries.length || Object.keys(book).some(k => k !== '条目')) {
    card.data.character_book ??= { name: card.data.name, entries: [] }; overlay(card.data.character_book, book, BOOK);
    card.data.character_book.entries = [];
    for (const file of entries) card.data.character_book.entries.push(await makeItem('worldbook', file, `/data/character_book/entries/${card.data.character_book.entries.length}`));
    const previousOrder = Object.entries(state.records).filter(([, r]) => r.kind === 'worldbook').map(([key]) => key);
    if (!isDeepStrictEqual(worldOrder, previousOrder)) card.data.character_book.entries.forEach((entry, i) => put(entry, 'extensions.display_index', i));
  }
  for (const [root, title] of [['data.extensions', '正则'], ['extensions', '兼容正则']]) {
    const files = list(index[title] ?? [], title); const ext = get(card, root);
    if (files.length || Array.isArray(ext?.regex_scripts)) {
      const result = [];
      for (const file of files) result.push(await makeItem('regex', file, `/${root.replaceAll('.', '/')}/regex_scripts/${result.length}`));
      put(card, `${root}.regex_scripts`, result);
    }
  }
  const primary = state.groups.find(g => g.primary);
  const groups = [{ pointer: primary?.pointer ?? '/data/extensions/tavern_helper/scripts', files: index.脚本 ?? [], create: !primary }];
  const extra = list(index.兼容脚本组 ?? [], '兼容脚本组'); const groupKeys = new Set();
  for (const config of extra) {
    strictKeys(config, ['关联', '脚本'], '兼容脚本组');
    const group = state.groups.find(g => g.key === config.关联 && !g.primary);
    if (!group || groupKeys.has(config.关联)) throw new Error('未知或重复的兼容脚本组');
    groupKeys.add(config.关联); groups.push({ pointer: group.pointer, files: config.脚本 });
  }
  for (const g of state.groups.filter(g => !g.primary && !groupKeys.has(g.key))) groups.push({ pointer: g.pointer, files: [] });
  for (const group of groups) {
    const result = [];
    for (const file of list(group.files, '脚本')) result.push(await makeItem('script', file, `${group.pointer}/${result.length}`));
    if (group.create) { if (result.length) put(card, 'data.extensions.tavern_helper.scripts', result); }
    else setPointer(card, group.pointer, result);
  }
  for (const [title, target] of [['助手变量', 'data.extensions.tavern_helper.variables'], ['兼容助手变量', 'extensions.tavern_helper.variables']]) if (Object.hasOwn(index, title)) put(card, target, index[title]);
  strictKeys(index.兼容文本 ?? {}, Object.keys(state.text), '兼容文本');
  for (const [title, file] of Object.entries(index.兼容文本 ?? {})) setPointer(card, state.text[title], await textReference(file, state.text[title]));
  const unreferenced = Object.entries(state.records).filter(([key]) => !seenKeys.has(key)).map(([key, record]) => ({ association: key, name: record.config.名称 ?? '', file: record.file ?? null }));
  return { card, project: { ...manifest, fields, builds }, sources, unreferenced };
}

export async function writeContentNavigation(dir, name) {
  await write(path.join(dir, '内容导航.md'), '# 内容导航\n\n从 `src/index.yaml` 开始：总索引指定参与打包的条目；世界书注入顺序由位置、顺序、深度与角色决定，文件名不参与排序。修改正文到对应文本/代码文件；设置在同名 YAML 中。\n\n| 内容 | 位置 |\n| --- | --- |\n| 世界书 | `src/worldbook/**/*.yaml` 按分类放置设置 + `.md` 正文 |\n| 正则 | `src/regex/*.yaml` 查找与设置 + 同名 `.txt` 替换文本 |\n| 助手脚本 | `src/scripts/*.yaml` 设置 + `.js` 代码 |\n| 第一条消息 | `src/text/first_mes.md` |\n| 其他开场白 | `src/greetings/`，顺序见总索引 |\n| HTML/Vue 源码 | `src/ui/`（仅有此模块时） |\n| 项目依赖与头像 | `project.json` 的 dependencies / avatar |\n\n新卡默认将角色描写、性格、场景、对话示例留空，提示词主要写世界书；导入卡保留已有内容。添加条目时新建 YAML 和正文文件，在总索引引用；新条目省略“关联”，原有“关联”不改。移除引用就不再打包，文件可以保留。脚本文件夹的子项在文件夹 YAML 的“脚本”列表中管理。\n\n`.card/` 是工具维护的兼容数据，`original/` 是原件，均不手改。导入的界面只能保留卡内已有代码，不能自动还原成原始 Vue 工程。\n\n在仓库根运行 `pnpm card map "' + name + '"` 查看当前有效路径，`pnpm card build "' + name + '"` 生成到 `dist/' + name + '/`。\n');
}
