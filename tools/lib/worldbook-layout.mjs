import path from 'node:path';

const categories = { 世界观: '世界设定', 世界设定: '世界设定', 设定: '世界设定', 行话: '世界设定', 地理: '地理', 地点: '地理', 区域: '地理', 角色: '角色', 人物: '角色', 档案: '角色', 搭档: '角色', 规则: '规则', 机制: '规则', 事件: '事件', 势力: '势力', 组织: '组织', 物品: '物品', 种族: '种族', 变量: '变量' };

export function fileLabel(value) {
  let result = String(value || '未命名').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/[. ]+$/g, '').slice(0, 64).replace(/[. ]+$/g, '');
  if (!result || result === '.' || result === '..') result = '未命名';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = '_' + result;
  return result;
}

// Classify only explicit labels/protocols and a small set of conventional overview names.
// Neither content nor runtime injection position is used to guess an author's taxonomy.
export function worldbookLocation(title, folder) {
  const name = String(title || '未命名');
  const prefix = name.match(/^(?:\[([^\]]+)\]|【([^】]+)】|([^\s:：·-]+)\s*[-:：·])\s*(.+)$/u);
  const key = prefix && (prefix[1] ?? prefix[2] ?? prefix[3]);
  const category = Object.hasOwn(categories, key) ? categories[key] : undefined;
  const protocol = /\[(?:initvar|mvu_update|config_override)\]/i.test(name) || name === '变量列表';
  const overviews = { 世界观: '世界设定', 世界总览: '世界设定', 地理总览: '地理', 角色总览: '角色', 人物总览: '角色' };
  const overview = Object.hasOwn(overviews, name) ? overviews[name] : undefined;
  return { folder: folder ?? (protocol ? '变量' : category ?? overview ?? '未分类'), label: fileLabel(category ? prefix[4] : name) };
}

export function validateWorldbookFolder(folder) {
  if (typeof folder !== 'string' || !folder || folder.split('/').some(segment => fileLabel(segment) !== segment)) throw new Error(`无效世界书分类目录: ${folder}`);
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
