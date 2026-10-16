import { isAlias, isMap, isSeq, isScalar } from 'yaml';

// Legacy spellings are accepted only at authoring boundaries, never in card payloads.
export const LEGACY_KEYS = {
  角色: 'character', 文本: 'text', 备选开场白: 'alternate_greetings', 群聊开场白: 'group_only_greetings', 世界书: 'worldbook', 条目: 'entries', 正则: 'regex', 脚本: 'scripts',
  兼容文本: 'legacy_text', 兼容正则: 'legacy_regex', 兼容脚本组: 'legacy_script_groups', 助手变量: 'helper_variables', 兼容助手变量: 'legacy_helper_variables',
  角色描述: 'description', 性格: 'personality', 场景: 'scenario', 第一条消息: 'first_mes', 对话示例: 'mes_example', 创作者备注: 'creator_notes', 系统提示: 'system_prompt', 历史后提示: 'post_history_instructions',
  名称: 'name', 作者: 'creator', 版本: 'version', 标签: 'tags', 描述: 'description', 扫描深度: 'scan_depth', 预算: 'token_budget', 递归扫描: 'recursive_scanning',
  启用: 'enabled', 关键词: 'keys', 次要关键词: 'secondary_keys', 使用次要关键词: 'selective', 关键词使用正则: 'use_regex', 顺序: 'order', 深度: 'depth', 概率: 'probability', 使用概率: 'use_probability', 次要关键词逻辑: 'selective_logic', 区分大小写: 'case_sensitive', 全词匹配: 'match_whole_words', 不可被递归激活: 'exclude_recursion', 不可激活其他条目: 'prevent_recursion', 延迟到递归: 'delay_until_recursion', 忽略预算: 'ignore_budget', 分组: 'group', 覆盖分组: 'group_override', 分组权重: 'group_weight', 黏性: 'sticky', 冷却: 'cooldown', 延迟: 'delay', 出口: 'outlet', 自动化ID: 'automation_id',
  查找: 'find', 裁剪: 'trim', 禁用: 'disabled', 仅显示: 'display_only', 仅提示词: 'prompt_only', 编辑时运行: 'run_on_edit', 宏替换模式: 'substitute_regex', 最小深度: 'min_depth', 最大深度: 'max_depth',
  说明: 'info', 按钮: 'button', 数据: 'data', 导出设置: 'export_with', 图标: 'icon', 颜色: 'color', 关联: 'link', 附属文本: 'attachments', 构建: 'build', 文件: 'file', 激活: 'activation', 位置: 'position', 分类: 'category', 替换文件: 'replacement_file', 作用于: 'placement', 类型: 'type', 数据文件: 'data_file', 入口: 'entry',
};
export const LEGACY_VALUES = {
  蓝灯: 'constant', 绿灯: 'keyword', 向量: 'vector', 角色定义之前: 'before_character', 角色定义之后: 'after_character', 作者注之前: 'before_author_note', 作者注之后: 'after_author_note', 指定深度: 'at_depth', 示例消息之前: 'before_example_messages', 示例消息之后: 'after_example_messages', 出口: 'outlet', 系统: 'system', 用户: 'user', 助手: 'assistant', 旧版显示: 'legacy_display', 用户输入: 'user_input', AI输出: 'ai_output', 快捷命令: 'slash_command', 世界书: 'world_info', 推理: 'reasoning', 任一匹配: 'any', 不全部匹配: 'not_all', 全部不匹配: 'none', 全部匹配: 'all', 脚本: 'script', 文件夹: 'folder',
};
const ENUM_KEYS = new Set(['activation', 'position', 'role', 'selective_logic', 'placement', 'type']);
const OPAQUE_KEYS = new Set(['data', 'helper_variables', 'legacy_helper_variables', 'button', 'export_with']);
const LABEL_MAPS = new Set(['attachments', 'legacy_text']);
const canonicalKey = (key, context) => key === '角色' && context !== 'root' ? 'role' : Object.hasOwn(LEGACY_KEYS, key) ? LEGACY_KEYS[key] : key;
const canonicalValue = value => Object.hasOwn(LEGACY_VALUES, value) ? LEGACY_VALUES[value] : value;

export function normalizeAuthoring(value, context = 'entry') {
  if (OPAQUE_KEYS.has(context)) return value;
  if (Array.isArray(value)) return value.map(item => normalizeAuthoring(item, context));
  if (!value || typeof value !== 'object') return ENUM_KEYS.has(context) ? canonicalValue(value) : value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const canonical = LABEL_MAPS.has(context) ? key : canonicalKey(key, context);
    if (Object.hasOwn(result, canonical)) throw new Error(`Duplicate authoring setting: ${canonical}`);
    Object.defineProperty(result, canonical, { value: normalizeAuthoring(item, LABEL_MAPS.has(context) ? 'reference' : canonical), enumerable: true, writable: true, configurable: true });
  }
  return result;
}

// Keep YAML comments and node identity when editing a legacy document.
export function normalizeAuthoringDocument(doc, context = 'root') {
  // Detach aliases before translating anchors shared with opaque user payloads.
  const snapshot = doc.toJS({ maxAliasCount: 100 });
  function checkCycles(value, parents = new Set()) {
    if (!value || typeof value !== 'object') return;
    if (parents.has(value)) throw new Error('Cyclic YAML aliases are unsupported');
    parents.add(value);
    Object.values(value).forEach(item => checkCycles(item, parents));
    parents.delete(value);
  }
  checkCycles(snapshot);
  function detach(node, value) {
    if (isAlias(node)) {
      const copy = doc.createNode(value, { aliasDuplicateObjects: false });
      for (const key of ['comment', 'commentBefore', 'spaceBefore']) if (node[key] !== undefined) copy[key] = node[key];
      return copy;
    }
    if (isMap(node)) for (const pair of node.items) pair.value = detach(pair.value, value?.[pair.key?.value]);
    else if (isSeq(node)) node.items = node.items.map((item, index) => detach(item, value?.[index]));
    return node;
  }
  doc.contents = detach(doc.contents, snapshot);
  function convert(node, context) {
    if (OPAQUE_KEYS.has(context)) return;
    if (isMap(node)) {
      const seen = new Set();
      for (const pair of node.items) {
        if (!isScalar(pair.key)) continue;
        const key = LABEL_MAPS.has(context) ? pair.key.value : canonicalKey(pair.key.value, context);
        if (seen.has(key)) throw new Error(`Duplicate authoring setting: ${key}`);
        seen.add(key); pair.key.value = key;
        convert(pair.value, LABEL_MAPS.has(context) ? 'reference' : key);
      }
    } else if (isSeq(node)) node.items.forEach(item => convert(item, context));
    else if (isScalar(node) && ENUM_KEYS.has(context)) node.value = canonicalValue(node.value);
  }
  convert(doc.contents, context);
  return doc;
}
