import type { z as zod } from 'zod';

// 变量结构真源。运行时用的是酒馆助手内置的全局 z（见“内置第三方库”，用 z 变量访问），
// 与 registerMvuSchema 里的 instanceof / looseObject 判定是同一份实例，导入时就要求它已经存在。
// 所以这里只用 type import 取类型，绝不 import 一份运行时的 zod。
declare const z: typeof zod;

const clampTrust = (value: number) => Math.min(100, Math.max(0, value));

// 定义并导出变量结构，没有副作用：解析结果再解析一次仍是同一个结果。
export const Schema = z
  .object({
    场景: z
      .object({
        地点: z.string().prefault('初始场景'),
        阶段: z.string().prefault('开场'),
      })
      .prefault({}),
    角色: z
      .object({
        心情: z.string().prefault('平静'),
        信任: z.coerce.number().transform(clampTrust).meta({ minimum: 0, maximum: 100 }).prefault(0),
      })
      .prefault({}),
  })
  .meta({
    title: 'MVU 变量结构（schema.json 是它的投影）',
    description: '结构真源是本文件，由变量结构脚本用 registerMvuSchema 注册到运行时；src/variables/schema.json 是 z.toJSONSchema(Schema, { io: "input" }) 的投影，仅供人和编辑器参考。',
  });

export type Schema = zod.output<typeof Schema>;
