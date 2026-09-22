import type { z as zod } from 'zod';

// 变量结构真源。运行时用的是酒馆助手内置的全局 z（见“内置第三方库”，用 z 变量访问），
// 与 registerMvuSchema 里的 instanceof / looseObject 判定是同一份实例，导入时就要求它已经存在。
// 所以这里只用 type import 取类型，绝不 import 一份运行时的 zod。
declare const z: typeof zod;

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const 线索 = z.object({
  状态: z.enum(['待核实', '已核实', '已排除']).prefault('待核实'),
  说明: z.string().prefault(''),
});

const 人物 = z.object({
  立场: z.enum(['搭档', '合作', '中立', '回避', '敌意', '未知']).prefault('未知'),
  信任: z.coerce.number().transform(clampPercent).meta({ minimum: 0, maximum: 100 }).prefault(0),
  备注: z.string().prefault(''),
});

const 物证 = z.object({
  说明: z.string().prefault(''),
  数量: z.coerce.number().int().nonnegative().prefault(1),
});

// _进展是只读派生值：每次解析都按当前线索重算，模型不为它写更新规则。
function 统计进展(clues: Record<string, { 状态?: string }>) {
  const list = Object.values(clues ?? {});
  if (list.length === 0) return '尚未建档';
  const 已核实 = list.filter(item => item?.状态 === '已核实').length;
  const 已排除 = list.filter(item => item?.状态 === '已排除').length;
  return `待核实 ${list.length - 已核实 - 已排除} 条 · 已核实 ${已核实} 条 · 已排除 ${已排除} 条`;
}

export const Schema = z
  .object({
    雾港: z
      .object({
        时段: z.string().prefault('傍晚'),
        天气: z.string().prefault('浓雾'),
        雾况: z.coerce.number().transform(clampPercent).meta({ minimum: 0, maximum: 100 }).prefault(45),
      })
      .prefault({}),
    调查局: z
      .object({
        委托: z
          .object({
            编号: z.string().prefault('待挂案'),
            名称: z.string().prefault('暂无在办委托'),
            阶段: z.enum(['待命', '接案', '勘查', '核实', '结案']).prefault('待命'),
          })
          .prefault({}),
        线索: z.record(z.string().describe('线索名'), 线索).prefault({}),
        人物: z.record(z.string().describe('人物名'), 人物).prefault({}),
        物证: z.record(z.string().describe('物证名'), 物证).prefault({}),
        _进展: z.string().prefault('尚未建档'),
      })
      .transform(data => ({ ...data, _进展: 统计进展(data.线索) }))
      .prefault({}),
    调查员: z
      .object({
        精力: z.coerce.number().transform(clampPercent).meta({ minimum: 0, maximum: 100 }).prefault(80),
        权限: z.enum(['见习', '正式', '特派']).prefault('见习'),
        声望: z.coerce.number().transform(clampPercent).meta({ minimum: 0, maximum: 100 }).prefault(20),
      })
      .prefault({}),
  })
  .meta({
    title: '雾港调查局变量结构（schema.json 是它的投影）',
    description:
      '结构真源是本文件，由变量结构脚本用 registerMvuSchema 注册到运行时；src/variables/schema.json 是它的参考投影，仅供人和编辑器查看，不参与运行时校验。',
  });

export type Schema = zod.output<typeof Schema>;
