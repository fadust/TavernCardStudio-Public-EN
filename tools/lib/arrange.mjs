// Reorder the worldbook index, entry order, and recorded display_index together.
// Renumbering changes budget priority, so split/build/organize never invoke it implicitly.
// Missing display_index values still require an update even when order values are consecutive.
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
import { normalizeAuthoringDocument } from './authoring-language.mjs';

export const ORDER_MODES = ['prompt', 'index'];
export const BUDGET_NOTICE = 'Renumbering changes budget priority across positions: larger order values compete for budget sooner but appear later in their block. Position, depth, and host budget also affect placement. Check the host prompt preview afterward; this operation changes prompt semantics.';

async function readDocument(file, label) {
  const doc = parseDocument(await fs.readFile(file, 'utf8'), { uniqueKeys: true, strict: true });
  const problem = doc.errors[0] ?? doc.warnings[0];
  if (problem) throw new Error(label + ': ' + problem.message);
  return normalizeAuthoringDocument(doc, label === 'src/index.yaml' ? 'root' : 'entry');
}

function entryFiles(list, label) {
  if (!list || !Array.isArray(list.items)) throw new Error(label + ': worldbook needs an entries list; use entries: [] to clear it');
  return list.items.map((item, index) => {
    if (!isScalar(item) || typeof item.value !== 'string') throw new Error(label + ': worldbook entries must be text paths (item ' + (index + 1) + ')');
    return item.value;
  });
}

// Remap only worldbook entry indices; preserve all other pointer segments.
function remapPointer(pointer, newPosition) {
  const parts = String(pointer).split('/');
  if (parts.length < 6 || parts[1] !== 'data' || parts[2] !== 'character_book' || parts[3] !== 'entries') return pointer;
  const at = Number(parts[4]);
  if (!Number.isInteger(at) || newPosition[at] === undefined) return pointer;
  parts[4] = String(newPosition[at]);
  return parts.join('/');
}

// An absent extensions container may be created only to store display_index.
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
  if (current.length !== previous.length) throw new Error('Arrangement fidelity check failed: entry count changed; original project unchanged.');
  const outline = semanticDiff(cardOutline(loaded.card), cardOutline(next.card));
  if (outline.length) throw new Error('Arrangement fidelity check failed: card data outside worldbook entries changed (' + outline[0].pointer + '); original project unchanged.');
  for (let oldIndex = 0; oldIndex < previous.length; oldIndex += 1) {
    const newIndex = newPosition[oldIndex];
    if (newIndex === undefined) throw new Error('Arrangement fidelity check failed: entry order is incomplete; original project unchanged.');
    if (!isDeepStrictEqual(current[newIndex], expectedEntry(previous[oldIndex], newIndex))) throw new Error('Arrangement fidelity check failed: entry ' + (oldIndex + 1) + ' changed beyond order/display_index; original project unchanged.');
  }
  const expected = (loaded.project.builds ?? []).map(build => ({ kind: build.kind, entry: build.entry, pointer: remapPointer(build.pointer, newPosition) }));
  if (!isDeepStrictEqual(sortedBuilds(expected), sortedBuilds(next.project.builds))) throw new Error('Arrangement fidelity check failed: build bindings could not be remapped; original project unchanged.');
  const stagedIndex = await readYAML(stagedDir, 'src/index.yaml');
  if (!isDeepStrictEqual(stagedIndex.worldbook?.entries, rows.map(row => files[row.index]))) throw new Error('Arrangement fidelity check failed: incorrect index order; original project unchanged.');
  for (const row of rows) {
    const staged = await readYAML(stagedDir, files[row.index]);
    const diff = semanticDiff(previousConfigs[row.index], staged).filter(item => item.pointer !== '/order');
    if (diff.length) throw new Error('Arrangement fidelity check failed: ' + files[row.index] + ' changed beyond order; original project unchanged.');
  }
  const staged = await snapshotProject(stagedDir);
  for (const relative of Object.keys(staged)) if (!Object.hasOwn(before, relative)) throw new Error('Arrangement fidelity check failed: unexpected new file ' + relative + '; original project unchanged.');
  for (const relative of Object.keys(before)) if (!Object.hasOwn(staged, relative)) throw new Error('Arrangement fidelity check failed: ' + relative + ' is missing; original project unchanged.');
  const allowed = new Set(['.card/state.json', 'project.json', ...changedFiles]);
  for (const [relative, hash] of Object.entries(staged)) if (!allowed.has(relative) && before[relative] !== hash) throw new Error('Arrangement fidelity check failed: ' + relative + ' changed unexpectedly; original project unchanged.');
}

export async function arrangeWorldbook(name, root = ROOT, { order = 'prompt' } = {}) {
  if (!ORDER_MODES.includes(order)) throw new Error('Order mode must be ' + ORDER_MODES.join(' or ') + '.');
  const loaded = await loadProject(name, root);
  if (loaded.project.schemaVersion !== 2) throw new Error('Run card migrate to upgrade the project to v2 before arranging its worldbook.');
  await ensureProjectDirectory(root, ['cards', name]);
  const indexDoc = await readDocument(path.join(loaded.dir, 'src/index.yaml'), 'src/index.yaml');
  const files = entryFiles(indexDoc.getIn(["worldbook", "entries"], true), 'src/index.yaml');
  const entries = loaded.card.data?.character_book?.entries ?? [];
  if (files.length !== entries.length) throw new Error('src/index.yaml entry count differs from the card (' + files.length + ' / ' + entries.length + '); run check first.');
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

  // Read state and the snapshot before staging; publish only after fidelity checks pass.
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
      const list = stagedIndex.getIn(["worldbook", "entries"], true);
      if (!list || !Array.isArray(list.items) || list.items.length !== files.length) throw new Error('src/index.yaml: worldbook entries changed during staging');
      // Move existing nodes so their comments follow the entries.
      const target = rows.map(row => list.items[row.index]);
      // YAML attaches the first comment to the sequence; return it to its entry before moving it.
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
      if (previousOrder[entryIndex] === target && Object.hasOwn(previousConfigs[entryIndex], "order")) continue;
      const doc = await readDocument(path.join(temporary, file), file);
      doc.set("order", target);
      await write(path.join(temporary, file), doc.toString({ lineWidth: 0 }));
      changedFiles.push(file);
    }
    for (const [entryIndex, file] of files.entries()) {
      let key = previousConfigs[entryIndex].link ?? Object.keys(state.records).find(candidate => state.records[candidate].file?.toLowerCase() === file.toLowerCase());
      if (key === undefined) {
        // Record a stable identity for a handwritten entry without changing its YAML link.
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
    if (!isDeepStrictEqual(await snapshotProject(loaded.dir), before)) throw new Error('Project changed during arrangement. Finish other edits and retry; original project was not overwritten.');
    await ensureProjectDirectory(root, ['work', 'order-backups']);
    await fs.cp(loaded.dir, backup, { recursive: true, errorOnExist: true, force: false });
    if (!isDeepStrictEqual(await snapshotProject(loaded.dir), before)) throw new Error('Project changed during backup. Finish other edits and retry; original project was not overwritten.');
    await publishDirectory(temporary, loaded.dir, path.join(root, 'cards', '.tmp-order-backup-' + operation));
    return { name, ok: true, arranged: true, order, backup: path.relative(root, backup).split(path.sep).join('/'), changes, budgetNotice };
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
