import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { parse } from 'acorn';
import { loadProject } from './project.mjs';
import { parsePNG } from './png.mjs';
import { exists, safeFile, getPointer, readJSON, walk } from './files.mjs';
import { auditResources, validateDependencies } from './resources.mjs';

export function regexParts(expression) {
  if (typeof expression !== 'string') throw new Error('findRegex must be a string.');
  const literal = expression.match(/^\/([\s\S]*)\/([a-z]*)$/i);
  const source = literal ? literal[1] : expression; const flags = literal ? literal[2] : '';
  new RegExp(source, flags); return { source, flags };
}
// Mirrors only the pinned ST replacement-group/trim stage. Macro expansion and trigger routing require the real host.
export function applyRegexFixture(regex, input) {
  const { source, flags } = regexParts(regex.findRegex);
  return vm.runInNewContext(`input.replace(new RegExp(source, flags), function () {
    const args = Array.from(arguments);
    return replacement.replace(/{{match}}/gi, '$0').replace(/\\$(\\d+)|\\$<([^>]+)>/g, (_, n, name) => {
      let value = n ? args[Number(n)] : args.at(-1)?.[name];
      if (!value) return '';
      if (typeof value !== 'string') value = String(value);
      for (const trim of trims) value = value.split(trim).join('');
      return value;
    });
  })`, { input, source, flags, replacement: regex.replaceString, trims: regex.trimStrings ?? [] }, { timeout: 200 });
}
export async function checkProject(name, root) {
  const loaded = await loadProject(name, root); const { card, project, dir } = loaded;
  const errors = []; const warnings = []; const external = new Set();
  for (const key of ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'creator', 'character_version']) {
    if (typeof card.data[key] !== 'string') errors.push(`data.${key} must be a string.`);
  }
  if (typeof card.data.name !== 'string' || !card.data.name.trim()) errors.push('Card name must not be empty.');
  if (card.spec_version !== (card.spec === 'chara_card_v2' ? '2.0' : '3.0')) errors.push('spec and spec_version do not match.');
  for (const key of ['alternate_greetings', 'tags']) if (!Array.isArray(card.data[key]) || card.data[key].some(x => typeof x !== 'string')) errors.push(`data.${key} must be an array of strings.`);
  if (project.name !== name) errors.push('project.name must match the card directory name.');
  errors.push(...validateDependencies(project.dependencies));
  if (project.avatar) try { parsePNG(await fs.readFile(await safeFile(dir, project.avatar))); } catch (error) { errors.push(`Avatar: ${error.message}`); }
  const entries = card.data.character_book?.entries;
  if (card.data.character_book && !Array.isArray(entries)) errors.push('character_book.entries must be an array.');
  for (const [i, entry] of (Array.isArray(entries) ? entries : []).entries()) {
    if (!entry || typeof entry !== 'object') { errors.push(`Worldbook ${i}: entry must be an object.`); continue; }
    if (typeof entry.content !== 'string') errors.push(`Worldbook ${i}: content must be a string.`);
    if (!Array.isArray(entry.keys)) errors.push(`Worldbook ${i}: keys must be an array.`);
    if (!entry.constant && entry.enabled && !entry.keys?.length && !entry.extensions?.vectorized) warnings.push(`Worldbook ${i}: enabled but has no constant/keyword/vector trigger.`);
  }
  const regexes = card.data.extensions?.regex_scripts ?? [];
  if (!Array.isArray(regexes)) errors.push('extensions.regex_scripts must be an array.');
  const ids = new Set();
  if (Array.isArray(regexes)) for (const regex of regexes) {
    if (!regex || typeof regex !== 'object') { errors.push('Regex entry must be an object.'); continue; }
    if (ids.has(regex.id)) errors.push(`Duplicate regex ID: ${regex.id}`); ids.add(regex.id);
    try { regexParts(regex.findRegex); } catch (error) { errors.push(`Regex ${regex.scriptName}: ${error.message}`); }
    if (typeof regex.replaceString !== 'string') errors.push(`Regex ${regex.scriptName}: replaceString must be a string.`);
    if (!Array.isArray(regex.placement)) errors.push(`Regex ${regex.scriptName}: placement must be an array.`);
    if (regex.substituteRegex) warnings.push(`Regex ${regex.scriptName}: pattern uses host macro substitution; static compilation cannot verify the expanded result.`);
  }
  const scriptIds = new Set();
  const validateScriptTree = value => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'script') {
      if (typeof value.content !== 'string') errors.push(`Script ${value.name ?? ''}: content must be a string.`);
      if (typeof value.id !== 'string' || !value.id) errors.push(`Script ${value.name ?? ''}: missing id.`);
      else if (scriptIds.has(value.id)) errors.push(`Duplicate script ID: ${value.id}`);
      scriptIds.add(value.id);
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') validateScriptTree(child);
  };
  validateScriptTree(card.data.extensions?.tavern_helper);
  const sourceFiles = await walk(path.join(dir, 'src'));
  const activeFiles = new Set([...(loaded.sources ?? []), ...project.fields.map(f => f.file), ...project.builds.map(b => b.entry)]);
  const controlled = /^src\/(?:worldbook|regex|scripts|text|greetings|legacy)\//;
  for (const file of sourceFiles) {
    const relative = path.relative(dir, file).split(path.sep).join('/');
    if (project.schemaVersion === 2 && controlled.test(relative) && !activeFiles.has(relative)) continue;
    if (project.schemaVersion === 2 && loaded.sources?.includes(relative) && !project.fields.some(f => f.file === relative)) continue;
    const extension = path.extname(file).toLowerCase();
    if (!['.md', '.txt', '.js', '.mjs', '.ts', '.html', '.css', '.vue', '.json', '.yaml', '.yml'].includes(extension)) continue;
    const content = await fs.readFile(file, 'utf8');
    if (['.js', '.mjs'].includes(extension)) {
      try { parse(content, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }); }
      catch (error) { errors.push(`${relative}: JavaScript syntax error: ${error.message}`); }
    }
    if (extension === '.ts') {
      try { const { transform } = await import('esbuild'); await transform(content, { loader: 'ts', logLevel: 'silent' }); }
      catch (error) { errors.push(`${relative}: TypeScript syntax error: ${error.message}`); }
    }
    if (extension === '.vue') {
      try {
        const { parse: parseSFC, compileScript, compileTemplate } = await import('vue/compiler-sfc');
        const parsed = parseSFC(content, { filename: file });
        if (parsed.errors.length) throw new Error(parsed.errors.join('; '));
        if (parsed.descriptor.script || parsed.descriptor.scriptSetup) compileScript(parsed.descriptor, { id: 'syntax-check' });
        if (parsed.descriptor.template) { const result = compileTemplate({ source: parsed.descriptor.template.content, filename: file, id: 'syntax-check' }); if (result.errors.length) throw new Error(result.errors.join('; ')); }
      } catch (error) { errors.push(`${relative}: Vue syntax error: ${error.message}`); }
    }
    if (content.includes('<%') && !['.js', '.mjs', '.ts', '.json'].includes(extension)) {
      try { const { default: ejs } = await import('ejs'); ejs.compile(content, { client: true, async: true }); }
      catch (error) { warnings.push(`${relative}: EJS standalone compilation failed (check cross-entry fragments in actual injection order): ${error.message.split('\n')[0]}`); }
    }
    if (extension === '.json' && relative === 'src/card.json') continue;
    const audit = await auditResources(content, { file: relative, dir, dependencies: project.dependencies, javascript: ['.js', '.mjs', '.ts'].includes(extension) });
    errors.push(...audit.errors); warnings.push(...audit.warnings); audit.external.forEach(url => external.add(url));
  }
  // Scan embedded runtime strings retained in unknown extensions, too, without executing them.
  const visit = async (value, pointer = '') => {
    if (typeof value === 'string' && !project.fields.some(f => f.pointer === pointer) && /<(script|img|iframe|link)\b|\b(?:fetch|import)\s*\(/.test(value)) {
      const audit = await auditResources(value, { file: `card.json:${pointer}`, dependencies: project.dependencies, javascript: !value.includes('<') });
      errors.push(...audit.errors); warnings.push(...audit.warnings); audit.external.forEach(url => external.add(url));
    } else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) await visit(child, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
  };
  await visit(card);
  let fixtureCount = 0;
  const fixtureFile = path.join(dir, 'tests/regex.json');
  if (await exists(fixtureFile)) {
    const fixtures = await readJSON(fixtureFile);
    if (!Array.isArray(fixtures)) errors.push('tests/regex.json must be an array.');
    else for (const fixture of fixtures) {
      const regex = regexes.find?.(r => r.id === fixture.id || r.scriptName === fixture.name);
      try {
        if (!regex) throw new Error(`Cannot find regex ${fixture.id ?? fixture.name}`);
        if (typeof fixture.input !== 'string' || typeof fixture.expected !== 'string') throw new Error('input and expected must be strings.');
        const actual = applyRegexFixture(regex, fixture.input);
        if (actual !== fixture.expected) throw new Error(`Replacement result does not match expected.`);
        fixtureCount++;
      } catch (error) { errors.push(`Regex fixture ${fixture.name ?? fixture.id}: ${error.message}`); }
    }
  }
  return { ...loaded, report: { name, ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], external: [...external], regexFixtures: fixtureCount, runtimeVerified: project.runtimeVerified } };
}
