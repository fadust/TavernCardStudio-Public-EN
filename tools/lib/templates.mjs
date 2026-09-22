import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, readJSON, write, writeJSON, getPointer } from './files.mjs';
import { createProject } from './project.mjs';

export const MODULES = ['worldbook', 'regex', 'script', 'mvu', 'html', 'vue'];
// 世界书位置、深度注入角色与正则作用位置用宿主的数字枚举；模板可以写数字，也可以写可读名字。
// 枚举值对照 references/upstream/sillytavern：world_info_position、extension_prompt_roles、regex_placement。
const POSITION_NAMES = { before_char: 0, before_character_definition: 0, after_char: 1, after_character_definition: 1, before_anchor_top: 2, after_anchor_bottom: 3, at_depth: 4, at_depth_as_system: 4, at_depth_as_user: 4, at_depth_as_assistant: 4, before_em_top: 5, after_em_bottom: 6, outlet: 7 };
const ROLE_NAMES = { system: 0, user: 1, assistant: 2 };
const ROLE_FROM_POSITION = { at_depth_as_system: 0, at_depth_as_user: 1, at_depth_as_assistant: 2 };
const PLACEMENT_NAMES = { md_display: 0, user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 };
function enumValue(table, value, label) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  const key = String(value).toLowerCase();
  if (!Object.hasOwn(table, key)) throw new Error(`未知的${label} ${value}。可选: ${Object.keys(table).join(', ')}`);
  return table[key];
}
function newEntry(spec, index) {
  // 默认：普通条目放在角色定义之前；写了 depth 但没写 position 时按 @D0 深度注入处理（保持原有行为）。
  const position = spec.position === undefined ? (spec.depth === undefined ? 0 : 4) : enumValue(POSITION_NAMES, spec.position, '世界书条目位置');
  const derivedRole = typeof spec.position === 'string' ? ROLE_FROM_POSITION[spec.position.toLowerCase()] : undefined;
  const role = spec.role === undefined ? (derivedRole ?? 0) : enumValue(ROLE_NAMES, spec.role, '深度注入角色');
  return { id: index, keys: spec.keys ?? [], secondary_keys: spec.secondary_keys ?? [], comment: spec.comment, content: spec.content ?? '', constant: spec.constant ?? false, selective: spec.selective ?? true, enabled: spec.enabled ?? true, insertion_order: spec.insertion_order ?? 100 + index, position: position === 0 ? 'before_char' : 'after_char', use_regex: false,
    extensions: { position, depth: spec.depth ?? 4, role, probability: spec.probability ?? 100, useProbability: true, exclude_recursion: spec.exclude_recursion ?? true, prevent_recursion: spec.prevent_recursion ?? true, display_index: index } };
}
function newRegex(spec) {
  const placement = spec.placement === undefined ? [2] : (Array.isArray(spec.placement) ? spec.placement : [spec.placement]).map(value => enumValue(PLACEMENT_NAMES, value, '正则作用位置'));
  return { id: randomUUID(), scriptName: spec.scriptName, findRegex: spec.findRegex, replaceString: spec.replaceString ?? '', trimStrings: spec.trimStrings ?? [], placement, disabled: spec.disabled ?? false, markdownOnly: spec.markdownOnly ?? true, promptOnly: spec.promptOnly ?? false, runOnEdit: spec.runOnEdit ?? true, substituteRegex: spec.substituteRegex ?? 0, minDepth: spec.minDepth ?? null, maxDepth: spec.maxDepth ?? null };
}
function newScript(name, content) { return { type: 'script', enabled: true, name, id: randomUUID(), content, info: '', button: { enabled: false, buttons: [] }, data: {} }; }
export async function newCard(name, { modules = [], root = ROOT, templatesRoot = path.join(ROOT, 'templates') } = {}) {
  modules = [...new Set(modules)];
  for (const module of modules) if (!MODULES.includes(module)) throw new Error(`未知模块 ${module}。可选: ${MODULES.join(', ')}`);
  if (modules.includes('html') && modules.includes('vue')) throw new Error('初始模板请选择 html 或 vue 之一；同一卡后续可以手动添加多个独立界面。');
  const card = await readJSON(path.join(templatesRoot, 'base/card.json')); card.data.name = name;
  const bundlePointers = []; const uiJobs = []; const copies = []; const dependencies = []; const fixtures = [];
  const worldbook = () => (card.data.character_book ??= { name, entries: [] });
  const regexes = () => (card.data.extensions.regex_scripts ??= []);
  const scripts = () => (card.data.extensions.tavern_helper ??= { scripts: [], variables: {} }).scripts;
  for (const module of modules) {
    const dir = path.join(templatesRoot, 'modules', module); const spec = await readJSON(path.join(dir, 'module.json'));
    dependencies.push(...spec.dependencies ?? []); fixtures.push(...spec.fixtures ?? []);
    for (const entry of spec.worldbook ?? []) {
      const value = { ...entry, content: entry.contentFile ? await fs.readFile(path.join(dir, entry.contentFile), 'utf8') : entry.content };
      worldbook().entries.push(newEntry(value, worldbook().entries.length));
    }
    for (const regex of spec.regex ?? []) {
      const replaceString = regex.replacementFile ? (await fs.readFile(path.join(dir, regex.replacementFile), 'utf8')).replace(/\r?\n$/, '') : regex.replaceString;
      regexes().push(newRegex({ ...regex, replaceString }));
    }
    for (const script of spec.scripts ?? []) {
      const index = scripts().length;
      scripts().push(newScript(script.name, await fs.readFile(path.join(dir, script.source), 'utf8')));
      if (script.bundle) bundlePointers.push(`/data/extensions/tavern_helper/scripts/${index}/content`);
    }
    for (const [source, destination] of Object.entries(spec.files ?? {})) copies.push({ source: path.join(dir, source), destination });
    if (spec.ui) {
      // MVU supplies its own marker after updating a message; never ask the model to emit it.
      const marker = modules.includes('mvu') ? '<StatusPlaceHolderImpl/>' : spec.ui.marker;
      const pointer = `/data/extensions/regex_scripts/${regexes().length}/replaceString`;
      regexes().push(newRegex({ scriptName: '内嵌状态栏', findRegex: marker, replaceString: '<!-- 此字段由界面构建生成，请编辑 src/ui/ -->' }));
      // Remove only the display placeholder from model-facing history, leaving the displayed panel intact.
      regexes().push(newRegex({ scriptName: '屏蔽状态栏占位（仅提示词）', findRegex: marker, replaceString: '', markdownOnly: false, promptOnly: true }));
      if (!modules.includes('mvu')) {
        card.data.first_mes += '\n\n' + marker;
        worldbook().entries.push(newEntry({ comment: '状态栏输出位置', constant: true, position: 'at_depth_as_system', depth: 0, content: `界面占位:\n  输出: 每次正文结束后另起一行输出 ${marker}\n  用途: 为独立界面提供显示位置` }, worldbook().entries.length));
      }
      uiJobs.push({ source: path.join(dir, spec.ui.directory), kind: spec.ui.kind, pointer });
    }
  }
  if (modules.includes('mvu') && uiJobs.length === 0) {
    // No panel consumes the automatic marker: hide it without rewriting the stored message.
    regexes().push(newRegex({ scriptName: '隐藏MVU占位（无界面，仅显示）', findRegex: '<StatusPlaceHolderImpl/>', replaceString: '' }));
    regexes().push(newRegex({ scriptName: '屏蔽状态栏占位（仅提示词）', findRegex: '<StatusPlaceHolderImpl/>', replaceString: '', markdownOnly: false, promptOnly: true }));
  }
  return createProject(card, name, { root, setup: async (project, dir) => {
    project.modules = modules; project.dependencies = dependencies;
    for (const pointer of bundlePointers) project.builds.push({ kind: 'script', pointer, entry: project.fields.find(f => f.pointer === pointer).file });
    for (const job of uiJobs) {
      const destination = `src/ui/${job.kind}`;
      await fs.cp(job.source, path.join(dir, destination), { recursive: true });
      if (job.kind === 'vue') {
        if (modules.includes('mvu')) await fs.copyFile(path.join(dir, destination, 'App.mvu.vue'), path.join(dir, destination, 'App.vue'));
        await fs.unlink(path.join(dir, destination, 'App.mvu.vue'));
      }
      project.builds.push({ kind: job.kind, entry: `${destination}/index.html`, pointer: job.pointer });
    }
    for (const copy of copies) await write(path.join(dir, copy.destination), await fs.readFile(copy.source));
    await writeJSON(path.join(dir, 'tests/regex.json'), fixtures);
  } });
}
