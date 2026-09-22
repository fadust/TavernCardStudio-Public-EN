import { readYAML } from './authoring.mjs';
import { existingWorldbookFolder } from './worldbook-layout.mjs';
import { entryPosition } from './worldbook-order.mjs';

export async function worldbookInventory(loaded) {
  if (loaded.project.schemaVersion !== 2) return { worldbook: [], classification: { supported: false, pending: [], instruction: '先迁移到 v2，再按条目正文分类。' } };
  const index = await readYAML(loaded.dir, 'src/index.yaml');
  const worldbook = [];
  for (const [i, file] of index.世界书.条目.entries()) {
    const config = await readYAML(loaded.dir, file);
    const entry = loaded.card.data.character_book.entries[i];
    const directory = existingWorldbookFolder(file) ?? '未分类';
    const category = config.分类 ?? directory;
    worldbook.push({ name: entry.comment ?? '', file, body: config.文件, category, directory, needsClassification: category.split('/')[0] === '未分类', needsMove: category !== directory, enabled: entry.enabled !== false, position: entryPosition(entry), depth: entry.extensions?.depth ?? 4, role: entry.extensions?.role ?? 0, order: entry.insertion_order });
  }
  return { worldbook, classification: { supported: true, pending: worldbook.filter(row => row.needsClassification).map(row => row.file), pendingMoves: worldbook.filter(row => row.needsMove).map(row => row.file), instruction: '分批读取待分类条目的正文，按职责填写条目 YAML 的“分类”，再执行 card organize。目录不是注入位置；工具不做语义猜测。' } };
}
