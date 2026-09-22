import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';
import { ROOT, exists, safeName, safeFile, readJSON, writeJSON, write, walk } from './files.mjs';
import { listProjects, loadProject, splitCard } from './project.mjs';
import { helperScriptLists } from './authoring.mjs';
import { newCard } from './templates.mjs';
import { buildCard } from './build.mjs';
import { checkProject } from './validation.mjs';
import { parsePNG } from './png.mjs';
import { publishDirectory } from './publish.mjs';

export const MAX_UPLOAD = 64 * 1024 * 1024;
function nameOf(value) {
  safeName(value);
  if (value.length > 100) throw new Error('工程名称请控制在 100 个字符以内。');
  return value;
}
function decode(base64) {
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(MAX_UPLOAD / 3) * 4 || base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('文件为空、编码无效或超过 64 MB。');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > MAX_UPLOAD || bytes.toString('base64') !== base64) throw new Error('文件编码无效或超过 64 MB。');
  return bytes;
}
async function regularDirectory(dir, create = false) {
  if (create) await fs.mkdir(dir, { recursive: true });
  const entry = await fs.lstat(dir);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`不支持链接或非文件夹路径：${dir}`);
  return dir;
}
function countScripts(card) {
  let count = 0;
  const visit = list => { for (const item of list) { if (item?.type === 'folder') visit(item.scripts ?? []); else if (item && typeof item.content === 'string') count++; } };
  for (const ext of [card.data.extensions, card.extensions]) for (const group of helperScriptLists(ext?.tavern_helper, '')) visit(group.list);
  return count;
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
    if (names.some(n => n !== except && n.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('同名工程已存在，请换一个名称；现有卡片不会被覆盖。');
    if (name !== except && await exists(path.join(root, 'cards', name))) throw new Error('该名称的路径已经存在，请换一个名称。');
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
    if (name !== newName && name.toLowerCase() === newName.toLowerCase()) throw new Error('仅修改英文字母大小写时，请先改成一个不同名称，再改回来。');
    await available(newName, copy ? undefined : name);
    const staging = await fs.mkdtemp(path.join(root, 'cards/.tmp-studio-'));
    const backup = path.join(root, 'cards/.tmp-backup-' + randomUUID());
    try {
      await fs.cp(dir, staging, { recursive: true });
      const manifest = await readJSON(path.join(staging, 'project.json'));
      manifest.name = newName;
      await mutate(staging, manifest);
      await writeJSON(path.join(staging, 'project.json'), manifest);
      const nav = path.join(staging, '内容导航.md');
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
  return {
    listCards,
    async importCard({ filename, base64, name }) {
      if (typeof filename !== 'string' || !/\.(png|json)$/i.test(filename)) throw new Error('请选择 PNG 或 JSON 角色卡。普通图片请在封面处添加。');
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
      return { ok: true, name, importPath: manifest.original.importPath, message: `完整原卡：${manifest.original.importPath}；拆分编辑区：cards/${name}/src；打包成品：dist/${name}。AI 和手动打包均读取同一份编辑文件。` };
    },
    async newCard({ name, modules = [] }) {
      await cardsRoot(); await available(name);
      if (!Array.isArray(modules) || modules.some(m => typeof m !== 'string')) throw new Error('模块列表无效。');
      await newCard(name, { root, modules });
      return { ok: true, name, message: '新卡已创建，可以打开内容文件夹继续编写。' };
    },
    async renameCard({ name, newName, characterName }) {
      nameOf(newName);
      if (characterName !== undefined && (typeof characterName !== 'string' || !characterName.trim() || characterName.length > 200 || /[\x00-\x1f]/.test(characterName))) throw new Error('角色显示名不能为空，最多 200 个字符。');
      await edit(name, newName, async (dir, manifest) => {
        if (characterName === undefined) return;
        if (manifest.schemaVersion === 2) {
          const file = await safeFile(dir, manifest.source);
          const document = parseDocument(await fs.readFile(file, 'utf8'));
          if (document.errors.length) throw new Error(document.errors[0].message);
          document.setIn(['角色', '名称'], characterName);
          await fs.writeFile(file, document.toString({ lineWidth: 0 }));
        } else {
          const file = await safeFile(dir, 'src/card.json'); const card = await readJSON(file);
          card.data.name = characterName;
          if (Object.hasOwn(card, 'name')) card.name = characterName;
          await writeJSON(file, card);
        }
      });
      return { ok: true, name: newName, message: '名称已保存。原件保持不变；请重新打包生成新名称的成品，旧成品保留在原目录。' };
    },
    async duplicateCard({ name, newName }) {
      await edit(name, newName, async () => {}, true);
      return { ok: true, name: newName, message: '副本已创建，源卡保留不变。角色显示名沿用原卡，可单独修改。' };
    },
    async setCover({ name, base64 }) {
      const bytes = decode(base64); const chunks = parsePNG(bytes);
      const width = chunks[0].data.readUInt32BE(0); const height = chunks[0].data.readUInt32BE(4);
      if (!width || !height || width > 8192 || height > 8192 || width * height > 24_000_000) throw new Error('封面尺寸过大或无效，请选择不超过 2400 万像素的图片。');
      // Keep only image chunks. Selecting another card as a cover must not retain its character data.
      const image = Buffer.concat([bytes.subarray(0, 8), ...chunks.filter(c => !['tEXt', 'zTXt', 'iTXt'].includes(c.type)).map(c => c.raw)]);
      await edit(name, name, async (dir, manifest) => {
        const relative = `src/assets/cover-${randomUUID()}.png`;
        await write(path.join(dir, relative), image);
        manifest.avatar = relative;
      });
      return { ok: true, name, message: '封面已保存。重新打包后会同时生成 PNG 角色卡与 JSON。' };
    },
    async removeCover({ name }) {
      await edit(name, name, async (_dir, manifest) => { manifest.avatar = null; });
      return { ok: true, name, message: '已取消封面，图片源文件保留。下一次打包仅生成 JSON 角色卡。' };
    },
    async cover(name) {
      const dir = await projectDir(name); const manifest = await readJSON(await safeFile(dir, 'project.json'));
      if (!manifest.avatar) throw new Error('这张卡还没有封面。');
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
    async open({ name, target }) {
      let dir;
      if (target === 'root') dir = root;
      else if (target === 'imports') dir = await regularDirectory(path.join(root, 'imports'), true);
      else if (target === 'card') dir = await projectDir(name);
      else if (target === 'source') dir = await safeFile(await projectDir(name), 'src');
      else if (target === 'dist') {
        await projectDir(name); await regularDirectory(path.join(root, 'dist'));
        dir = await regularDirectory(path.join(root, 'dist', name));
      } else throw new Error('未知的文件夹类型。');
      await openFolder(dir); return { ok: true };
    },
  };
}
