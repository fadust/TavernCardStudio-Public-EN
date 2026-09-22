// A conventional prompt layout, not an override for a host's editable prompt manager.
export function entryPosition(entry) {
  return entry.extensions?.position ?? (entry.position === 'before_char' ? 0 : 1);
}

export function planWorldbookOrder(entries, { order = 'prompt' } = {}) {
  if (!['prompt', 'index'].includes(order)) throw new Error('顺序模式只能是 prompt 或 index。');
  const rows = entries.map((entry, index) => ({ index, entry, position: entryPosition(entry) }));
  if (order === 'prompt') {
    const unknown = rows.filter(({ entry, position }) => entry.enabled !== false && (!Number.isFinite(entry.insertion_order) || ![0, 1, 4].includes(position) || (position === 4 && (!Number.isInteger(entry.extensions?.depth ?? 4) || (entry.extensions?.depth ?? 4) < 0 || ![0, 1, 2].includes(entry.extensions?.role ?? 0)))));
    if (unknown.length) throw new Error('存在依赖宿主布局的位置或缺失、异常的顺序设置，不能自动判断全局次序：' + unknown.map(({ entry, index }) => entry.comment || `条目 ${index + 1}`).join('、') + '。请核对宿主提示词后排好总索引，再使用 --order index。');
    const rank = row => row.entry.enabled === false ? 3 : row.position === 0 ? 0 : row.position === 1 ? 1 : 2;
    rows.sort((a, b) => {
      const group = rank(a) - rank(b);
      if (group) return group;
      if (rank(a) === 3) return a.index - b.index;
      if (a.position === 4) {
        const depth = (b.entry.extensions?.depth ?? 4) - (a.entry.extensions?.depth ?? 4);
        if (depth) return depth;
        // Locked script.js/doChatInject and openai.js/populationInjectionPrompts
        // insert SYSTEM, USER, ASSISTANT, then reverse the message array.
        const roleRank = { 2: 0, 1: 1, 0: 2 };
        const role = roleRank[a.entry.extensions?.role ?? 0] - roleRank[b.entry.extensions?.role ?? 0];
        if (role) return role;
      }
      return (a.entry.insertion_order ?? 100) - (b.entry.insertion_order ?? 100) || a.index - b.index;
    });
  }
  return rows.map(({ index }, i) => ({ index, order: i + 1 }));
}

export function orderNewWorldbook(book, folders = []) {
  if (!book) return folders;
  const entries = book.entries;
  const rows = planWorldbookOrder(entries);
  book.entries = rows.map(({ index, order }, i) => ({ ...entries[index], insertion_order: order, extensions: { ...entries[index].extensions, display_index: i } }));
  return rows.map(({ index }) => folders[index]);
}
