import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument, stringify } from 'yaml';
import { safeFile, inside, write, writeJSON, exists, sha256, jsonText, getPointer, setPointer } from './files.mjs';
import { validateWorldbookFolder } from './worldbook-layout.mjs';
import { normalizeAuthoring } from './authoring-language.mjs';

const TEXT = { description: 'description', personality: 'personality', scenario: 'scenario', first_mes: 'first_mes', mes_example: 'mes_example', creator_notes: 'creator_notes', system_prompt: 'system_prompt', post_history_instructions: 'post_history_instructions' };
const ROLE = { name: 'name', creator: 'creator', version: 'character_version', tags: 'tags' };
const BOOK = { name: 'name', description: 'description', scan_depth: 'scan_depth', token_budget: 'token_budget', recursive_scanning: 'recursive_scanning' };
const WORLD = { name: 'comment', enabled: 'enabled', keys: 'keys', secondary_keys: 'secondary_keys', selective: 'selective', use_regex: 'use_regex', order: 'insertion_order', depth: 'extensions.depth', probability: 'extensions.probability', use_probability: 'extensions.useProbability', selective_logic: 'extensions.selectiveLogic', scan_depth: 'extensions.scan_depth', case_sensitive: 'extensions.case_sensitive', match_whole_words: 'extensions.match_whole_words', exclude_recursion: 'extensions.exclude_recursion', prevent_recursion: 'extensions.prevent_recursion', delay_until_recursion: 'extensions.delay_until_recursion', ignore_budget: 'extensions.ignore_budget', group: 'extensions.group', group_override: 'extensions.group_override', group_weight: 'extensions.group_weight', sticky: 'extensions.sticky', cooldown: 'extensions.cooldown', delay: 'extensions.delay', outlet: 'extensions.outlet_name', automation_id: 'extensions.automation_id' };
const REGEX = { name: 'scriptName', find: 'findRegex', trim: 'trimStrings', disabled: 'disabled', display_only: 'markdownOnly', prompt_only: 'promptOnly', run_on_edit: 'runOnEdit', substitute_regex: 'substituteRegex', min_depth: 'minDepth', max_depth: 'maxDepth' };
const SCRIPT = { name: 'name', enabled: 'enabled', info: 'info', button: 'button', data: 'data', export_with: 'export_with', icon: 'icon', color: 'color' };
const POSITIONS = ["before_character", "after_character", "before_author_note", "after_author_note", "at_depth", "before_example_messages", "after_example_messages", "outlet"];
const ROLES = ["system", "user", "assistant"];
const PLACEMENTS = { legacy_display: 0, user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 };
const LOGIC = ["any", "not_all", "none", "all"];
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
    throw new Error(`${label}: enum value out of range: ${value}`);
  }
  const n = Array.isArray(names) ? names.indexOf(value) : names[value];
  if (n === undefined || n === -1) throw new Error(`${label}: unknown value: ${JSON.stringify(value)}`);
  return n;
}
function strictKeys(config, allowed, label) {
  if (!object(config)) throw new Error(`${label}: must be a settings object`);
  for (const key of Object.keys(config)) if (!allowed.includes(key)) throw new Error(`${label}: unknown setting: ${key}`);
}
function list(value, label) { if (!Array.isArray(value)) throw new Error(`${label}: must be a list`); return value; }
function validateSettings(config, previous, label) {
  const booleans = ["enabled", "selective", "use_regex", "use_probability", "case_sensitive", "match_whole_words", "exclude_recursion", "prevent_recursion", "ignore_budget", "group_override", "disabled", "display_only", "prompt_only", "run_on_edit", "recursive_scanning"];
  const numbers = ["order", "depth", "probability", "scan_depth", "group_weight", "sticky", "cooldown", "delay", "substitute_regex", "min_depth", "max_depth", "token_budget"];
  const strings = ["name", "creator", "version", "description", "group", "outlet", "automation_id", "find", "info", "icon", "color"];
  for (const [key, value] of Object.entries(config)) {
    if (previous && isDeepStrictEqual(value, previous[key])) continue; // Imported unusual values stay lossless until edited.
    if (booleans.includes(key) && !(value === null && ["case_sensitive", "match_whole_words"].includes(key)) && typeof value !== 'boolean') throw new Error(`${label}: ${key} must be true/false`);
    if (numbers.includes(key) && value !== null && (!Number.isFinite(value) || !Number.isInteger(value))) throw new Error(`${label}: ${key} must be an integer or null`);
    if (strings.includes(key) && typeof value !== 'string') throw new Error(`${label}: ${key} must be text (quote version numbers)`);
    if (["keys", "secondary_keys", "trim", "tags"].includes(key) && (!Array.isArray(value) || value.some(v => typeof v !== 'string'))) throw new Error(`${label}: ${key} must be a list of strings`);
    if (["button", "export_with"].includes(key) && !object(value)) throw new Error(`${label}: ${key} must be a settings object`);
    if (key === "button" && (typeof value.enabled !== 'boolean' || !Array.isArray(value.buttons) || value.buttons.some(button => !object(button) || typeof button.name !== 'string' || typeof button.visible !== 'boolean'))) throw new Error(`${label}: button must contain boolean enabled and buttons[{ name, visible }]`);
    if (key === "export_with" && Object.entries(value).some(([key, flag]) => !['data', 'button'].includes(key) || typeof flag !== 'boolean')) throw new Error(`${label}: export_with accepts only data/button boolean flags`);
    if (key === "data" && !object(value)) throw new Error(`${label}: data must be an object`);
  }
}
export async function readYAML(dir, file, { raw = false } = {}) {
  const doc = parseDocument(await fs.readFile(await safeFile(dir, file), 'utf8'), { uniqueKeys: true, strict: true });
  if (doc.errors.length || doc.warnings.length) throw new Error(`${file}: ${(doc.errors[0] ?? doc.warnings[0]).message}`);
  const value = doc.toJS({ maxAliasCount: 100 });
  const check = (v, ancestors = new Set()) => {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`${file}: non-finite numbers are unsupported`);
    if (v && typeof v === 'object') {
      if (ancestors.has(v)) throw new Error(`${file}: cyclic YAML aliases are unsupported`);
      const next = new Set(ancestors).add(v); Object.values(v).forEach(child => check(child, next));
    }
  };
  check(value); return raw ? value : normalizeAuthoring(value, file === 'src/index.yaml' ? 'root' : 'entry');
}
export async function writeYAML(dir, file, value) {
  const target = inside(dir, file); let ancestor = path.dirname(target);
  while (!(await exists(ancestor))) ancestor = path.dirname(ancestor);
  const relative = path.relative(await fs.realpath(dir), await fs.realpath(ancestor));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error(`Write path escapes the project: ${file}`);
  if (await exists(target)) await safeFile(dir, file);
  return write(target, stringify(value, { lineWidth: 0, aliasDuplicateObjects: false }));
}

function metadata(kind, base) {
  const config = project(base, kind === 'worldbook' ? WORLD : kind === 'regex' ? REGEX : SCRIPT);
  if (kind === 'worldbook') {
    config.activation = base.constant ? "constant" : base.extensions?.vectorized ? "vector" : "keyword";
    if (base.extensions?.position !== undefined) config.position = POSITIONS[base.extensions.position] ?? base.extensions.position;
    else if (base.position === 'before_char' || base.position === 'after_char') config.position = base.position === 'before_char' ? POSITIONS[0] : POSITIONS[1];
    if (base.extensions?.role !== undefined) config.role = ROLES[base.extensions.role] ?? base.extensions.role;
    if (base.extensions?.selectiveLogic !== undefined) config.selective_logic = LOGIC[base.extensions.selectiveLogic] ?? base.extensions.selectiveLogic;
  }
  if (kind === 'regex' && Array.isArray(base.placement)) config.placement = base.placement.map(n => Object.keys(PLACEMENTS).find(k => PLACEMENTS[k] === n) ?? n);
  if (kind === 'script') config.type = base.type === 'folder' ? "folder" : "script";
  return config;
}

// Only this module knows container locations. The editable files never contain JSON pointers.
export async function writeAuthoring(dir, card, manifest) {
  if (await exists(path.join(dir, 'src/index.yaml'))) throw new Error('src/index.yaml already exists; refusing to overwrite authoring settings');
  const state = { version: 2, card: clone(card), records: {}, groups: [], text: {} };
  const fields = new Map(manifest.fields.map(f => [f.pointer, f.file]));
  const builds = new Map(manifest.builds.map(b => [b.pointer, b]));
  const reference = (pointer, file) => builds.has(pointer) ? { file: file, build: { type: builds.get(pointer).kind, entry: builds.get(pointer).entry } } : file;
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
  const index = { character: project(card.data, ROLE), text: {}, alternate_greetings: [], group_only_greetings: [], worldbook: { entries: [] }, regex: [], scripts: [] };
  let sequence = 0;
  const saveItem = async (kind, base, pointer) => {
    if (!object(base)) throw new Error(`${pointer}: entry is not an object and cannot become authoring settings`);
    const contentKey = kind === 'regex' ? 'replaceString' : 'content';
    const folder = kind === 'script' && base.type === 'folder';
    const body = folder ? undefined : await ensureText(`${pointer}/${contentKey}`, `src/${kind === 'script' ? 'scripts' : kind}/import-${sequence + 1}.${kind === 'script' ? 'js' : kind === 'regex' ? 'txt' : 'md'}`);
    if (body) claimed.add(body);
    const key = `${kind}-${++sequence}`;
    const file = await configPath(body, kind, sequence);
    const config = { link: key, ...metadata(kind, base) };
    if (kind === 'script' && JSON.stringify(config.data ?? '').length > 2000) {
      const dataFile = file.replace(/\.yaml$/, '.data.yaml');
      await writeYAML(dir, dataFile, config.data); delete config.data; config.data_file = dataFile;
    }
    if (body) config[kind === 'regex' ? "replacement_file" : "file"] = body;
    const build = builds.get(`${pointer}/${contentKey}`);
    if (build) config.build = { type: build.kind, entry: build.entry };
    if (kind === 'script' && base.type === 'folder' && Array.isArray(base.scripts)) {
      config.scripts = [];
      for (const [i, child] of base.scripts.entries()) config.scripts.push(await saveItem('script', child, `${pointer}/scripts/${i}`));
    }
    const attachments = {};
    for (const field of manifest.fields) if (field.pointer.startsWith(pointer + '/') && !claimed.has(field.file)) {
      const label = path.basename(field.file); claimed.add(field.file);
      (config.attachments ??= {})[label] = reference(field.pointer, field.file);
      attachments[label] = field.pointer.slice(pointer.length);
    }
    state.records[key] = { kind, base: clone(base), config: clone(config), attachments, pointer, file };
    await writeYAML(dir, file, config); return file;
  };
  for (const [title, key] of Object.entries(TEXT)) {
    const pointer = `/data/${key}`; const file = await ensureText(pointer, `src/text/${key}.md`);
    if (file && (card.data[key] !== '' || key === 'first_mes' || builds.has(pointer))) index.text[title] = reference(pointer, file);
  }
  for (const [title, key] of [["alternate_greetings", 'alternate_greetings'], ["group_only_greetings", 'group_only_greetings']]) {
    if (Array.isArray(card.data[key])) {
      index[title] = [];
      for (const [i] of card.data[key].entries()) {
        const pointer = `/data/${key}/${i}`;
        const file = await ensureText(pointer, `src/greetings/${key}-${i + 1}.md`);
        if (!file) throw new Error(`${key}/${i}: greeting is not text and cannot become authoring settings`);
        index[title].push(reference(pointer, file));
      }
    }
  }
  if (card.data.character_book) {
    Object.assign(index.worldbook, project(card.data.character_book, BOOK));
    for (const [i, entry] of (card.data.character_book.entries ?? []).entries()) index.worldbook.entries.push(await saveItem('worldbook', entry, `/data/character_book/entries/${i}`));
  }
  for (const [root, ext, title] of [['/data/extensions', card.data.extensions, "regex"], ['/extensions', card.extensions, "legacy_regex"]]) {
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
        if (primary) index.scripts = files;
        else (index.legacy_script_groups ??= []).push({ link: groupKey, scripts: files });
        return;
      }
    };
    for (const group of helperScriptLists(ext?.tavern_helper, `${root}/tavern_helper`)) await saveGroup(group.list, group.pointer);
    if (object(ext?.tavern_helper) && Object.hasOwn(ext.tavern_helper, 'variables')) index[root === '/data/extensions' ? "helper_variables" : "legacy_helper_variables"] = clone(ext.tavern_helper.variables);
  }
  // Preserve all other extracted text through named references, including legacy mirrors and depth prompts.
  const used = new Set([...Object.values(TEXT).map(key => fields.get(`/data/${key}`)), ...[...index.alternate_greetings, ...index.group_only_greetings].map(v => typeof v === 'string' ? v : v.file)]);
  for (const file of claimed) used.add(file);
  for (const field of manifest.fields) if (!used.has(field.file)) {
    let title = field.file.replace(/^src\//, '').replace(/\.[^.]+$/, '');
    if (Object.hasOwn(state.text, title)) title = field.file.replace(/^src\//, '');
    (index.legacy_text ??= {})[title] = reference(field.pointer, field.file); state.text[title] = field.pointer;
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
  if (manifest.source !== 'src/index.yaml' || manifest.state?.file !== '.card/state.json') throw new Error('Invalid authoring project source/state settings');
  const stateBytes = await fs.readFile(await safeFile(dir, manifest.state.file));
  if (sha256(stateBytes) !== manifest.state.sha256) throw new Error('Compatibility data checksum failed: .card/ is tool-managed; do not edit it manually');
  const state = JSON.parse(stateBytes); const card = clone(state.card);
  for (const record of Object.values(state.records)) record.config = normalizeAuthoring(record.config);
  const index = await readYAML(dir, manifest.source);
  strictKeys(index, ["character", "text", "alternate_greetings", "group_only_greetings", "worldbook", "regex", "scripts", "legacy_text", "legacy_regex", "legacy_script_groups", "helper_variables", "legacy_helper_variables"], manifest.source);
  for (const key of ["character", "text", "alternate_greetings", "group_only_greetings", "worldbook", "regex", "scripts"]) if (!Object.hasOwn(index, key)) throw new Error(`src/index.yaml is missing ${key}; retain the key with an empty list/object to clear its content`);
  const fields = [], builds = [], sources = ['src/index.yaml'], worldOrder = []; const seenFiles = new Set(), seenKeys = new Set();
  const sourceRoot = (await fs.realpath(path.join(dir, 'src'))).toLowerCase() + path.sep;
  const sourcePath = async file => {
    if (typeof file !== 'string' || !file.startsWith('src/')) throw new Error(`Source files must be inside src/: ${file}`);
    const resolved = await safeFile(dir, file); const canonical = (await fs.realpath(resolved)).toLowerCase();
    if (!canonical.startsWith(sourceRoot)) throw new Error(`Source path escapes src/: ${file}`);
    return { resolved, canonical };
  };
  const useFile = async (file, body = false, raw = false) => {
    const { resolved, canonical } = await sourcePath(file);
    if (seenFiles.has(canonical)) throw new Error(`Duplicate or cyclic source reference: ${file}`);
    seenFiles.add(canonical); sources.push(file);
    if (!body) return readYAML(dir, file, { raw });
    const extension = path.extname(file).toLowerCase();
    if (!['', '.md', '.txt', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.html', '.css', '.json', '.yaml', '.yml', '.ejs'].includes(extension)) throw new Error(`${file}: body must be a text file, not ${extension}`);
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await fs.readFile(resolved)); }
    catch (error) { throw new Error(`${file}: cannot read UTF-8 body: ${error.message}`); }
  };
  const body = async (file, pointer) => { const text = await useFile(file, true); fields.push({ pointer, file }); return text; };
  const registerBuild = async (config, pointer, label) => {
    strictKeys(config, ["type", "entry"], `${label} build`);
    const { type: type, entry: entry } = config;
    if (!['script', 'html', 'vue'].includes(type)) throw new Error(`${label}: invalid build type`);
    await sourcePath(entry); builds.push({ kind: type, entry, pointer });
  };
  const textReference = async (value, pointer) => {
    if (typeof value === 'string') return body(value, pointer);
    strictKeys(value, ["file", "build"], 'text reference');
    const text = await body(value.file, pointer);
    if (value.build !== undefined) await registerBuild(value.build, pointer, value.file);
    return text;
  };
  const defaultWorld = (file) => ({ id: parseInt(sha256(file).slice(0, 12), 16), keys: [], secondary_keys: [], comment: path.basename(file, '.yaml'), content: '', enabled: true, constant: false, selective: true, insertion_order: 100, position: 'before_char', use_regex: false, extensions: { position: 0, depth: 4, role: 0, exclude_recursion: true, prevent_recursion: true } });
  const makeItem = async (kind, file, pointer) => {
    const config = await useFile(file); const map = kind === 'worldbook' ? WORLD : kind === 'regex' ? REGEX : SCRIPT;
    strictKeys(config, [...Object.keys(map), "link", "attachments", "build", ...(kind === 'worldbook' ? ["file", "activation", "position", "role", "category"] : kind === 'regex' ? ["replacement_file", "placement"] : ["file", "type", "scripts", "data_file"])], file);
    if (kind === 'worldbook' && Object.hasOwn(config, "category")) validateWorldbookFolder(config.category);
    let record;
    const association = config.link ?? Object.keys(state.records).find(key => state.records[key].file?.toLowerCase() === file.toLowerCase());
    if (association !== undefined) {
      if (typeof association !== 'string' || seenKeys.has(association)) throw new Error(`${file}: duplicate or invalid link`);
      seenKeys.add(association); record = state.records[association];
      if (!record || record.kind !== kind) throw new Error(`${file}: unknown or mismatched link: ${association}`);
    }
    validateSettings(config, record?.config, file);
    if (kind === 'worldbook') worldOrder.push(association ?? null);
    const stableID = sha256(`${kind}:${file}`).slice(0, 32);
    const item = record ? clone(record.base) : kind === 'worldbook' ? defaultWorld(file) : kind === 'regex' ? { id: stableID, scriptName: '', findRegex: '', replaceString: '', trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null } : { type: config.type === "folder" ? 'folder' : 'script', id: stableID, name: '', enabled: true, ...(config.type === "folder" ? { scripts: [] } : { content: '', info: '', button: { enabled: false, buttons: [] }, data: {} }) };
    overlay(item, config, map);
    if (kind === 'worldbook') {
      if (config.selective_logic !== undefined) put(item, 'extensions.selectiveLogic', record && isDeepStrictEqual(config.selective_logic, record.config.selective_logic) ? record.base.extensions.selectiveLogic : enumValue(config.selective_logic, LOGIC, file));
      if (config.activation !== undefined) {
        if (!["constant", "keyword", "vector"].includes(config.activation)) throw new Error(`${file}: activation must be constant, keyword, or vector`);
        if (!record || config.activation !== record.config.activation) { item.constant = config.activation === "constant"; put(item, 'extensions.vectorized', config.activation === "vector"); }
      }
      if (config.position !== undefined && (!record || !isDeepStrictEqual(config.position, record.config.position))) { const n = enumValue(config.position, POSITIONS, file); put(item, 'extensions.position', n); item.position = n === 0 ? 'before_char' : 'after_char'; }
      if (config.role !== undefined && (!record || !isDeepStrictEqual(config.role, record.config.role))) put(item, 'extensions.role', enumValue(config.role, ROLES, file));
    }
    if (kind === 'regex' && config.placement !== undefined) item.placement = record && isDeepStrictEqual(config.placement, record.config.placement) ? clone(record.base.placement) : list(config.placement, file).map(v => enumValue(v, PLACEMENTS, file));
    if (kind === 'script') {
      if (config.data_file !== undefined) {
        if (Object.hasOwn(config, "data")) throw new Error(`${file}: data and data_file are mutually exclusive`);
        item.data = await useFile(config.data_file, false, true);
        if (!object(item.data) && (!record || !isDeepStrictEqual(item.data, record.base.data))) throw new Error(`${file}: data_file must contain an object`);
      }
      if (!["script", "folder"].includes(config.type)) throw new Error(`${file}: type must be script or folder`);
      if (record && config.type !== record.config.type) throw new Error(`${file}: changing type in place is unsupported; create a new entry`);
      if (config.type === "folder") {
        if (!Object.hasOwn(config, "scripts")) throw new Error(`${file}: folder needs a scripts list; use scripts: [] to clear it`);
        item.scripts = [];
        for (const child of list(config.scripts ?? [], file)) item.scripts.push(await makeItem('script', child, `${pointer}/scripts/${item.scripts.length}`));
      }
    }
    const bodyKey = kind === 'regex' ? 'replaceString' : 'content'; const source = kind === 'regex' ? config.replacement_file : config.file;
    if (source !== undefined) item[bodyKey] = await body(source, `${pointer}/${bodyKey}`);
    else if (!(kind === 'script' && config.type === "folder")) throw new Error(`${file}: missing ${kind === 'regex' ? "replacement_file" : "file"}`);
    if (config.build !== undefined) {
      if (!source) throw new Error(`${file}: build needs a body file`);
      await registerBuild(config.build, `${pointer}/${bodyKey}`, file);
    }
    strictKeys(config.attachments ?? {}, Object.keys(record?.attachments ?? {}), `${file} attachments`);
    for (const [title, source] of Object.entries(config.attachments ?? {})) {
      const relative = record.attachments[title];
      setPointer(item, relative, await textReference(source, pointer + relative));
    }
    return item;
  };
  strictKeys(index.character ?? {}, Object.keys(ROLE), "character"); validateSettings(index.character ?? {}, project(state.card.data, ROLE), "character"); overlay(card.data, index.character ?? {}, ROLE);
  strictKeys(index.text ?? {}, Object.keys(TEXT), "text");
  for (const key of Object.values(TEXT)) if (typeof card.data[key] === 'string') card.data[key] = '';
  for (const [title, file] of Object.entries(index.text ?? {})) card.data[TEXT[title]] = await textReference(file, `/data/${TEXT[title]}`);
  for (const [title, key] of [["alternate_greetings", 'alternate_greetings'], ["group_only_greetings", 'group_only_greetings']]) {
    const files = list(index[title] ?? [], title);
    if (files.length || Object.hasOwn(card.data, key)) card.data[key] = [];
    for (const [i, file] of files.entries()) card.data[key].push(await textReference(file, `/data/${key}/${i}`));
  }
  const book = index.worldbook ?? { entries: [] }; strictKeys(book, [...Object.keys(BOOK), "entries"], "worldbook");
  if (!Object.hasOwn(book, "entries")) throw new Error('Worldbook needs an entries list; use entries: [] to clear it');
  validateSettings(book, project(state.card.data.character_book ?? {}, BOOK), "worldbook");
  const entries = list(book.entries ?? [], 'worldbook entry');
  if (card.data.character_book || entries.length || Object.keys(book).some(k => k !== "entries")) {
    card.data.character_book ??= { name: card.data.name, entries: [] }; overlay(card.data.character_book, book, BOOK);
    card.data.character_book.entries = [];
    for (const file of entries) card.data.character_book.entries.push(await makeItem('worldbook', file, `/data/character_book/entries/${card.data.character_book.entries.length}`));
    const previousOrder = Object.entries(state.records).filter(([, r]) => r.kind === 'worldbook').map(([key]) => key);
    if (!isDeepStrictEqual(worldOrder, previousOrder)) card.data.character_book.entries.forEach((entry, i) => put(entry, 'extensions.display_index', i));
  }
  for (const [root, title] of [['data.extensions', "regex"], ['extensions', "legacy_regex"]]) {
    const files = list(index[title] ?? [], title); const ext = get(card, root);
    if (files.length || Array.isArray(ext?.regex_scripts)) {
      const result = [];
      for (const file of files) result.push(await makeItem('regex', file, `/${root.replaceAll('.', '/')}/regex_scripts/${result.length}`));
      put(card, `${root}.regex_scripts`, result);
    }
  }
  const primary = state.groups.find(g => g.primary);
  const groups = [{ pointer: primary?.pointer ?? '/data/extensions/tavern_helper/scripts', files: index.scripts ?? [], create: !primary }];
  const extra = list(index.legacy_script_groups ?? [], "legacy_script_groups"); const groupKeys = new Set();
  for (const config of extra) {
    strictKeys(config, ["link", "scripts"], "legacy_script_groups");
    const group = state.groups.find(g => g.key === config.link && !g.primary);
    if (!group || groupKeys.has(config.link)) throw new Error('Unknown or duplicate legacy script group');
    groupKeys.add(config.link); groups.push({ pointer: group.pointer, files: config.scripts });
  }
  for (const g of state.groups.filter(g => !g.primary && !groupKeys.has(g.key))) groups.push({ pointer: g.pointer, files: [] });
  for (const group of groups) {
    const result = [];
    for (const file of list(group.files, "scripts")) result.push(await makeItem('script', file, `${group.pointer}/${result.length}`));
    if (group.create) { if (result.length) put(card, 'data.extensions.tavern_helper.scripts', result); }
    else setPointer(card, group.pointer, result);
  }
  for (const [title, target] of [["helper_variables", 'data.extensions.tavern_helper.variables'], ["legacy_helper_variables", 'extensions.tavern_helper.variables']]) if (Object.hasOwn(index, title)) put(card, target, index[title]);
  strictKeys(index.legacy_text ?? {}, Object.keys(state.text), "legacy_text");
  for (const [title, file] of Object.entries(index.legacy_text ?? {})) setPointer(card, state.text[title], await textReference(file, state.text[title]));
  const unreferenced = Object.entries(state.records).filter(([key]) => !seenKeys.has(key)).map(([key, record]) => ({ association: key, name: record.config.name ?? '', file: record.file ?? null }));
  return { card, project: { ...manifest, fields, builds }, sources, unreferenced };
}

export async function writeContentNavigation(dir, name) {
  await write(path.join(dir, "CONTENTS.md"), '# Content navigation\n\nStart at `src/index.yaml`: its lists select what gets packaged. Worldbook injection depends on position, order, depth, and role, not filenames. Edit body text/code in its source file and settings in the matching YAML.\n\n| Content | Location |\n| --- | --- |\n| Worldbook | `src/worldbook/**/*.yaml` settings by category, with `.md` bodies |\n| Regex | `src/regex/*.yaml` settings and matching `.txt` replacement |\n| Helper scripts | `src/scripts/*.yaml` settings and `.js` code |\n| First message | `src/text/first_mes.md` |\n| Other greetings | `src/greetings/`, ordered in the index |\n| HTML/Vue source | `src/ui/`, when included |\n| Dependencies and avatar | `project.json` dependencies / avatar |\n\nNew cards leave description, personality, scenario, and dialogue examples empty; choose traditional fields or worldbook entries for your content. Imported cards preserve existing fields. To add an entry, create its YAML and body and reference it in the index. Omit link for new entries; preserve existing links. Removing a reference excludes its content from builds without deleting the file. Script folder children are listed under scripts in the folder YAML.\n\n`.card/` contains tool-managed compatibility data and `original/` contains original snapshots. Do not edit either manually. Imported interfaces retain their embedded code; the original Vue project cannot be reconstructed automatically.\n\nRun `pnpm card map "' + name + '"` at the repository root to inspect active paths, or `pnpm card build "' + name + '"` to generate `dist/' + name + '/`.\n');
}
