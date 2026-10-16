import path from 'node:path';

const categories = { setting: 'setting', world: 'setting', lore: 'setting', geography: 'geography', place: 'geography', location: 'geography', character: 'characters', characters: 'characters', dossier: 'characters', rules: 'rules', mechanics: 'rules', events: 'events', factions: 'factions', organizations: 'organizations', items: 'items', species: 'species', variables: 'variables', 世界观: 'setting', 世界设定: 'setting', 设定: 'setting', 行话: 'setting', 地理: 'geography', 地点: 'geography', 区域: 'geography', 角色: 'characters', 人物: 'characters', 档案: 'characters', 搭档: 'characters', 规则: 'rules', 机制: 'rules', 事件: 'events', 势力: 'factions', 组织: 'organizations', 物品: 'items', 种族: 'species', 变量: 'variables' };

export function fileLabel(value) {
  let result = String(value || 'Untitled').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/[. ]+$/g, '').slice(0, 64).replace(/[. ]+$/g, '');
  if (!result || result === '.' || result === '..') result = 'Untitled';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = '_' + result;
  return result;
}

// Classify only explicit labels/protocols and a small set of conventional overview names.
// Neither content nor runtime injection position is used to guess an author's taxonomy.
export function worldbookLocation(title, folder) {
  const name = String(title || 'Untitled');
  const prefix = name.match(/^(?:\[([^\]]+)\]|【([^】]+)】|([^\s:：·-]+)\s*[-:：·])\s*(.+)$/u);
  const key = prefix && (prefix[1] ?? prefix[2] ?? prefix[3]);
  const category = Object.hasOwn(categories, key?.toLowerCase()) ? categories[key.toLowerCase()] : undefined;
  const protocol = /\[(?:initvar|mvu_update|config_override)\]/i.test(name) || ['variable list', '变量列表'].includes(name.toLowerCase());
  const overviews = { 'world setting': 'setting', 'world overview': 'setting', 'geography overview': 'geography', 'character overview': 'characters', 世界观: 'setting', 世界总览: 'setting', 地理总览: 'geography', 角色总览: 'characters', 人物总览: 'characters' };
  const overview = Object.hasOwn(overviews, name.toLowerCase()) ? overviews[name.toLowerCase()] : undefined;
  return { folder: folder ?? (protocol ? 'variables' : category ?? overview ?? 'uncategorized'), label: fileLabel(category ? prefix[4] : name) };
}

export function validateWorldbookFolder(folder) {
  if (typeof folder !== 'string' || !folder || folder.split('/').some(segment => fileLabel(segment) !== segment)) throw new Error(`Invalid worldbook category folder: ${folder}`);
  return folder;
}

export function allocateWorldbook(title, { folder, extensions = ['.md', '.yaml'], occupied = new Set() } = {}) {
  const location = worldbookLocation(title, folder);
  // Folder may be an existing user-chosen nested directory. Validate each segment before use.
  validateWorldbookFolder(location.folder);
  const stem = `src/worldbook/${location.folder}/${location.label}`;
  let candidate = stem, suffix = 2;
  while (extensions.some(ext => occupied.has((candidate + ext).toLowerCase()))) candidate = `${stem} (${suffix++})`;
  extensions.forEach(ext => occupied.add((candidate + ext).toLowerCase()));
  return candidate;
}

export function existingWorldbookFolder(file) {
  const directory = path.posix.dirname(file);
  return directory.startsWith('src/worldbook/') ? directory.slice('src/worldbook/'.length) : undefined;
}
