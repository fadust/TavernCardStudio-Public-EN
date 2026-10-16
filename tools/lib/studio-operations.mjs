import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';
import { normalizeAuthoringDocument } from './authoring-language.mjs';
import { ROOT, exists, safeName, safeFile, readJSON, writeJSON, write, walk } from './files.mjs';
import { listProjects, loadProject, splitCard } from './project.mjs';
import { helperScriptLists } from './authoring.mjs';
import { newCard } from './templates.mjs';
import { buildCard } from './build.mjs';
import { checkProject } from './validation.mjs';
import { parsePNG } from './png.mjs';
import { publishDirectory } from './publish.mjs';
import { organizeWorldbook } from './organize.mjs';
import { arrangeWorldbook } from './arrange.mjs';
import { worldbookInventory } from './worldbook-inventory.mjs';

export const MAX_UPLOAD = 64 * 1024 * 1024;
function nameOf(value) {
  safeName(value);
  if (value.length > 100) throw new Error('Project names must be at most 100 characters.');
  return value;
}
function decode(base64) {
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(MAX_UPLOAD / 3) * 4 || base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('File is empty, invalidly encoded, or exceeds 64 MiB.');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > MAX_UPLOAD || bytes.toString('base64') !== base64) throw new Error('File encoding is invalid or exceeds 64 MiB.');
  return bytes;
}
async function regularDirectory(dir, create = false) {
  if (create) await fs.mkdir(dir, { recursive: true });
  const entry = await fs.lstat(dir);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Symlinks and non-directory paths are unsupported: ${dir}`);
  return dir;
}
function countScripts(card) {
  let count = 0;
  const visit = list => { for (const item of list) { if (item?.type === 'folder') visit(item.scripts ?? []); else if (item && typeof item.content === 'string') count++; } };
  for (const ext of [card.data.extensions, card.extensions]) for (const group of helperScriptLists(ext?.tavern_helper, '')) visit(group.list);
  return count;
}
// UI receives only the fields needed to explain each order change.
function orderChanges(changes) {
  return (changes ?? []).map(change => ({ name: change.file, from: change.orderFrom == null ? 'unset' : String(change.orderFrom), to: String(change.orderTo) }));
}

export function createOperations({ root = ROOT, openFolder = async () => {} } = {}) {
  root = path.resolve(root);
  const cardsRoot = () => regularDirectory(path.join(root, 'cards'), true);
  async function projectDir(name) {
    await cardsRoot();
    return regularDirectory(path.join(root, 'cards', nameOf(name)));
  }
  async function available(name, except) {
    nameOf(name);
    const names = await listProjects(root);
    if (names.some(n => n !== except && n.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('A project with that name already exists. Choose another name; existing cards will not be overwritten.');
    if (name !== except && await exists(path.join(root, 'cards', name))) throw new Error('A path with that name already exists. Choose another name.');
  }
  async function listCards() {
    await cardsRoot();
    const cards = [];
    const official = new Set((await readJSON(path.join(ROOT, 'maintenance/public-release.json'))).examples);
    for (const name of await listProjects(root)) {
      try {
        await projectDir(name);
        const { card, project } = await loadProject(name, root);
        const text = value => typeof value === 'string' ? value : '';
        cards.push({ name, officialExample: official.has(name), characterName: text(card.data.name), creator: text(card.data.creator), version: text(card.data.character_version), tags: Array.isArray(card.data.tags) ? card.data.tags.filter(t => typeof t === 'string') : [], hasCover: !!project.avatar, importPath: project.original?.importPath ?? null,
          counts: { worldbook: card.data.character_book?.entries?.length ?? 0, regex: (card.data.extensions?.regex_scripts?.length ?? 0) + (card.extensions?.regex_scripts?.length ?? 0), scripts: countScripts(card), greetings: 1 + (card.data.alternate_greetings?.length ?? 0) + (card.data.group_only_greetings?.length ?? 0) } });
      } catch (error) { cards.push({ name, officialExample: official.has(name), characterName: '', hasCover: false, counts: {}, error: error.message }); }
    }
    return { ok: true, root, cards };
  }
  // Stage edits away from the active project; validate before publishing. Original imports stay byte-identical.
  async function edit(name, newName, mutate, copy = false) {
    nameOf(newName);
    const dir = await projectDir(name); await walk(dir); await loadProject(name, root);
    if (name !== newName && name.toLowerCase() === newName.toLowerCase()) throw new Error('To change only letter case, rename to a different name first, then rename back.');
    await available(newName, copy ? undefined : name);
    const staging = await fs.mkdtemp(path.join(root, 'cards/.tmp-studio-'));
    const backup = path.join(root, 'cards/.tmp-backup-' + randomUUID());
    try {
      await fs.cp(dir, staging, { recursive: true });
      const manifest = await readJSON(path.join(staging, 'project.json'));
      manifest.name = newName;
      await mutate(staging, manifest);
      await writeJSON(path.join(staging, 'project.json'), manifest);
      const nav = path.join(staging, 'CONTENTS.md');
      if (name !== newName && await exists(nav)) {
        let content = await fs.readFile(nav, 'utf8');
        content = content.replaceAll(`pnpm card map "${name}"`, `pnpm card map "${newName}"`).replaceAll(`pnpm card build "${name}"`, `pnpm card build "${newName}"`).replaceAll(`dist/${name}/`, `dist/${newName}/`);
        await write(nav, content);
      }
      // loadProject disallows .tmp names: validate the authoring body directly in its staging directory.
      if (manifest.schemaVersion === 2) {
        const { loadAuthoring } = await import('./authoring.mjs');
        await loadAuthoring(staging, manifest);
      }
      const destination = path.join(root, 'cards', newName);
      if (copy) {
        await available(newName);
        await fs.rename(staging, destination);
      } else if (name === newName) {
        await publishDirectory(staging, destination, backup);
      } else {
        await available(newName);
        await fs.rename(dir, backup);
        try { await fs.rename(staging, destination); }
        catch (error) { await fs.rename(backup, dir); throw error; }
        await fs.rm(backup, { recursive: true, force: true });
      }
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  // Read classification only when importing or organizing; listing every entry would slow down the card list.
  async function classificationOf(name) {
    const { worldbook, classification } = await worldbookInventory(await loadProject(name, root));
    const files = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
    return {
      supported: classification?.supported === true,
      total: Array.isArray(worldbook) ? worldbook.length : 0,
      pending: files(classification?.pending),
      pendingMoves: files(classification?.pendingMoves),
      instruction: typeof classification?.instruction === 'string' ? classification.instruction : '',
    };
  }
  return {
    listCards,
    async importCard({ filename, base64, name }) {
      if (typeof filename !== 'string' || !/\.(png|json)$/i.test(filename)) throw new Error('Choose a PNG or JSON character card. Add ordinary images using the cover action.');
      safeName(filename);
      await cardsRoot(); await available(name);
      const bytes = decode(base64);
      const work = await regularDirectory(path.join(root, 'work'), true);
      const temp = await fs.mkdtemp(path.join(work, 'studio-import-'));
      try {
        const file = path.join(temp, filename);
        await fs.writeFile(file, bytes);
        await splitCard(file, { root, name });
      } finally { await fs.rm(temp, { recursive: true, force: true }); }
      const manifest = await readJSON(path.join(root, 'cards', name, 'project.json'));
      return { ok: true, name, importPath: manifest.original.importPath, classification: await classificationOf(name), message: `Archived original: ${manifest.original.importPath}; editable source: cards/${name}/src; build output: dist/${name}. AI and manual builds read the same source files.` };
    },
    async newCard({ name, modules = [] }) {
      await cardsRoot(); await available(name);
      if (!Array.isArray(modules) || modules.some(m => typeof m !== 'string')) throw new Error('Invalid module list.');
      await newCard(name, { root, modules });
      return { ok: true, name, message: 'New card created. Open the source folder to continue writing.' };
    },
    async renameCard({ name, newName, characterName }) {
      nameOf(newName);
      if (characterName !== undefined && (typeof characterName !== 'string' || !characterName.trim() || characterName.length > 200 || /[\x00-\x1f]/.test(characterName))) throw new Error('Character display names must be nonempty and at most 200 characters.');
      await edit(name, newName, async (dir, manifest) => {
        if (characterName === undefined) return;
        if (manifest.schemaVersion === 2) {
          const file = await safeFile(dir, manifest.source);
          const document = parseDocument(await fs.readFile(file, 'utf8'));
          if (document.errors.length) throw new Error(document.errors[0].message);
          normalizeAuthoringDocument(document);
          document.setIn(['character', 'name'], characterName);
          await fs.writeFile(file, document.toString({ lineWidth: 0 }));
        } else {
          const file = await safeFile(dir, 'src/card.json'); const card = await readJSON(file);
          card.data.name = characterName;
          if (Object.hasOwn(card, 'name')) card.name = characterName;
          await writeJSON(file, card);
        }
      });
      return { ok: true, name: newName, message: 'Name saved. The original is unchanged. Build again to generate output with the new name; previous output remains in its original directory.' };
    },
    async duplicateCard({ name, newName }) {
      await edit(name, newName, async () => {}, true);
      return { ok: true, name: newName, message: 'Copy created; the source card is unchanged. Its character display name is retained and can be edited separately.' };
    },
    async setCover({ name, base64 }) {
      const bytes = decode(base64); const chunks = parsePNG(bytes);
      const width = chunks[0].data.readUInt32BE(0); const height = chunks[0].data.readUInt32BE(4);
      if (!width || !height || width > 8192 || height > 8192 || width * height > 24_000_000) throw new Error('Cover dimensions are invalid or too large. Choose an image of at most 24 megapixels.');
      // Keep only image chunks. Selecting another card as a cover must not retain its character data.
      const image = Buffer.concat([bytes.subarray(0, 8), ...chunks.filter(c => !['tEXt', 'zTXt', 'iTXt'].includes(c.type)).map(c => c.raw)]);
      await edit(name, name, async (dir, manifest) => {
        const relative = `src/assets/cover-${randomUUID()}.png`;
        await write(path.join(dir, relative), image);
        manifest.avatar = relative;
      });
      return { ok: true, name, message: 'Cover saved. Building again will produce both PNG and JSON character cards.' };
    },
    async removeCover({ name }) {
      await edit(name, name, async (_dir, manifest) => { manifest.avatar = null; });
      return { ok: true, name, message: 'Cover removed; its source image is retained. The next build produces only a JSON character card.' };
    },
    async cover(name) {
      const dir = await projectDir(name); const manifest = await readJSON(await safeFile(dir, 'project.json'));
      if (!manifest.avatar) throw new Error('This card has no cover.');
      return fs.readFile(await safeFile(dir, manifest.avatar));
    },
    async checkCard({ name }) {
      await projectDir(name);
      return { ok: true, report: (await checkProject(name, root)).report };
    },
    async buildCard({ name }) {
      const dir = await projectDir(name); await walk(dir);
      await regularDirectory(path.join(root, 'dist'), true);
      const target = path.join(root, 'dist', name);
      if (await exists(target)) { await regularDirectory(target); await walk(target); }
      return buildCard(name, root);
    },
    async organizeCard({ name }) {
      const dir = await projectDir(name); await walk(dir);
      // organize stages in cards/ and backs up to work/layout-backups/; both must be real directories.
      await regularDirectory(path.join(root, 'work'), true);
      await regularDirectory(path.join(root, 'work/layout-backups'), true);
      const result = await organizeWorldbook(name, root);
      const changes = Array.isArray(result.changes)
        ? result.changes.map(change => ({ from: String(change.from), to: String(change.to), bodyFrom: String(change.bodyFrom), bodyTo: String(change.bodyTo) }))
        : [];
      // Return classification state so AI can read remaining bodies, add category, and organize again.
      return { ok: true, name, organized: result.organized === true, backup: typeof result.backup === 'string' ? result.backup : null, changes, classification: await classificationOf(name) };
    },
    async arrangeCard({ name }) {
      const dir = await projectDir(name); await walk(dir);
      // arrange stages in cards/ and backs up to work/order-backups/; both must be real directories.
      await regularDirectory(path.join(root, 'work'), true);
      await regularDirectory(path.join(root, 'work/order-backups'), true);
      const result = await arrangeWorldbook(name, root);
      return {
        ok: true,
        name,
        arranged: result.arranged === true,
        order: result.order === 'index' ? 'index' : 'prompt',
        backup: typeof result.backup === 'string' ? result.backup : null,
        changes: orderChanges(result.changes),
        budgetNotice: typeof result.budgetNotice === 'string' ? result.budgetNotice : '',
      };
    },
    async open({ name, target }) {
      let dir;
      if (target === 'root') dir = root;
      else if (target === 'imports') dir = await regularDirectory(path.join(root, 'imports'), true);
      else if (target === 'card') dir = await projectDir(name);
      else if (target === 'source') dir = await safeFile(await projectDir(name), 'src');
      else if (target === 'dist') {
        await projectDir(name); await regularDirectory(path.join(root, 'dist'));
        dir = await regularDirectory(path.join(root, 'dist', name));
      } else throw new Error('Unknown folder type.');
      await openFolder(dir); return { ok: true };
    },
  };
}
