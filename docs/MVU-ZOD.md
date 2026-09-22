# MVU Zod 4 编写契约

这份文档约束本仓库新建 MVU 卡的变量结构。它参考锁定的 StageDog 模板、MVU 与 `registerMvuSchema` 实现；区分运行机制、仓库规范与作者可选设计，不把上游某条写作偏好伪装成 Zod API 限制。

## 源码与注册分离

`src/schema.ts` 是结构定义的单一来源：只导出 `Schema`，不注册事件、不读取宿主状态、不修改变量。注册脚本 import 该结构并调用 `registerMvuSchema`；框架加载脚本单独保留。构建将自写结构合入注册脚本，公开 MVU/适配器保留固定提交 URL 并登记到 `project.json.dependencies`。

运行时用酒馆助手提供的全局 **Zod 4 `z`**。锁定注册器使用 `instanceof z.ZodObject` 和宿主的 `z.looseObject(shape)` 处理传入结构；Zod 4 的 instanceof 不一定拒绝跨副本对象，但不同版本内部结构仍可能不兼容。因此不把另一份 Zod runtime 打进卡；本地受信任测试显式提供同一个 Zod 4 实例。TypeScript 类型导入不会成为运行时 import。

本仓库没有上游 webpack 自动导入与 schema.json 生成链。`schema.json` 如存在仅作编辑辅助，不能代替 Schema 注册；也不能宣称修改 JSON 后运行时会自动更新。今后需要导出 JSON Schema 时，另建显式的受信任生成流程，不在 `card check` 中执行任意导入卡代码。

## 必须满足的结构性质

### 重复解析不改变结果

`Schema.parse(Schema.parse(input))` 必须与第一次结果相等。MVU 更新、UI 读取或归一化可能多次调用 Schema；transform 里累计加分、扣费、每次 `Date.now()`、随机生成会造成数据漂移。

派生字段应由基础值重新计算；容量限制或去重应稳定。真需要记录新键创建时间时，只在字段缺失时给一次初值，并在二次 parse 中保留它；排序不能偷偷改写时间。

### 输入类型与容器

| 需要 | 规范写法 |
| --- | --- |
| 数字 | 优先 `z.coerce.number()`；按需求处理有限数、空串与 null |
| 布尔 | `z.boolean()`，不使用会把字符串 `"false"` 转真的 `z.coerce.boolean()` |
| 固定异类型字段 | `z.object({ ... })` |
| 固定同类型且所有键必需 | `z.record(z.enum(['头部', '身体']), ValueSchema)` |
| 固定同类型且允许缺键 | `z.partialRecord(z.enum([...]), ValueSchema)` |
| 任意物品/任务名 | `z.record(z.string().describe('物品名'), ItemSchema)` |
| 有先后顺序、必须支持重复元素的序列 | 可以用 `z.array(...)`，同时设计下标更新与删除规则 |

物品栏通常更适合按名字映射，数组并非框架禁止。Zod 4 的 record 明确写 key schema 和 value schema，不沿用 Zod 3 单参示例。Zod 4 对 enum 键的 record 会检查键完整性，可选集合用 partialRecord。

### prefault 与缺失值

优先用 `.prefault(inputDefault)`，让默认输入仍经过校验/transform；`.default(outputDefault)` 会在 undefined 时直接返回默认输出，不能假定执行了转换。缺失时填什么必须由卡的设定决定，不用默认值掩盖必填事实。

允许整个对象被清空后恢复时，子字段也要有有效缺省值：

```ts
export const Schema = z.object({
  场景: z.object({ 地点: z.string(), 阶段: z.string() }),
  角色: z.object({
    心情: z.string().prefault('平静'),
    信任: z.coerce.number().transform(value => Math.min(100, Math.max(0, value))).prefault(0),
  }).prefault({}),
  物品栏: z.record(z.string().describe('物品名'), z.object({
    描述: z.string(), 数量: z.coerce.number(),
  })).prefault({}),
});
```

这个示例有意要求场景必须提供，允许角色恢复默认并允许空物品栏。不要把它当当前项目完整 Schema 直接覆盖已有字段。`.prefault({})` 只在 `{}` 经子字段处理后可成为合法对象时有效；`.optional()` 表示允许结果为 undefined，不表示自动恢复空对象。

扩展对象先 `.extend({...})`，最后再 `.prefault(...)` 或 `.transform(...)`，不要在包装后的类型上假定仍有对象方法。

### 校正与拒绝

有明确的上下限时可以 clamp，避免一次轻微越界丢弃整条更新；字段名/枚举完全不合法时不凭空猜值。只有需求指定容量时才截断记录，只有需要整数时才取整。

数值上下限是结构约束，“每轮至多 +3”需要旧状态，是更新事件/剧情规则的职责。不要擅自引入未要求的好感限制、任务数量限制或物品淘汰规则。

### 只读派生值示例

把派生公式放在拥有基础值的对象上，重复解析时重新计算同一个结果。以下对象可放进 Schema 的 `角色` 字段；阈值只是例子，应由当前卡设定决定：

```ts
z.object({
  信任: z.coerce.number().transform(value => Math.min(100, Math.max(0, value))),
  _关系阶段: z.string().prefault('陌生'),
}).transform(data => ({
  ...data,
  _关系阶段: data.信任 >= 60 ? '熟悉' : '陌生',
}))
```

模型只更新信任，规则中不要求它同步 `_关系阶段`。初始化可以提供该字段，也可由 prefault 后的 transform 补全；无论输入什么阶段，最终都由同一公式决定。不要同时用另一脚本维护相同派生值。

## 注册适配器的实际行为

锁定 `tavern-resource/util/mvu_zod.ts` 的 `registerMvuSchema`：

1. 将顶层原始 `ZodObject` 转成 `looseObject(shape)`；嵌套普通对象仍有 Zod 的 strip 未知键行为。根节点套 transform/prefault 后不再命中这条分支，应明确选择并验证。
2. 若宿主有 `registerVariableSchema`，同时注册 `{ stat_data: Schema }` 给变量管理器。
3. 监听初始化事件、逐条执行更新命令并 safeParse 整棵状态，失败的命令不会提交。
4. 清空 MVU 本体待执行命令，防止同一补丁执行两次；更新后清理旧的 display_data/delta_data。

因此 **修改嵌套结构可能删掉旧字段**，不是简单增加编辑器提示。迁移时对旧存档 parse 后的字段做差异检查。模型补丁更新与前端直接写变量也不等价，直接写入 API 不自动获得所有解析器约束。

注册脚本应按上游初始化方式尽早安装事件监听；这与“消费 Mvu API 前等待全局就绪”是两个不同步骤，不要为了读写等待而无意错过初始化事件。真实初始化时序仍需在宿主验证。

适配器对命令直接操作路径中 `_` 开头的段做只读判断。它不是完整权限系统：父对象整体替换、插入的键或自定义脚本写入必须另外设计。`$` 前缀可以用来命名派生字段，但当前适配器没有同等的 `$` 路径只读保证；新卡不要让模型承担维护派生值。

## 上游模板风格与 Zod API 分开理解

本仓库采用：优先 prefault、数值 coercion、幂等 transform、动态对象优先 record、字段名已清楚时不堆 describe、把副作用和注册移出 schema.ts。复杂结构可提取有实际复用价值的局部 schema，不能为了遵循“只准一个表达式”复制数百行。

上游提示词中“transform 不能有 context”“passthrough/strict 不存在”等绝对说法不是 Zod 4 的完整 API 事实。写新卡可以只用单参数 transform、`z.looseObject`/`z.strictObject` 以保持清晰，但不能据此把库支持的写法判为语法错误。准确 API 查 [Zod 官方文档](https://zod.dev/api)。

## 有意义的验证

只对本仓库自编、已经审查的结构执行测试，不动态执行 imports 中未知代码。至少覆盖：初值能解析、数字输入与边界、缺必填字段、可清空容器、动态键增删、未知字段保留/剥离、二次 parse 幂等。补丁链还要保证每个中间状态有效，不能只测最终状态。

构建检查确认 Schema 已真正合入注册脚本、固定适配器 import 留存、没有另一份 Zod runtime 被打包。真实宿主再验证新开场、变量更新、swipe/重生成、前端读取；本地测试不得替代这些证据。

资料定位：`references/upstream/tavern-helper-template/.agents/skills/mvu-character-card/SKILL.md`、`references/upstream/tavern-resource/util/mvu_zod.ts`、`references/upstream/mvu/src/function/update_variables.ts`；版本和文件哈希见 `maintenance/references.lock.json`。
