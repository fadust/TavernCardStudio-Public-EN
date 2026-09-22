---
name: tavern-mvu-zod
description: 为 MVU 角色卡编写或审查 Zod 4 schema.ts、默认值、幂等转换、只读派生字段和运行时注册脚本；适用于变量结构及约束变更。
---

# MVU Zod 4

先读 [Zod 编写契约](../../../docs/MVU-ZOD.md)，按需查其中的锁定来源。这里的强制项是本仓库写卡规范；不要把模板偏好说成 Zod 库不支持其它语法。

## 核心要求

- `src/schema.ts` 只导入依赖并导出 `Schema`，不读写宿主、不注册事件。注册在独立脚本完成；JSON Schema 文件不会自行注册到 MVU。
- 使用 Zod 4；运行时沿用酒馆助手的全局 `z`，和注册适配器保持同一实例，不把另一份 Zod 打进卡。本地受信任测试可显式提供 Zod 4。本仓库没有 StageDog 模板的自动导入，不把 `@util/*` 别名、自动生成 schema.json 或 Pinia 支持凭空当作已有功能。
- 同一数据重复 parse 结果相等。transform 只规范化值、计算派生值；不用它增加计数、扣费、随机化或按每次解析刷新时间。
- 数字用 `z.coerce.number()`；布尔值用 `z.boolean()`；动态物品采用 `z.record(z.string(), ItemSchema)`。非有限数、空串转零等转换行为按业务决定是否允许。
- 可清空的容器用完整子字段 prefault 加外层 prefault。必填事实缺失时应报错，不用默认值把“未知”伪装成已经发生。
- 范围夹值、保留数量和舍入只在明确需求下添加。比较新旧值的单轮幅度限制进入 MVU 更新事件，不放在只有新值的 schema 中。
- `_` 与 `$` 前缀的权限在 MVU/注册适配器实现中核对；字段名不是前端写入或普通 helper API 的安全边界。
- 只依赖当前值的派生字段，优先在包含其基础字段的对象 transform 中重算，文档有 `_关系阶段` 示例。需要旧状态或外部事件才使用 `VARIABLE_UPDATE_ENDED`；事件写入的持久字段也必须在 Schema 声明，不能靠事件写入逃过后续结构处理。

## 验证与交付

对自编的受信任 Schema 做初值解析、越界输入、缺字段、容器 remove 后恢复、动态键和重复 parse 验证；如果含时间/随机转换，额外检查幂等。未经审查的导入卡代码不执行。

本地测试可复用 [mvu-template.test.mjs](../../../tests/mvu-template.test.mjs) 的 `loadTrustedSchema` 方法：esbuild 编译已审查源码，向测试上下文提供仓库锁定的 z，再验证 parse 与 `z.toJSONSchema(..., { io: 'input' })` 投影。vm 不是不可信代码的安全沙箱，只能用于已信任的源码。

`pnpm card check` 对任意卡只做语法/构建检查，不自动执行其 Schema。新增结构测试应显式选定受信任源码。真实运行还需观察初始化、更新、回滚/重生成后所在楼层的 `stat_data`。
