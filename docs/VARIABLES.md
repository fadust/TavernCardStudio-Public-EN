# MVU 变量与输出协议

MVU 将状态保存在消息楼层变量的 `stat_data` 中，消费模型更新块并写回新状态。酒馆助手的全局/角色/脚本/聊天/消息变量是存储接口；MVU 是使用该接口的独立框架，两者不是同一个组件。普通文字卡不必启用 MVU。

先确定由主 API 随正文更新，还是通过额外 API 请求更新；配置方法、阶段标记对照及切换检查见 [MVU 更新模式](MVU-MODES.md)。状态栏默认使用 MVU 自动追加的 `<StatusPlaceHolderImpl/>`，不要求模型额外输出占位符。

## 标准组成与可编辑边界

`pnpm card new my-card --modules "mvu"` 生成当前仓库的 MVU 骨架：框架加载脚本、Zod 结构与注册脚本、四个世界书条目、完整/流式显示及提示词四条更新块正则，以及正则样例。状态栏另外配显示和提示词正则：有界面时渲染固定占位符，无界面时仅隐藏它。脚本和公开依赖固定提交，自写内容默认随卡内嵌，也可按 [外链资源](REMOTE-ASSETS.md) 托管。旧卡不会因为模板更新而自动迁移。

| 条目名称 | 设置 | 职责与内容来源 |
| --- | --- | --- |
| `[initvar]变量初始化勿开` | 蓝灯，**禁用**，角色定义之前 | 初始化 JSON/YAML，按当前 Schema 改写 |
| `变量列表` | 蓝灯，启用，指定深度 0、system | 固定宏模板，向模型提供当前 `stat_data` |
| `[mvu_update]变量更新规则` | 蓝灯，启用，指定深度 0、system | 按字段写本卡的变化条件 |
| `[mvu_update]变量输出格式` | 蓝灯，启用，指定深度 0、system | 本仓库固定协议资产，普通写卡不自由改写 |

新卡按“列表 → 规则 → 输出格式”的区块内顺序排，并关闭双向递归。具体 order 来自 `templates/modules/mvu/module.json`；不复制来源卡里的具体数值当作标准。D0/system 是本仓库采用的模板布局，MVU 不以这个数值识别条目。

`schema.ts` 与初值、规则、UI 必须使用同一字段名和类型。只有 `schema.json` 不会产生运行时约束；真正注册链见 [MVU-ZOD.md](MVU-ZOD.md)。

## 哪些名称是运行时协议

| 标记 | 锁定 MVU 的用途 |
| --- | --- |
| `[initvar]` | 在世界书条目 comment 中不区分大小写查找，以此读取初值 |
| `[mvu_update]` | 按更新模式区分变量更新阶段与正文阶段的条目 |
| `[mvu_plot]` | 按阶段筛选正文专用条目；仅在需要分步/额外模型时使用 |
| `[config_override]` | 框架的角色配置覆盖；须禁用、名称精确匹配、正文为 JSON，按创作者明确需求使用 |

`[initvar]`、`[mvu_update]`、`[mvu_plot]` 可加描述后缀或分类前缀，如 `[系统][mvu_update]变量更新规则`；`[config_override]` 例外，名称必须独立且精确匹配，不能附加这些文字。不要为了更好看破坏协议标记。`变量列表` 没有同名识别硬要求，但本仓库固定这样命名便于一致维护。

`[mvu_update]` 不表示“必然只发给更新模型”。在“随 AI 输出”模式，筛选器直接返回；在额外分析/分步模式才按阶段移除对应条目，并可能应用标题白名单/黑名单。测试实际请求，而不是仅看条目开关。依据：`mvu/src/variable_def.ts`、`src/function/request/filter_entries.ts`。

## 初始化为何默认禁用

MVU 从已启用/绑定世界书读取 comment 包含 `[initvar]` 的条目，**不以条目自身的 enabled 过滤**，并把值合并进 `stat_data`。因此禁用初始化条目是正确设置：避免把原始初值反复发给模型，世界书本身仍需绑定。标签内写 JSON 或 YAML 数据，不包一层 `stat_data`，也不混入说明性段落。

第一条消息的 `<initvar>` 块可以优先作为开场初值，覆盖世界书初始化来源，适合多开场。选了这条路径就要同步维护多个开场的 Schema 兼容性。不要靠多条同名初始化条目的偶然合并顺序解决冲突。依据：`mvu/src/function/initvar/variable_init.ts`。

## 固定变量列表与输出格式

固定变量列表见 `templates/modules/mvu/variables.md`：

```text
<status_current_variable>
{{format_message_variable::stat_data}}
</status_current_variable>
```

这是宿主宏读取的当前状态，不是让模型自行推算的清单。不要替换成开局初值，也不要手写状态快照。宏能否获得正确楼层，需要宿主环境核实。

固定输出格式存放在 `templates/modules/mvu/format.md`。正常结构是正文之后的 `<UpdateVariable>`，内部含简短 `<Analysis>` 更新依据和 `<JSONPatch>` 操作数组；没有变化输出空数组。这里的 Analysis 是变量变化核对说明，不要求展开私密推理。英文及长度约定来自采用的模板，不是解析器必须验证的字段。

当前锁定的 MVU 支持下列协议。它借用 JSON Patch 路径格式，**不等于完整 RFC 6902 实现**：

| op | 本仓库写法 | 用途 |
| --- | --- | --- |
| `replace` | `{ "op": "replace", "path": "/角色/心情", "value": "放松" }` | 更新现有字段 |
| `delta` | `{ "op": "delta", "path": "/角色/信任", "value": 2 }` | 给数值加减增量，value 用 JSON 数字 |
| `insert` | `{ "op": "insert", "path": "/物品栏/铜钥匙", "value": { "数量": 1 } }` | 向对象或数组增加内容，父容器需合理初始化 |
| `remove` | `{ "op": "remove", "path": "/物品栏/铜钥匙" }` | 删除字段/成员 |
| `move` | `{ "op": "move", "from": "/物品栏/铜钥匙", "to": "/物品栏/旧钥匙" }` | 移动/重命名 |

以上是独立格式示例，不能在未定义物品栏的初始卡中直接执行。运行时也接受 `add` 作为 `insert` 别名、`move.path` 作为目的路径，但新卡统一用表内写法，禁止向输出模板混入 `copy`、`test` 等未实现操作。形状校验并不严格枚举 op，错误操作名可能静默无效。

路径从 `stat_data` 内部开始，不加 `/stat_data`；字段名里的 `~` 和 `/` 必须转义为 `~0` 与 `~1`。数组末尾插入使用 `-`。解析器和注册适配器会逐条处理命令，整组不是原子事务；前一条成功、后一条失败时可能只保留部分更新。先建立容器，再写子字段，并让每一步都符合 Schema。

## 按本卡改写的变量更新规则

使用 YAML 的嵌套 `变量更新规则`，一份规则只负责“为什么和何时变”；类型与值的合法性由 Schema 承担：

```yaml
---
变量更新规则:
  场景:
    地点:
      check:
        - 双方实际到达新地点后更新；计划前往不算到达
  角色:
    信任:
      type: number
      range: 0~100
      check:
        - 明确的守信、帮助或伤害才调整；普通寒暄不改变
        - 只计入本轮新增事件，同一件事不重复累计
```

写法约定：字符串省略 type；相同更新逻辑的固定键可用 `${属性}` 合并说明；动态键在容器层定义，以 `type: |-` 写 `{ [物品名: string]: {...} }`，不要用几个具体物品冒充全部键；同一对象的字段嵌套组织。占位不是补丁路径，实际输出必须是当前字段名。

只读 `_` 字段不分配模型更新规则，派生值由结构或脚本维护。路径只读检测来自注册适配器，不是 JSON 类型系统自身的权限；父对象整体重写、前端/helper 直接写入仍需设计约束。不要把所有特殊前缀都说成系统强制只读。

## 脚本、界面与事件

消费 MVU API 前等待初始化，再明确选择楼层：

```js
await waitGlobalInitialized('Mvu');
const variables = Mvu.getMvuData({ type: 'message', message_id: getCurrentMessageId() });
const state = variables?.stat_data;
```

`getCurrentMessageId` 仅用于楼层 iframe；普通脚本指定楼层号或 `latest`。前端确认 `stat_data` 存在后渲染，并有刷新与卸载清理。只读显示不应为填默认 UI 值而写回世界状态。

独立 `generate` 不产生新楼层时，可用 `Mvu.parseMessage(message, oldData)` 手动解析，再按目标楼层 `replaceMvuData`。不要对框架已经解析的消息再应用一次增量。

`COMMAND_PARSED` 可修正命令；`VARIABLE_UPDATE_ENDED` 可比较新旧状态、限幅。能用当前值表达的范围/派生公式放 Schema，跨轮判断才放事件。Zod 注册器使用专用事件接管命令执行，不能假设注册前后的 executor 完全相同。

## 证据与交付检查

- MVU 固定提交和 Zod 适配器地址由 `templates/modules/mvu/module.json` 与 `maintenance/references.lock.json` 锁定；升级应同时复查解析器、固定提示词、注册器和正则。
- 确认 Schema、初值、更新规则、实际输出路径与 UI 对齐；测试空补丁、数字增量、动态键增删、路径转义、连续解析。
- 显示/提示词正则只处理视图，保留原消息给 MVU；流式与完整块都要测。
- `card check/build` 不执行任意卡的 Schema，也不证明真实模型遵守输出格式。实机需验证新开场、一次更新、重生成/swipe、编辑及切换聊天，未做时保留 `runtimeVerified: null`。

关键源码：`mvu/src/util.ts` 的 `isJsonPatch`，`src/function/update_variables.ts` 的 `extractJsonPatch`，以及 `tavern-resource/util/mvu_zod.ts`。上游模板的固定提示词位于 `tavern-helper-template/初始模板/角色卡/新建为src文件夹中的文件夹/世界书/变量/`。资料根目录均为 `references/upstream/`。
