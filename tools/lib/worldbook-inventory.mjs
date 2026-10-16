import { readYAML } from './authoring.mjs';
import { existingWorldbookFolder } from './worldbook-layout.mjs';
import { entryPosition } from './worldbook-order.mjs';

export async function worldbookInventory(loaded) {
  if (loaded.project.schemaVersion !== 2) return { worldbook: [], classification: { supported: false, pending: [], instruction: 'Migrate to v2 first, then classify entries by their body content.' } };
  const index = await readYAML(loaded.dir, 'src/index.yaml');
  const worldbook = [];
  for (const [i, file] of index.worldbook.entries.entries()) {
    const config = await readYAML(loaded.dir, file);
    const entry = loaded.card.data.character_book.entries[i];
    const directory = existingWorldbookFolder(file) ?? 'uncategorized';
    const category = config.category ?? directory;
    worldbook.push({ name: entry.comment ?? '', file, body: config.file, category, directory, needsClassification: category.split('/')[0] === 'uncategorized', needsMove: category !== directory, enabled: entry.enabled !== false, position: entryPosition(entry), depth: entry.extensions?.depth ?? 4, role: entry.extensions?.role ?? 0, order: entry.insertion_order });
  }
  return { worldbook, classification: { supported: true, pending: worldbook.filter(row => row.needsClassification).map(row => row.file), pendingMoves: worldbook.filter(row => row.needsMove).map(row => row.file), instruction: 'Read pending entry bodies in batches, set category in each entry YAML, then run card organize. Directories are separate from injection positions; the tool does not guess meaning.' } };
}
