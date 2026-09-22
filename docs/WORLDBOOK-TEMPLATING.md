# 世界书里的宏、EJS 与变量

条目可以按状态给出不同的提示词：用变量决定输出哪些字段、哪些规则生效、哪些条目进入。这一页写这条工作流与可复制的小片段。字段与触发见 [世界书](WORLDBOOK.md)，正文写法见 [世界书条目提示词](WORLDBOOK-WRITING.md)，脚本与 EJS 的通用约定见 [助手脚本与 EJS](SCRIPTS.md)。

普通卡先从静态条目与关键词开始；需要按状态改内容时再使用这一页。

## 工作流

1. **写入**：初始化条目、脚本或 MVU 把状态写进变量。
2. **读取**：正文用只读宏或 EJS 读出这些值。
3. **决定**：按读到的值选输出字段或规则；读不到走默认分支。
4. **渲染**：给玩家看的用渲染阶段模板输出，并按转义规则处理。
5. **触发**：需要由状态决定条目是否进入时，单独设计注入或预处理。

## 状态从哪来

- MVU 卡：`[initvar]` 是世界书条目标记，MVU 读它并把值合并进当前楼层的 `stat_data`，这是既有协议，见 [变量与 MVU](VARIABLES.md)。
- 其它变量：由卡内脚本或创作者自己的条目写入，作用域按下面那张表选。
- Prompt Template 另有自己的初始化入口，它的作用域和触发时机需要单独确认；要用它在 `references/upstream/prompt-template/docs/features_cn.md` 里核对，不要和上面两套混着写。

## 谁在处理

| 写法 | 谁处理 | 什么时候 | 结果 |
| --- | --- | --- | --- |
| `{{getvar::名}}`、`{{get_message_variable::路径}}` 等宏 | SillyTavern 或酒馆助手 | 组装提示词、显示文本时 | 替换成一段字符串 |
| `<% %>`、`<%= %>` | Prompt Template | 由扩展开关决定在生成或渲染阶段 | 执行 JavaScript，输出文本或 HTML |
| 脚本条目 | 酒馆助手 | iframe 加载或事件触发时 | 操作宿主、变量与界面 |

宏是替换，EJS 要装 Prompt Template 才会执行，助手脚本是浏览器里的程序，三者互不替代。写卡优先用只读取值的宏；`{{if}}` 与 `.名` 这类简写、条件与嵌套语法依赖宏引擎的启用状态和版本，按锁定的 `sillytavern-docs/Usage/macros.md` 核对，不要按印象假定可用，分支交给 EJS。

世界书的主、次关键词会先由宿主做宏替换，再匹配扫描文本；正文也会在注入流程中替换宏。关键词中出现变量宏只会改变要匹配的词，不会把变量值自动加入扫描文本。空值、展开时机和实际匹配结果都要在宿主核对。

## 变量按作用域读

| 变量 | 读 | 写 | 作用域 |
| --- | --- | --- | --- |
| SillyTavern 局部变量 | `{{getvar::名}}` | `{{setvar::名::值}}` | 随聊天 |
| SillyTavern 全局变量 | `{{getglobalvar::名}}` | `{{setglobalvar::名::值}}` | 随用户存档 |
| 酒馆助手变量 | `getVariables({ type })` | `replaceVariables`、`insertOrAssignVariables` 等 | 七类，见下 |
| MVU 状态 | `{{format_message_variable::stat_data}}` | MVU 更新块 | 消息楼层 |

酒馆助手的作用域是 `global`、`preset`、`character`、`chat`、`message`、`script`、`extension`；`character` 在没有打开角色卡时抛错，`message` 的 `message_id` 在 `@types` 里是可选参数、注释写明缺省 `'latest'`（负数是从末尾数起的深度，超出范围抛错），酒馆助手的「变量类型」页把它写成必填，以 `@types` 为准。提示词里读取用 `{{get_xxx_variable::路径}}` 或 `{{format_xxx_variable::路径}}`，后者输出 YAML 块，优先用后者。

这几套 API 的作用域划分不同，同名变量不能按名字假定等价；按实际调用的作用域取值，需要确认时用酒馆助手的变量管理器查看。MVU 部分见 [变量与 MVU](VARIABLES.md)。

## 缺失值与默认值

- 酒馆助手侧，没写过的变量读出来是空表 `{}`，查路径用 `_.has(variables, '对象.字段')`。
- EJS 侧，`getvar('名', { defaults: 默认值 })` 与 `getMessageVar('名', { defaults: 默认值 })` 找不到时返回默认值，不写 `defaults` 返回 `undefined`；消息作用域默认按消息过滤器选取，默认角色 `assistant`，从末尾开始找。
- 宿主宏按各自作用域读取，缺失时的输出先按该宏的实际行为核对，不要照别的宏推断。
- 正文里的缺口不等于否：读不到就输出默认字段或省略该段，不要把缺失当成已知事实。

## 生成阶段与渲染阶段

Prompt Template 有两组独立开关：**处理生成内容**决定发送给模型前是否对 `<% %>` 求值，**处理楼层消息**决定渲染楼层时是否求值；总开关关闭时模板原样发给模型。楼层里的模板另有「生成时忽略楼层消息处理」，用于在生成前隐藏楼层内的 `<% %>`。

处理顺序是：酒馆组装提示词，扩展处理其中的 `<% %>`，发给模型，接收输出并渲染楼层，扩展再处理一遍收到的内容。某段模板在哪些阶段求值、求值几次，取决于这些开关和它所在的文字，不要假定只执行一次。

- `runType` 取 `generate`、`preparation`、`render`、`render_permanent`。
- 渲染阶段才有 `message_id`、`swipe_id`、`is_user`、`is_system`、`is_last`；`[GENERATE:*]` 与 `@@generate_*` 处理时才有 `world_info`、`generateBuffer`、`generateData`。
- 渲染默认只改显示用的 HTML；开启「处理原始消息内容」后才按 `render_permanent` 写回消息原文，会永久修改聊天记录。
- EJS 里 `setvar` 默认写消息作用域，`getvar` 默认读 `cache` 作用域，写读默认层不同；要确定层次就显式写 `{ scope: 'global' }`。

## 输出与转义

- 渲染阶段用 `<%=` 输出变量，它会做转义与格式化；`<%-` 直接当 HTML 写进楼层，不要在渲染里用它输出变量，需要更明确时可用模板内可用的 `_.escape()`。
- 生成阶段同一个值进的是提示词文本，按纯文本核对：确认它不会变成标签、模板片段或结构标记。不要把宏展开值拼进 EJS 的 JavaScript 字符串；在 EJS 中直接调用取值函数，再按文本格式序列化。
- 装饰器名称固定，写错的 `@@xxx` 行会被丢掉；正文要以 `@@` 开头时用 `@@@` 转义。
- 酒馆助手的取值宏会跳过变量里以 `$` 开头的键，可用这个前缀存放不该发给模型的数据；内嵌界面 HTML 先 Base64 再写进卡，避开 `$1` 与宏替换，见 [前端资源](FRONTEND.md)。

## 让条目由状态驱动

关键词只在本轮扫描文本里匹配，扫描文本由截取的聊天消息、条目显式勾选的卡字段、允许扫描的扩展注入与递归缓冲组成，变量不在其中。变量里的当前地点、界面数值、MVU 的 `stat_data` 都不会自动命中绿灯条目。「模型能读到状态」和「状态进入关键词扫描」是两件事。按目的选一种：

| 目的 | 做法 | 代价 |
| --- | --- | --- |
| 内容已注入，按状态选文本 | 正文里用只读宏或 EJS 分支 | 关键词条件不变，只是正文随状态变 |
| 用状态决定是否注入 | `@@preprocessing` 或标题 `[Preprocessing]` 先改关键词 | 提前处理不遵循激活顺序，正文会被再处理一次 |
| 让状态进入关键词扫描 | 脚本在扫描前注入 `injectPrompts([{ position: 'none', should_scan: true, ... }])` | 只在当前聊天有效，要处理切聊天、重生成与 swipe |
| 直接激活或读取指定条目 | EJS 的 `activewi`、`getwi` | `activewi` 要在 `[GENERATE:BEFORE]` 一类条目里调用；`getwi` 绕过世界书逻辑 |

脚本注入的片段与边界见 [地点扫描与树状设定](../.agents/skills/tavern-worldbook/references/location-scan.md)。条目级装饰器另有 `@@activate`（忽略绿灯关键词，视为常驻）与 `@@dont_activate`（禁止激活，`activewi` 也拦下）。

## 深度条目与角色

位置设为指定深度（`position: 4`）时同时给 `深度` 和 `角色`：深度决定它离最新消息多远，角色决定它以谁的身份进入消息。锁定实现里角色缺省按 `system` 处理（`entry.extensions?.role ?? extension_prompt_roles.SYSTEM`）。同一深度、同一角色的多条会合并成一段文本。

## 可复制示例

下面的片段只读取状态，不修改原变量。作为生成提示词使用的 EJS 放在能实际激活的条目中，并在主请求或额外变量请求的提示词预览里检查展开结果；额外请求经过哪条处理链也需验证，不能假定与主请求相同。

### 读当前楼层的状态（固定资产写法）

变量列表这类条目直接用仓库现有写法，不要再套一层引号：

```text
<status_current_variable>
{{format_message_variable::stat_data}}
</status_current_variable>
```

`format_xxx_variable` 输出 YAML 块；`get_xxx_variable` 输出 JSON 形式的值，字符串已有引号，对象和数值也有自己的结构。不要在序列化结果外手工再套引号。路径不存在时的实际输出没有写进锁定文档，用之前按目标环境核对，不要假定是空字符串或 `0`。

### 按权限决定输出字段（生成阶段）

以下示例假定本卡已经在消息状态 `stat_data.权限` 写入权限值；没有该字段时走只读分支。字段与枚举要按本卡 Schema 调整。

```text
<% if (getMessageVar('stat_data.权限', { defaults: '只读' }) === '管理员') { %>
输出字段: [编号, 摘要, 审计记录]
<% } else { %>
输出字段: [编号, 摘要]
<% } %>
```

### 只读投影：裁剪字段后输出

```text
<%
const 视图 = _.pick(_.cloneDeep(getMessageVar('stat_data', { defaults: {} })), ['编号', '状态', '区域']);
%>
当前状态：
<%= JSON.stringify(视图, null, 2) %>
```

先深拷贝再裁剪，输出的是副本，原变量不受影响；`getvar` 与 `getMessageVar` 也支持 `{ clone: true }`，同样返回深拷贝，不加这个选项拿到的是引用。

### 渲染楼层（转义输出）

条目标题用 `[RENDER:AFTER]`，或用装饰器：

```text
@@render_after
@@if !is_user && !is_system
权限：<%= variables.stat_data?.权限 ?? '只读' %>
```

`is_user`、`is_system` 只在渲染阶段存在；这里用 `<%=` 输出值，不对变量使用 `<%-`。

### 用条件装饰器决定条目是否进入

```text
@@if getMessageVar('stat_data.权限', { defaults: '只读' }) === '管理员'
输出字段: [编号, 摘要, 审计记录]
```

`@@if` 只接受单行 JavaScript 条件；条件为假时这一条不进入世界书处理流程。

## 玩家侧前置条件

| 写法 | 需要什么 |
| --- | --- |
| 宿主宏 | 无额外安装 |
| EJS `<% %>` | 安装并启用 Prompt Template，并打开对应阶段的处理开关 |
| `@@` 装饰器、`[GENERATE:*]`、`[RENDER:*]`、`@INJECT`、`[InitialVariables]` | Prompt Template；`[InitialVariables]` 还要「立即加载世界书」 |
| `{{get_xxx_variable::路径}}`、`{{format_xxx_variable::路径}}` 与卡内脚本 | 安装并启用酒馆助手，且卡内脚本启用 |
| MVU 的 `stat_data` | MVU 脚本在场 |

特殊条目的启用状态还取决于「GENERATE/RENDER/INJECT 条目禁用视为启用」：开启时只有被禁用的特殊条目会被处理，关闭时只有启用的会被处理；要写死的条目用 `@@always_enabled`。没有 Prompt Template 时 EJS 会原样留在提示词里，只导入卡不等于装好了这些扩展；卡里用到就照实写进 `project.json` 的 `dependencies`，组件分工见 [运行环境与语法](ENVIRONMENT.md)。

## 实现依据

- 宏替换与扫描文本：`references/upstream/sillytavern/public/scripts/world-info.js` 的 `substituteParams(key)`、`substituteParams(entry.content)`、`WorldInfoBuffer.get` 与 `entry.extensions?.role ?? extension_prompt_roles.SYSTEM`。
- 变量宏与宏引擎差异：`references/upstream/sillytavern/public/scripts/macros/definitions/variable-macros.js` 与 `macros.js` 的 `getVariableMacros()`，语法范围见 `references/upstream/sillytavern-docs/Usage/macros.md`。
- 酒馆助手作用域、`message_id` 缺省与取值宏：`references/upstream/tavern-helper/@types/function/variables.d.ts` 与酒馆助手中文文档的「变量类型」「获取变量」「酒馆助手宏」。
- EJS 的开关、顺序、阶段字段与 `getvar`／`setvar` 默认作用域：`references/upstream/prompt-template/docs/reference_cn.md` 与 `features_cn.md`。

固定提交以 `maintenance/references.lock.json` 为准。以上都是源码与扩展文档层面的结论，没有在真实酒馆加指定版本扩展上跑过：模板在具体注入顺序里的实际结果、`@@preprocessing` 的提前与二次处理表现、渲染阶段 `<%=` 的实际格式化效果都需要宿主提示词预览确认，`project.json.runtimeVerified` 保留 `null` 直到实机验证。
