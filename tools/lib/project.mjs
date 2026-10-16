import path from 'node:path';
import fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, exists, safeName, safeFile, write, writeJSON, readJSON, sha256, jsonText, getPointer, setPointer, pointerKey, walk } from './files.mjs';
import { readCardPNG } from './png.mjs';
import { writeAuthoring, loadAuthoring, helperScriptLists } from './authoring.mjs';
import { publishDirectory } from './publish.mjs';
import { archiveImport } from './imports.mjs';
import { allocateWorldbook } from './worldbook-layout.mjs';

export function assertCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('The card must be a JSON object.');
  if (!['chara_card_v2', 'chara_card_v3'].includes(card.spec)) throw new Error(`Unsupported card format ${JSON.stringify(card.spec)}. V2/V3 PNG and JSON are supported; legacy cards and CHARX are not converted automatically.`);
  if (!card.data || typeof card.data !== 'object' || Array.isArray(card.data)) throw new Error('Card is missing its data object.');
}
function label(text) {
  return String(text || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 45) || 'Untitled';
}
export async function extractFields(card, projectDir, { worldbookFolders = [] } = {}) {
  const base = structuredClone(card); const fields = [];
  const add = async (pointer, file) => {
    const value = getPointer(base, pointer);
    if (typeof value !== 'string') return;
    await write(path.join(projectDir, file), value);
    fields.push({ pointer, file }); setPointer(base, pointer, '');
  };
  const texts = ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes'];
  for (const key of texts) {
    if (Object.hasOwn(base.data, key)) await add(`/data/${key}`, `src/text/${key}.md`);
    if (Object.hasOwn(base, key)) await add(`/${key}`, `src/legacy/${key}.md`);
  }
  if (typeof base.creatorcomment === 'string') await add('/creatorcomment', 'src/legacy/creatorcomment.md');
  for (const key of ['alternate_greetings', 'group_only_greetings']) {
    if (Array.isArray(base.data[key])) for (let i = 0; i < base.data[key].length; i++) await add(`/data/${key}/${i}`, `src/greetings/${key}-${i + 1}.md`);
  }
  if (Array.isArray(base.data.character_book?.entries)) {
    const occupied = new Set();
    for (let i = 0; i < base.data.character_book.entries.length; i++) {
      const entry = base.data.character_book.entries[i];
      if (typeof entry?.content === 'string') await add(`/data/character_book/entries/${i}/content`, allocateWorldbook(entry.comment || entry.name, { folder: worldbookFolders[i], occupied }) + '.md');
    }
  }
  for (const [root, ext] of [['/data/extensions', base.data.extensions], ['/extensions', base.extensions]]) {
    const prefix = root === '/extensions' ? 'legacy-' : '';
    if (Array.isArray(ext?.regex_scripts)) {
      for (let i = 0; i < ext.regex_scripts.length; i++) {
        const regex = ext.regex_scripts[i];
        if (typeof regex?.replaceString === 'string') await add(`${root}/regex_scripts/${i}/replaceString`, `src/regex/${prefix}${String(i + 1).padStart(3, '0')}-${label(regex.scriptName)}.txt`);
      }
    }
    let counter = 0;
    const visit = async (object, pointer) => {
      if (!object || typeof object !== 'object') return;
      if (!Array.isArray(object) && typeof object.content === 'string' && (object.type === 'script' || Object.hasOwn(object, 'id'))) {
        await add(`${pointer}/content`, `src/scripts/${prefix}${String(++counter).padStart(3, '0')}-${label(object.name)}.js`);
      }
      if (Array.isArray(object)) for (const [i, child] of object.entries()) await visit(child, `${pointer}/${i}`);
      else if (object.type === 'folder' && Array.isArray(object.scripts)) await visit(object.scripts, `${pointer}/scripts`);
    };
    for (const group of helperScriptLists(ext?.tavern_helper, `${root}/tavern_helper`)) await visit(group.list, group.pointer);
    if (typeof ext?.depth_prompt?.prompt === 'string') await add(`${root}/depth_prompt/prompt`, `src/text/${prefix}depth_prompt.md`);
  }
  await writeJSON(path.join(projectDir, 'src/card.json'), base);
  return fields;
}

export async function createProject(card, name, { root = ROOT, originalBytes, originalExtension = '.json', image, setup, formatVersion = 2, worldbookFolders } = {}) {
  assertCard(card); safeName(name);
  const cardsDir = path.join(root, 'cards'); await fs.mkdir(cardsDir, { recursive: true });
  const destination = path.join(cardsDir, name);
  if (await exists(destination)) throw new Error(`Already exists: ${destination}; refusing to overwrite existing edits. Use --name to choose a new name.`);
  const temporary = await fs.mkdtemp(path.join(cardsDir, '.tmp-'));
  try {
    const baseline = jsonText(card);
    await write(path.join(temporary, 'original/card.json'), baseline);
    const project = {
      schemaVersion: 1, name, modules: [], fields: await extractFields(card, temporary, { worldbookFolders }),
      avatar: null, builds: [], dependencies: [], runtimeVerified: null,
      original: { baseline: 'original/card.json', baselineSha256: sha256(baseline) },
    };
    if (originalBytes) {
      project.original.file = `original/input${originalExtension}`;
      project.original.sha256 = sha256(originalBytes);
      await write(path.join(temporary, project.original.file), originalBytes);
    }
    if (image) { project.avatar = 'src/assets/avatar.png'; await write(path.join(temporary, project.avatar), image); }
    await writeJSON(path.join(temporary, 'tests/regex.json'), []);
    await write(path.join(temporary, "AUTHORING.md"), '# Authoring notes\n\nThis file is not packaged or sent to the model.\n\n- Intended experience:\n- Character relationships and boundaries:\n- Remaining work:\n- Verified environment: no real SillyTavern session verified.\n');
    if (setup) await setup(project, temporary);
    await writeJSON(path.join(temporary, 'project.json'), project);
    if (formatVersion === 2) await writeAuthoring(temporary, card, project);
    // Windows can briefly deny a directory rename after its files have been written.
    // Retry only sharing/permission failures, and recheck the no-overwrite boundary each time.
    for (let attempt = 0; ; attempt++) {
      if (await exists(destination)) throw new Error(`Already exists: ${destination}; refusing to overwrite existing edits. Use --name to choose a new name.`);
      try { await fs.rename(temporary, destination); break; }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 3) throw error;
        await delay(50 * (2 ** attempt));
      }
    }
    return destination;
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true }); throw error;
  }
}
export async function splitCard(file, { name, root = ROOT, formatVersion = 2 } = {}) {
  const originalBytes = await fs.readFile(file); const extension = path.extname(file).toLowerCase();
  let card;
  if (extension === '.png') card = readCardPNG(originalBytes).card;
  else if (extension === '.json') {
    try { card = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(originalBytes).replace(/^\uFEFF/, '')); }
    catch (error) { throw new Error(`Invalid card JSON: ${error.message}`); }
  } else throw new Error('Only .png and .json character cards are supported.');
  assertCard(card);
  const projectName = name ?? path.basename(file, path.extname(file));
  safeName(projectName);
  if (await exists(path.join(root, 'cards', projectName))) throw new Error(`Already exists: ${projectName}; refusing to overwrite existing edits. Choose a new name.`);
  const archived = await archiveImport(root, path.basename(file), originalBytes);
  try {
    return await createProject(card, projectName, { root, originalBytes, originalExtension: extension, image: extension === '.png' ? originalBytes : undefined, formatVersion,
      setup: async project => { project.original.importPath = archived.relative; },
    });
  } catch (error) {
    if (archived.created) await fs.unlink(archived.file);
    throw error;
  }
}
export async function loadProject(name, root = ROOT) {
  safeName(name); const dir = path.join(root, 'cards', name);
  const project = await readJSON(path.join(dir, 'project.json'));
  if (project.schemaVersion === 2) {
    if (!Array.isArray(project.dependencies) || !Array.isArray(project.modules)) throw new Error('Unsupported project.json structure');
    if (project.original) for (const [file, hash] of [[project.original.baseline, project.original.baselineSha256], [project.original.file, project.original.sha256]]) {
      if (file && sha256(await fs.readFile(await safeFile(dir, file))) !== hash) throw new Error(`Original checksum failed; do not overwrite or edit original/: ${file}`);
    }
    if (project.avatar) await safeFile(dir, project.avatar);
    return { ...await loadAuthoring(dir, project), dir, root, name };
  }
  if (project.schemaVersion !== 1 || !Array.isArray(project.fields) || !Array.isArray(project.builds) || !Array.isArray(project.dependencies)) throw new Error(`${name}: unsupported project.json structure or version.`);
  const card = await readJSON(await safeFile(dir, 'src/card.json')); assertCard(card);
  const pointers = new Set(); const files = new Set();
  for (const field of project.fields) {
    if (!field || typeof field.pointer !== 'string' || typeof field.file !== 'string') throw new Error('fields must contain pointer and file.');
    if (pointers.has(field.pointer)) throw new Error(`Duplicate field mapping: ${field.pointer}`);
    if (files.has(field.file.toLowerCase())) throw new Error(`Duplicate source mapping: ${field.file}`);
    if (!field.file.startsWith('src/')) throw new Error(`Field sources must be inside src/: ${field.file}`);
    if (getPointer(card, field.pointer) !== '') throw new Error(`${field.pointer} was split; its src/card.json value must remain an empty string. Edit ${field.file}.`);
    setPointer(card, field.pointer, await fs.readFile(await safeFile(dir, field.file), 'utf8'));
    pointers.add(field.pointer); files.add(field.file.toLowerCase());
  }
  const buildTargets = new Set();
  for (const build of project.builds) {
    if (!['script', 'html', 'vue'].includes(build.kind)) throw new Error(`Unknown build type: ${build.kind}`);
    if (!pointers.has(build.pointer)) throw new Error(`Build target must be a split field: ${build.pointer}`);
    if (buildTargets.has(build.pointer)) throw new Error(`Multiple builds target the same field: ${build.pointer}`);
    await safeFile(dir, build.entry); buildTargets.add(build.pointer);
  }
  if (project.avatar) await safeFile(dir, project.avatar);
  if (project.original) {
    const original = project.original;
    for (const [file, hash] of [[original.baseline, original.baselineSha256], [original.file, original.sha256]]) {
      if (file && sha256(await fs.readFile(await safeFile(dir, file))) !== hash) throw new Error(`Original checksum failed; do not overwrite or edit original/: ${file}`);
    }
  }
  return { project, card, dir, root, name };
}
export async function migrateProject(name, root = ROOT) {
  const loaded = await loadProject(name, root);
  if (loaded.project.schemaVersion === 2) return { name, ok: true, migrated: false, reason: 'Already in authoring format v2' };
  await walk(loaded.dir); // Refuse links/special files before copying or writing a staged project.
  const temporary = await fs.mkdtemp(path.join(root, 'cards/.tmp-migrate-'));
  const backup = path.join(root, 'cards', `.tmp-backup-${Date.now()}-${name}`);
  try {
    await fs.cp(loaded.dir, temporary, { recursive: true });
    await write(path.join(temporary, '.card/migration-v1/project.json'), await fs.readFile(path.join(loaded.dir, 'project.json')));
    await write(path.join(temporary, '.card/migration-v1/src-card.json'), await fs.readFile(path.join(loaded.dir, 'src/card.json')));
    const manifest = await writeAuthoring(temporary, loaded.card, loaded.project);
    const roundtrip = await loadAuthoring(temporary, manifest);
    const sortedBuilds = builds => [...builds].sort((a, b) => a.pointer.localeCompare(b.pointer));
    if (!isDeepStrictEqual(roundtrip.card, loaded.card) || !isDeepStrictEqual(sortedBuilds(roundtrip.project.builds), sortedBuilds(loaded.project.builds))) throw new Error('Migration fidelity check failed; original project unchanged');
    await publishDirectory(temporary, loaded.dir, backup);
    return { name, ok: true, migrated: true, backup: '.card/migration-v1/', source: 'src/index.yaml' };
  } catch (error) { await fs.rm(temporary, { recursive: true, force: true }); throw error; }
}
export async function listProjects(root = ROOT) {
  const dir = path.join(root, 'cards'); if (!await exists(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter(e => e.isDirectory() && !e.name.startsWith('.tmp-')).map(e => e.name).sort();
}
export function semanticDiff(before, after, pointer = '') {
  if (isDeepStrictEqual(before, after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => {
      const location = `${pointer}/${pointerKey(key)}`;
      if (!Object.hasOwn(before, key)) return [{ pointer: location, change: 'added', after: after[key] }];
      if (!Object.hasOwn(after, key)) return [{ pointer: location, change: 'removed', before: before[key] }];
      return semanticDiff(before[key], after[key], location);
    });
  }
  return [{ pointer: pointer || '/', change: 'changed', before, after }];
}
