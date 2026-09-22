import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isScalar, parseDocument } from 'yaml';
import { ROOT, walk, write, writeJSON, readJSON, jsonText, sha256 } from './files.mjs';
import { loadProject } from './project.mjs';
import { readYAML, loadAuthoring, writeContentNavigation } from './authoring.mjs';
import { allocateWorldbook, existingWorldbookFolder } from './worldbook-layout.mjs';
import { publishDirectory } from './publish.mjs';

async function snapshot(dir) {
  const result = {};
  for (const file of (await walk(dir)).sort()) result[path.relative(dir, file).split(path.sep).join('/')] = sha256(await fs.readFile(file));
  return result;
}

async function directory(root, segments) {
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try { await fs.mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`目录不能是链接或特殊文件: ${current}`);
  }
}

// Explicit opt-in for existing projects. No directory name changes runtime order or metadata.
export async function organizeWorldbook(name, root = ROOT) {
  const loaded = await loadProject(name, root);
  if (loaded.project.schemaVersion !== 2) throw new Error('请先用 card migrate 将旧工程迁移到 v2，再整理世界书。');
  await directory(root, ['cards', name]);
  const before = await snapshot(loaded.dir);
  const index = await readYAML(loaded.dir, 'src/index.yaml');
  const state = await readJSON(path.join(loaded.dir, '.card/state.json'));
  const occupied = new Set(Object.keys(before).map(file => file.toLowerCase()));
  const plans = [];
  for (const [i, file] of index.世界书.条目.entries()) {
    const config = await readYAML(loaded.dir, file);
    const body = config.文件;
    const extension = path.posix.extname(body);
    // Do not relocate executable entries or their relative import/include trees.
    const moveBody = body.startsWith('src/worldbook/') && ['.md', '.txt'].includes(extension) && !config.构建 && !loaded.project.builds.some(build => build.entry === body);
    const own = [file, ...(moveBody ? [body] : [])];
    own.forEach(value => occupied.delete(value.toLowerCase()));
    const stem = allocateWorldbook(config.名称 ?? loaded.card.data.character_book.entries[i].comment, { folder: config.分类 ?? existingWorldbookFolder(file), extensions: ['.yaml', ...(moveBody ? [extension] : [])], occupied });
    const target = stem + '.yaml'; const targetBody = moveBody ? stem + extension : body;
    // Keep old occupied paths reserved too: preserve unreferenced files and avoid move cycles.
    own.forEach(value => occupied.add(value.toLowerCase()));
    const key = config.关联 ?? Object.keys(state.records).find(key => state.records[key].file?.toLowerCase() === file.toLowerCase()) ?? `worldbook-${randomUUID()}`;
    if (target === file && targetBody === body && config.关联 === key && state.records[key]) continue;
    plans.push({ i, file, body, target, targetBody, key, config });
  }
  if (!plans.length) return { name, ok: true, organized: false, changes: [] };
  const temporary = await fs.mkdtemp(path.join(root, 'cards/.tmp-organize-'));
  const operation = randomUUID();
  const backup = path.join(root, 'work/layout-backups', `${name}-${operation}`);
  try {
    await fs.cp(loaded.dir, temporary, { recursive: true });
    for (const plan of plans) {
      const { i, file, body, target, targetBody, key, config } = plan;
      const doc = parseDocument(await fs.readFile(path.join(temporary, file), 'utf8'));
      doc.set('关联', key); doc.set('文件', targetBody);
      // Remove staged originals before writing so case-only renames also work on Windows.
      if (target !== file) await fs.unlink(path.join(temporary, file));
      await write(path.join(temporary, target), doc.toString({ lineWidth: 0 }));
      if (targetBody !== body) {
        const content = await fs.readFile(path.join(temporary, body));
        await fs.unlink(path.join(temporary, body));
        await write(path.join(temporary, targetBody), content);
      }
      state.records[key] ??= { kind: 'worldbook', base: structuredClone(loaded.card.data.character_book.entries[i]), config: structuredClone(config), attachments: {}, pointer: `/data/character_book/entries/${i}` };
      state.records[key].file = target;
      index.世界书.条目[i] = target;
    }
    // Pin the currently effective display indices too. Adding a record can make the
    // order equal to the stored record order, so loadAuthoring may stop deriving them.
    for (const [i, file] of index.世界书.条目.entries()) {
      const config = await readYAML(temporary, file);
      const key = config.关联 ?? Object.keys(state.records).find(key => state.records[key].file?.toLowerCase() === file.toLowerCase());
      const entry = loaded.card.data.character_book.entries[i];
      if (key && Object.hasOwn(entry.extensions ?? {}, 'display_index')) {
        state.records[key].base.extensions ??= {};
        state.records[key].base.extensions.display_index = entry.extensions.display_index;
      }
    }
    const indexDoc = parseDocument(await fs.readFile(path.join(temporary, 'src/index.yaml'), 'utf8'));
    // Keep index order and comments attached to each item.
    const list = indexDoc.getIn(['世界书', '条目'], true);
    for (const plan of plans) {
      if (isScalar(list.items[plan.i])) list.items[plan.i].value = plan.target;
      else list.set(plan.i, plan.target);
    }
    await write(path.join(temporary, 'src/index.yaml'), indexDoc.toString({ lineWidth: 0 }));
    const bytes = jsonText(state);
    await write(path.join(temporary, '.card/state.json'), bytes);
    const manifest = await readJSON(path.join(temporary, 'project.json'));
    manifest.state.sha256 = sha256(bytes);
    await writeJSON(path.join(temporary, 'project.json'), manifest);
    await writeContentNavigation(temporary, name);
    const next = await loadAuthoring(temporary, manifest);
    if (!isDeepStrictEqual(next.card, loaded.card) || !isDeepStrictEqual(next.project.builds, loaded.project.builds)) throw new Error('目录整理保真校验失败，原工程未改动。');
    if (!isDeepStrictEqual(await snapshot(loaded.dir), before)) throw new Error('整理期间工程发生变化，请结束其它编辑后重试；原工程未覆盖。');
    await directory(root, ['work', 'layout-backups']);
    await fs.cp(loaded.dir, backup, { recursive: true, errorOnExist: true, force: false });
    if (!isDeepStrictEqual(await snapshot(loaded.dir), before)) throw new Error('备份期间工程发生变化，请结束其它编辑后重试；原工程未覆盖。');
    await publishDirectory(temporary, loaded.dir, path.join(root, 'cards', `.tmp-layout-backup-${operation}`));
    return { name, ok: true, organized: true, backup: path.relative(root, backup).split(path.sep).join('/'), changes: plans.map(({ file, target, body, targetBody }) => ({ from: file, to: target, bodyFrom: body, bodyTo: targetBody })) };
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export { snapshot as snapshotProject, directory as ensureProjectDirectory };
