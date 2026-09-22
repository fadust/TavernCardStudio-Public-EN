import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { z } from 'zod';
import { ROOT } from '../tools/lib/files.mjs';
import { loadProject } from '../tools/lib/project.mjs';

// Explicitly reviewed, repository-owned sample only. Never discover or run user schemas.
const dir = path.join(ROOT, 'cards/示例-雾港调查局');
const compiled = await build({ entryPoints: [path.join(dir, 'src/schema.ts')], bundle: true, write: false, format: 'cjs', logLevel: 'silent' });
const moduleObject = { exports: {} };
vm.runInNewContext(compiled.outputFiles[0].text, { module: moduleObject, exports: moduleObject.exports, z });
const { Schema } = moduleObject.exports;
const plain = value => JSON.parse(JSON.stringify(value));

test('综合示例每个开场初值与结构一致，重复解析不改变状态', async () => {
  const { card } = await loadProject('示例-雾港调查局');
  assert.equal(card.data.name, '黛莉亚·克雷恩');
  const base = JSON.parse(card.data.character_book.entries.find(e => e.comment.includes('[initvar]')).content);
  const starts = [base, ...card.data.alternate_greetings.map(text => JSON.parse(text.match(/<initvar>([\s\S]*?)<\/initvar>/)[1]))];
  assert.equal(starts.length, 4);
  for (const initial of starts) {
    const parsed = Schema.parse(initial);
    assert.deepEqual(plain(parsed), { ...initial, 调查局: { ...initial.调查局, _进展: parsed.调查局._进展 } });
    assert.deepEqual(plain(Schema.parse(parsed)), plain(parsed));
    assert.equal(Object.keys(parsed.调查局.线索).length > 0, true);
  }
});

test('综合示例容器缺失可恢复，动态线索更新重算只读进展，非法数量与枚举失败', () => {
  const initial = Schema.parse({});
  assert.equal(initial.调查局._进展, '尚未建档');
  initial.调查局.线索 = { 账簿: { 状态: '已核实', 说明: '原件与抄件一致' } };
  initial.调查局._进展 = '旧摘要';
  initial.调查员.精力 = 130;
  const changed = Schema.parse(initial);
  assert.equal(changed.调查局._进展, '待核实 0 条 · 已核实 1 条 · 已排除 0 条');
  assert.equal(changed.调查员.精力, 100);
  assert.deepEqual(plain(Schema.parse(changed)), plain(changed));
  assert.equal(Schema.safeParse({ 调查局: { 物证: { 账簿: { 数量: -1 } } } }).success, false);
  assert.equal(Schema.safeParse({ 调查局: { 委托: { 阶段: '瞬间破案' } } }).success, false);
  assert.equal(Schema.safeParse({ 调查局: { 线索: { 账簿: { 状态: '已结案' } } } }).success, false);
});

test('综合示例 JSON Schema 编辑投影与已注册结构保持一致', async () => {
  const projection = JSON.parse(await fs.readFile(path.join(dir, 'src/variables/schema.json'), 'utf8'));
  assert.deepEqual(projection, plain(z.toJSONSchema(Schema, { io: 'input' })));
});
