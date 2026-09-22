// 世界书顺序重排：只改总索引排列、各条目 YAML 的 顺序 与记录里的 display_index。
// 数值重排会改变跨位置预算优先级，因此不随 split／build／organize 自动执行。
// 次序、编号与展示序号都已到位才 noop；连续编号但缺 display_index 的导入卡在同一次重排里补齐。
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isScalar, parseDocument } from 'yaml';
import { ROOT, jsonText, readJSON, sha256, write, writeJSON } from './files.mjs';
import { loadAuthoring, readYAML } from './authoring.mjs';
import { loadProject, semanticDiff } from './project.mjs';
import { planWorldbookOrder } from './worldbook-order.mjs';
import { ensureProjectDirectory, snapshotProject } from './organize.mjs';
import { publishDirectory } from './publish.mjs';

export const ORDER_MODES = ['prompt', 'index'];
export const BUDGET_NOTICE = '按数值重排会改变跨位置预算优先级：顺序越大越早争取预算，最终落在所属区块靠后；实际落点还受位置、深度与宿主预算影响。改完在宿主的提示词预览里核对，这不是无损的文件整理。';

async function readDocument(file, label) {
  const doc = parseDocument(await fs.readFile(file, 'utf8'), { uniqueKeys: true, strict: true });
  const problem = doc.errors[0] ?? doc.warnings[0];
  if (problem) throw new Error(label + ': ' + problem.message);
  return doc;
}

function entryFiles(list, label) {
  if (!list || !Array.isArray(list.items)) throw new Error(label + ': 世界书缺少条目列表，清空请写 条目: []');
  return list.items.map((item, index) => {
    if (!isScalar(item) || typeof item.value !== 'string') throw new Error(label + ': 世界书条目必须是文本路径（第 ' + (index + 1) + ' 项）');
    return item.value;
  });
}

// 只重映射 /data/character_book/entries/<i>/... 这一段，其余指针原样返回。
function remapPointer(pointer, newPosition) {
  const parts = String(pointer).split('/');
  if (parts.length < 6 || parts[1] !== 'data' || parts[2] !== 'character_book' || parts[3] !== 'entries') return pointer;
  const at = Number(parts[4]);
  if (!Number.isInteger(at) || newPosition[at] === undefined) return pointer;
  parts[4] = String(newPosition[at]);
  return parts.join('/');
}

// 允许为原本没有 extensions 的条目新建容器：期望值只在原条目上改 顺序 与 display_index。
function expectedEntry(entry, newIndex) {
  const expected = structuredClone(entry);
  expected.insertion_order = newIndex + 1;
  expected.extensions = { ...(entry.extensions ?? {}), display_index: newIndex };
  return expected;
}

function cardOutline(card) {
  const copy = structuredClone(card);
  if (copy.data?.character_book) copy.data.character_book.entries = [];
  return copy;
}

function sortedBuilds(builds) {
  return [...(builds ?? [])]
    .map(build => ({ kind: build.kind, entry: build.entry, pointer: build.pointer }))
    .sort((a, b) => JSON.stringify([a.kind, a.entry, a.pointer]).localeCompare(JSON.stringify([b.kind, b.entry, b.pointer])));
}

async function verifyArrangement({ loaded, next, stagedDir, files, rows, newPosition, previousConfigs, changedFiles, before }) {
  const previous = loaded.card.data?.character_book?.entries ?? [];
  const current = next.card.data?.character_book?.entries ?? [];
  if (current.length !== previous.length) throw new Error('重排保真校验失败：条目数量发生变化，原工程未改动。');
  const outline = semanticDiff(cardOutline(loaded.card), cardOutline(next.card));
  if (outline.length) throw new Error('重排保真校验失败：世界书条目以外的卡片数据被修改（' + outline[0].pointer + '），原工程未改动。');
  for (let oldIndex = 0; oldIndex < previous.length; oldIndex += 1) {
    const newIndex = newPosition[oldIndex];
    if (newIndex === undefined) throw new Error('重排保真校验失败：条目顺序不完整，原工程未改动。');
    if (!isDeepStrictEqual(current[newIndex], expectedEntry(previous[oldIndex], newIndex))) throw new Error('重排保真校验失败：第 ' + (oldIndex + 1) + ' 条除 顺序 与 display_index 外还有改动，原工程未改动。');
  }
  const expected = (loaded.project.builds ?? []).map(build => ({ kind: build.kind, entry: build.entry, pointer: remapPointer(build.pointer, newPosition) }));
  if (!isDeepStrictEqual(sortedBuilds(expected), sortedBuilds(next.project.builds))) throw new Error('重排保真校验失败：构建绑定不能随索引重排映射，原工程未改动。');
  const stagedIndex = await readYAML(stagedDir, 'src/index.yaml');
  if (!isDeepStrictEqual(stagedIndex.世界书?.条目, rows.map(row => files[row.index]))) throw new Error('重排保真校验失败：总索引排列不正确，原工程未改动。');
  for (const row of rows) {
    const staged = await readYAML(stagedDir, files[row.index]);
    const diff = semanticDiff(previousConfigs[row.index], staged).filter(item => item.pointer !== '/顺序');
    if (diff.length) throw new Error('重排保真校验失败：' + files[row.index] + ' 除 顺序 外还有改动，原工程未改动。');
  }
  const staged = await snapshotProject(stagedDir);
  for (const relative of Object.keys(staged)) if (!Object.hasOwn(before, relative)) throw new Error('重排保真校验失败：新增了文件 ' + relative + '，原工程未改动。');
  for (const relative of Object.keys(before)) if (!Object.hasOwn(staged, relative)) throw new Error('重排保真校验失败：' + relative + ' 丢失，原工程未改动。');
  const allowed = new Set(['.card/state.json', 'project.json', ...changedFiles]);
  for (const [relative, hash] of Object.entries(staged)) if (!allowed.has(relative) && before[relative] !== hash) throw new Error('重排保真校验失败：' + relative + ' 被意外修改，原工程未改动。');
}

export async function arrangeWorldbook(name, root = ROOT, { order = 'prompt' } = {}) {
  if (!ORDER_MODES.includes(order)) throw new Error('顺序模式只能是 ' + ORDER_MODES.join(' 或 ') + '。');
  const loaded = await loadProject(name, root);
  if (loaded.project.schemaVersion !== 2) throw new Error('请先用 card migrate 将旧工程迁移到 v2，再重排世界书顺序。');
  await ensureProjectDirectory(root, ['cards', name]);
  const indexDoc = await readDocument(path.join(loaded.dir, 'src/index.yaml'), 'src/index.yaml');
  const files = entryFiles(indexDoc.getIn(['世界书', '条目'], true), 'src/index.yaml');
  const entries = loaded.card.data?.character_book?.entries ?? [];
  if (files.length !== entries.length) throw new Error('src/index.yaml 的条目数与卡片条目数不一致（' + files.length + ' / ' + entries.length + '），先运行 check。');
  const budgetNotice = BUDGET_NOTICE;
  if (!files.length) return { name, ok: true, arranged: false, order, backup: null, changes: [], budgetNotice };

  const previousConfigs = [];
  for (const file of files) previousConfigs.push(await readYAML(loaded.dir, file));
  const rows = planWorldbookOrder(entries, { order });
  const newPosition = [];
  rows.forEach((row, index) => { newPosition[row.index] = index; });
  const previousOrder = entries.map(entry => entry.insertion_order);
  const orderChanged = rows.some((row, index) => row.index !== index);
  const numbersChanged = rows.some((row, index) => previousOrder[row.index] !== index + 1);
  const displayChanged = rows.some((row, index) => entries[row.index].extensions?.display_index !== index);
  const changes = rows
    .map((row, index) => ({ name: entries[row.index].comment ?? '', file: files[row.index], from: row.index, to: index, orderFrom: previousOrder[row.index] ?? null, orderTo: index + 1 }))
    .filter(change => change.from !== change.to || change.orderFrom !== change.orderTo);
  if (!orderChanged && !numbersChanged && !displayChanged) return { name, ok: true, arranged: false, order, backup: null, changes: [], budgetNotice };

  // state 与工程快照都先取自磁盘；只有暂存副本全部通过校验才会动原工程。
  const state = await readJSON(path.join(loaded.dir, '.card/state.json'));
  const before = await snapshotProject(loaded.dir);
  const temporary = await fs.mkdtemp(path.join(root, 'cards/.tmp-arrange-'));
  const operation = randomUUID();
  const backup = path.join(root, 'work', 'order-backups', name + '-' + operation);
  const changedFiles = [];
  try {
    await fs.cp(loaded.dir, temporary, { recursive: true });
    if (orderChanged) {
      const stagedIndex = await readDocument(path.join(temporary, 'src/index.yaml'), 'src/index.yaml');
      const list = stagedIndex.getIn(['世界书', '条目'], true);
      if (!list || !Array.isArray(list.items) || list.items.length !== files.length) throw new Error('src/index.yaml: 世界书条目列表在暂存期间发生变化');
      // 复用原节点，只改次序：条目上的注释与行内注释跟着节点一起移动。
      const target = rows.map(row => list.items[row.index]);
      // YAML 把首条上方的注释挂在序列节点上；首条移位时把它还给那条，免得注释留给别的条目。
      if (list.commentBefore && target[0] !== list.items[0]) {
        const head = list.items[0];
        head.commentBefore = head.commentBefore ? list.commentBefore + '\n' + head.commentBefore : list.commentBefore;
        list.commentBefore = undefined;
      }
      list.items.splice(0, list.items.length, ...target);
      await write(path.join(temporary, 'src/index.yaml'), stagedIndex.toString({ lineWidth: 0 }));
      changedFiles.push('src/index.yaml');
    }
    for (const [entryIndex, file] of files.entries()) {
      const target = newPosition[entryIndex] + 1;
      if (previousOrder[entryIndex] === target && Object.hasOwn(previousConfigs[entryIndex], '顺序')) continue;
      const doc = await readDocument(path.join(temporary, file), file);
      doc.set('顺序', target);
      await write(path.join(temporary, file), doc.toString({ lineWidth: 0 }));
      changedFiles.push(file);
    }
    for (const [entryIndex, file] of files.entries()) {
      let key = previousConfigs[entryIndex].关联 ?? Object.keys(state.records).find(candidate => state.records[candidate].file?.toLowerCase() === file.toLowerCase());
      if (key === undefined) {
        // 手写条目还没有记录：补一条稳定身份，但不改动 YAML 里的 关联。
        key = 'worldbook-' + randomUUID();
        state.records[key] = { kind: 'worldbook', base: structuredClone(entries[entryIndex]), config: structuredClone(previousConfigs[entryIndex]), attachments: {}, pointer: '/data/character_book/entries/' + entryIndex, file };
      }
      const record = state.records[key];
      record.base ??= {};
      record.base.extensions ??= {};
      record.base.extensions.display_index = newPosition[entryIndex];
    }
    const bytes = jsonText(state);
    await write(path.join(temporary, '.card/state.json'), bytes);
    const manifest = await readJSON(path.join(temporary, 'project.json'));
    manifest.state.sha256 = sha256(bytes);
    await writeJSON(path.join(temporary, 'project.json'), manifest);
    const next = await loadAuthoring(temporary, manifest);
    await verifyArrangement({ loaded, next, stagedDir: temporary, files, rows, newPosition, previousConfigs, changedFiles, before });
    if (!isDeepStrictEqual(await snapshotProject(loaded.dir), before)) throw new Error('重排期间工程发生变化，请结束其它编辑后重试；原工程未覆盖。');
    await ensureProjectDirectory(root, ['work', 'order-backups']);
    await fs.cp(loaded.dir, backup, { recursive: true, errorOnExist: true, force: false });
    if (!isDeepStrictEqual(await snapshotProject(loaded.dir), before)) throw new Error('备份期间工程发生变化，请结束其它编辑后重试；原工程未覆盖。');
    await publishDirectory(temporary, loaded.dir, path.join(root, 'cards', '.tmp-order-backup-' + operation));
    return { name, ok: true, arranged: true, order, backup: path.relative(root, backup).split(path.sep).join('/'), changes, budgetNotice };
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
