# 架构与操作

## 隔离测试

常规 CLI 以仓库为根；没有 `--root` 参数。技能演练需要隔离时，可在仓库 `work/` 下建立测试根，通过工具导出的函数明确传入 root；模板仍来自仓库默认 templates。例如在仓库根运行一个放于 `work/` 的本地脚本：

```js
import { newCard } from '../tools/lib/templates.mjs';
import { checkProject } from '../tools/lib/validation.mjs';
import { buildCard } from '../tools/lib/build.mjs';
import path from 'node:path';

const root = path.resolve('work/my-isolated-test');
await newCard('演练', { root, modules: ['mvu'] });
const result = await checkProject('演练', root);
if (!result.report.ok) throw new Error(result.report.errors.join('\n'));
await buildCard('演练', root);
```

这样源卡和 dist 均在测试根下，不改真实 cards。只执行自编、受信任的测试脚本；导入卡的代码仍保持不执行。

这一页说明工作区怎么组织、`src/index.yaml` 与条目 YAML 记录什么、`project.json` 保留什么、命令和构建各做什么。

## 目录

```text
TavernCardStudio/
  cards/<名称>/
    project.json          模块、依赖、头像、runtimeVerified 与 original
    .card/state.json      机器兼容数据，校验只读，未知与 legacy 数据保留
    内容导航.md            工具生成的内容导航，不手改
    original/             导入原件与基线，只读
    src/                  编辑区
      index.yaml          卡片总入口：角色、文本、开场白、世界书、正则、脚本
      text/ greetings/ worldbook/ regex/ scripts/ ui/ variables/
    tests/regex.json      正则样例
    创作说明.md            创作笔记，不参与打包
  dist/<名称>/            构建产物
  references/             锁定的参考资料，只读，不参与打包
  maintenance/            参考资料配置与锁文件
  templates/              新建卡片所用的骨架
  tools/                  命令行、检查与构建实现
  tests/                  自动化测试
  docs/                   本工作区文档
```

`dist/`、`imports/`、`work/` 与参考资料缓存都被 `.gitignore` 忽略。`cards/` 默认也不提交，只有仓库自带的官方示例按 `.gitignore` 里的名单跟踪，用户自建卡留在本地。一个卡片目录只属于一张卡。写卡时只改 `src/` 下的正文与可读配置（`src/index.yaml`、条目 YAML）；卡 JSON、PNG 和指针由脚本生成。

## 卡片总入口

`src/index.yaml` 用中文键把一张卡的全部内容串起来，值都是相对卡片目录的 `src/...` 路径。顶层键固定为：`角色`、`文本`、`备选开场白`、`群聊开场白`、`世界书`、`正则`、`脚本`，以及给导入卡保留原样的 `兼容文本`、`兼容正则`、`兼容脚本组`、`助手变量`、`兼容助手变量`。

```yaml
角色:
  名称: my-card
  作者: 你的名字
  版本: '1.0'
  标签: [奇幻, 冒险]
文本:
  第一条消息: src/text/first_mes.md
备选开场白:
  - src/greetings/001-雨夜.md
群聊开场白:
  - src/greetings/群聊-01.md
世界书:
  名称: my-card
  条目:
    - src/worldbook/001-旧书店.yaml
正则:
  - src/regex/001-隐藏变量更新.yaml
脚本:
  - src/scripts/001-示例脚本.yaml
```

**默认内容分布**：`文本` 只引用非空字段，`第一条消息` 始终引用。人物设定可以写进世界书条目（新卡推荐，能按触发条件注入、便于增删），也可以写进 `角色描述`、`性格`、`场景`、`对话示例`；不用哪个键就不引用它，对应的 `src/text/*.md` 文件继续留在原地、不必删除，也不参与打包，需要时补键引用。`创作者备注`、`系统提示`、`历史后提示` 按需再填。`文本` 可用键为 `角色描述`、`性格`、`场景`、`第一条消息`、`对话示例`、`创作者备注`、`系统提示`、`历史后提示`；导入卡里的非空值保真引用，不因为默认分布而丢失。

每个世界书、正则、脚本条目各自是一个 YAML，完整键名与卡 JSON 字段的对应见下一节。世界书条目正文用 `文件: src/...`，正则条目用 `替换文件`，脚本条目用 `文件`，脚本文件夹的子项用 `脚本: [src/scripts/....yaml]` 列出。

列表顺序的含义按类型区分：`正则` 与 `脚本` 的列表顺序就是执行／加载顺序；`世界书.条目` 的列表顺序只是存储与显示排列，运行时注入顺序由条目自己的 `顺序`（`insertion_order`）与 `位置` 决定。重排世界书列表时工具会同步 `display_index`，但不改写条目里明确的 `顺序`，所以拖动列表不会改变注入顺序。

`构建: { 类型: script/html/vue, 入口: src/... }` 可以写在世界书、正则、脚本条目上，也可以挂在文本引用上；构建绑定在目标条目或引用上，重排不需要改任何指针。`文本`、`备选开场白`、`群聊开场白`、`兼容文本` 的值通常是路径字符串，需要构建时写成 `{ 文件: src/..., 构建: { 类型: ..., 入口: src/... } }`；带构建的空文本也会被写进 `文本`。

原卡里不规则的嵌套文本会导出到所属条目的 `附属文本`：键是文件名，值与文本引用相同（字符串或 `{ 文件, 构建 }`），归属由工具自动绑定。没有这类字段的卡不需要关心 `附属文本`。

每份条目 YAML 里的 `关联` 是工具生成的标识，用来对上 `.card/state.json` 里的原始条目：保留即可，不要手改，新条目可以省略。文件没有改名时，漏写 `关联` 也能按原路径找回原条目；保留 `关联` 仍是首选，改名或移动文件则必须带上它。

YAML 使用严格解析：重复键、循环别名、自定义标签和 `<<` 合并键会报错。版本号等文本需要时加引号，不直接复制上游模板的 YAML 作为本仓库配置。没有 `关联` 的新增条目按文件路径生成稳定 ID，发布后不要随意改名或移动；导入条目带 `关联` 时改名不改变原 ID。

卡根的 `内容导航.md` 由工具生成：它列出世界书、正则、脚本、文本与界面的落点，并提示从 `src/index.yaml` 开始。它是给人看的导航，不是编辑入口，手改会在工具重新生成时被覆盖。

## 中文键对照

索引与条目 YAML 用中文键，打包时映射回卡 JSON 字段；对应关系以 `tools/lib/authoring.mjs` 顶端的映射表为准。

索引层：

| YAML | 卡 JSON |
| --- | --- |
| `角色.名称`／`作者`／`版本`／`标签` | `data.name`／`creator`／`character_version`／`tags` |
| `文本` | `data.<传统文本字段>`，见下表；值通常是路径字符串 |
| `备选开场白`／`群聊开场白` | `data.alternate_greetings`／`group_only_greetings` |
| `世界书.名称`／`描述`／`扫描深度`／`预算`／`递归扫描` | `data.character_book` 的 `name`／`description`／`scan_depth`／`token_budget`／`recursive_scanning` |
| `助手变量`／`兼容助手变量` | `data.extensions.tavern_helper.variables`／`extensions.tavern_helper.variables` |

`文本`、`备选开场白`、`群聊开场白`、`兼容文本` 的值写成路径字符串，或写成 `{ 文件: src/..., 构建: { 类型: script/html/vue, 入口: src/... } }` 给该文本绑定构建。

`文本` 中文键：

| YAML | 卡 JSON |
| --- | --- |
| `角色描述`／`性格`／`场景`／`第一条消息` | `description`／`personality`／`scenario`／`first_mes` |
| `对话示例`／`创作者备注`／`系统提示`／`历史后提示` | `mes_example`／`creator_notes`／`system_prompt`／`post_history_instructions` |

世界书条目（正文 `文件` → `content`）：

| YAML | 卡 JSON |
| --- | --- |
| `名称`／`启用` | `comment`／`enabled` |
| `关键词`／`次要关键词`／`使用次要关键词`／`关键词使用正则` | `keys`／`secondary_keys`／`selective`／`use_regex` |
| `顺序`／`深度` | `insertion_order`／`extensions.depth` |
| `概率`／`使用概率` | `extensions.probability`／`extensions.useProbability` |
| `次要关键词逻辑`／`扫描深度`／`区分大小写`／`全词匹配` | `extensions.selectiveLogic`／`extensions.scan_depth`／`extensions.case_sensitive`／`extensions.match_whole_words` |
| `不可被递归激活`／`不可激活其他条目`／`延迟到递归` | `extensions.exclude_recursion`／`extensions.prevent_recursion`／`extensions.delay_until_recursion` |
| `忽略预算`／`分组`／`覆盖分组`／`分组权重` | `extensions.ignore_budget`／`extensions.group`／`extensions.group_override`／`extensions.group_weight` |
| `黏性`／`冷却`／`延迟`／`出口`／`自动化ID` | `extensions.sticky`／`extensions.cooldown`／`extensions.delay`／`extensions.outlet_name`／`extensions.automation_id` |
| `激活`／`位置`／`角色` | `constant` 与 `extensions.vectorized`／`extensions.position` 与 `position`／`extensions.role` |

正则条目（正文 `替换文件` → `replaceString`）：

| YAML | 卡 JSON |
| --- | --- |
| `名称`／`查找`／`裁剪` | `scriptName`／`findRegex`／`trimStrings` |
| `禁用`／`仅显示`／`仅提示词`／`编辑时运行` | `disabled`／`markdownOnly`／`promptOnly`／`runOnEdit` |
| `宏替换模式`／`最小深度`／`最大深度`／`作用于` | `substituteRegex`／`minDepth`／`maxDepth`／`placement` |

脚本条目（正文 `文件` → `content`）：

| YAML | 卡 JSON |
| --- | --- |
| `名称`／`启用`／`说明` | `name`／`enabled`／`info` |
| `按钮`／`数据`／`导出设置` | `button`／`data`／`export_with` |
| `图标`／`颜色` | `icon`／`color`，只有文件夹有 |
| `类型`／`脚本` | `type`（`脚本`→`script`、`文件夹`→`folder`）／文件夹的子项数组 `scripts` |
| `数据`／`数据文件` | `data`：小数据直接内联，超过 2000 字符时自动拆到同名 `.data.yaml` 并用 `数据文件` 引用；两者互斥 |

枚举值：

| YAML 值 | 卡 JSON |
| --- | --- |
| `激活`：`蓝灯`／`绿灯`／`向量` | `constant: true`／`constant: false`／`extensions.vectorized: true` |
| `位置`：`角色定义之前`、`角色定义之后`、`作者注之前`、`作者注之后`、`指定深度`、`示例消息之前`、`示例消息之后`、`出口` | `extensions.position` = 0–7 |
| `角色`：`系统`／`用户`／`助手` | `extensions.role` = 0／1／2 |
| `作用于`：`旧版显示`、`用户输入`、`AI输出`、`快捷命令`、`世界书`、`推理` | `placement` = 0、1、2、3、5、6 |
| `次要关键词逻辑`：`任一匹配`／`不全部匹配`／`全部不匹配`／`全部匹配` | `extensions.selectiveLogic` = 0／1／2／3，数字也兼容 |

## project.json

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 当前为 2；旧版目录用 `pnpm card migrate` 升级 |
| `name` | 卡片名，必须与目录名一致 |
| `modules` | 新建时选择的模板模块记录：`worldbook`、`regex`、`script`、`mvu`、`html`、`vue`；导入卡默认空数组，不是运行时总开关 |
| `dependencies` | 外部资源数组，每项 `{ url, purpose, version }` |
| `avatar` | 头像相对路径或 `null`；导入 PNG 时为 `src/assets/avatar.png` |
| `runtimeVerified` | 真实宿主核实记录；`null` 表示尚未核实 |
| `original` | 原件校验信息：`baseline`、`baselineSha256`，导入时还有 `file`、`sha256` |
| `source` | 创作入口，固定为 `src/index.yaml` |
| `state` | 兼容数据位置与校验：`{ file: ".card/state.json", sha256 }` |

示例（依赖必须是带固定提交的 HTTPS 地址，下面是模板自带的 MVU）：

```json
{
  "schemaVersion": 2,
  "name": "my-card",
  "modules": ["mvu", "vue"],
  "dependencies": [
    {
      "url": "https://cdn.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@3377b494cd7277230f3056230062124fe117f93f/artifact/bundle.js",
      "purpose": "公开的 MVU 框架；要求酒馆助手已安装并启用卡内脚本。",
      "version": "3377b494cd7277230f3056230062124fe117f93f"
    }
  ],
  "avatar": null,
  "runtimeVerified": null,
  "original": { "baseline": "original/card.json", "baselineSha256": "…" },
  "source": "src/index.yaml",
  "state": { "file": ".card/state.json", "sha256": "…" }
}
```

`project.json` 不再保存字段映射或构建项，`fields` 与 `builds` 只在校验、构建过程中临时算出。内容位置以 `src/index.yaml` 与条目 YAML 为准，`pnpm card map <名称>` 可以打印当前卡的对应关系。

`source` 与 `state` 由工具维护：`source` 固定指向 `src/index.yaml`；`.card/state.json` 保存没写进索引的原始卡数据、条目记录与 `关联` 映射，内部结构以 `tools/lib/authoring.mjs` 为准，`state.sha256` 对它做校验。它要随工程一起备份与提交：删掉会丢失 `关联` 映射和已取消引用记录。手改 `.card/` 会让校验失败并直接报错，恢复方式是用工具重新生成。

旧版目录（`schemaVersion: 1`）仍能加载；`pnpm card migrate <名称|all>` 原地升级，并把迁移前的快照留在 `.card/migration-v1/project.json` 与 `.card/migration-v1/src-card.json`。迁移会做两项保真校验：原卡语义全等，以及按构建目标排序后的构建映射集合全等；任一项不通过都保留原目录不动。新建与 `split` 直接生成 v2。

## 内容位置

内容落在哪些文件由 `src/index.yaml` 与条目 YAML 决定。工具生成时的默认落点如下，具体以生成的卡片为准；`pnpm card map <名称>` 会打印当前卡的实际对应关系，并单列出已取消引用的原条目（`unreferenced`）：

| 内容 | 落点 |
| --- | --- |
| 卡文本字段 | `src/text/<字段>.md`，由 `文本` 引用 |
| 根层旧字段 | `src/legacy/<字段>.md` |
| 开场白 | `src/greetings/*.md`，由 `备选开场白`、`群聊开场白` 引用 |
| 世界书条目 | `src/worldbook/*.yaml`，正文用 `文件` 指向 `src/...` |
| 正则条目 | `src/regex/*.yaml`，`替换文件` 指向替换正文 |
| 助手脚本 | `src/scripts/*.yaml`，`文件` 指向脚本体 |
| 深度提示 | `src/text/depth_prompt.md` |
| MVU 模板附带 | `src/variables/schema.json` |
| HTML/Vue 界面 | `src/ui/html/`、`src/ui/vue/` |
| 内容导航 | 卡根 `内容导航.md`，工具生成，不手改 |

卡名、开关、按钮列表、查找表达式、作用位置这类短字段写在条目 YAML 里，不再写卡 JSON。

设定可以写进世界书条目，也可以写进 `角色描述`、`性格`、`场景`、`对话示例`；写哪一处就引用哪一处，同一段设定不要两边都写。没引用的 `src/text/*.md` 文件留在原地即可、不需要删除，也不参与打包。导入卡里的非空值原样保留，不因默认分布改写。

修改 `modules` 数组不会自动增删内容。给已有卡增加或移除功能时，要同步维护实际世界书、正则、脚本条目、条目 YAML 与 `dependencies`；只想暂时停用某项时，调整对应条目的启用状态。

跨模块改动的定位与顺序见 [复杂卡模块联动](COMPLEX-CARDS.md)：先用 `pnpm card map <名称>` 看清落点，再按依赖链改动上下游。

## 加载与打包

**导入与拆分**（`split` 与新建卡片）：

1. 读取原件（PNG 或 JSON），把规范化后的卡 JSON 写入 `original/card.json`，导入件另存为 `original/input.<扩展名>`。
2. 生成 `src/index.yaml` 与条目 YAML，把长文本与代码按内容位置拆到 `src/` 文件；未识别的兼容字段写入 `.card/state.json`。
3. 脚本、正则、世界书条目保留原有顺序与元数据，并用 `关联` 与原卡条目对应。

**打包**（`check`、`build`、`diff` 之前）：

1. 按 `src/index.yaml` 的引用与条目 YAML 组装出完整卡 JSON。
2. 校验引用是否存在、路径是否在 `src/` 内、原件哈希是否一致。
3. 得到一份“当前编辑区对应的完整卡”，再交给检查或构建。

增删或重排引用后下次打包自动生效，重排不需要改指针。`正则`、`脚本` 的列表顺序就是执行／加载顺序；`世界书.条目` 的列表顺序只是存储与显示排列，注入顺序仍由条目自己的 `顺序` 与 `位置` 决定，重排只同步 `display_index`。删除引用后源文件可以保留，但不再参与打包。

**无损要求**：导入一张卡后立刻 `check`，`diff` 应当没有差异。发现差异时先查 `src/index.yaml` 的引用有没有漏项。

## 卡文件与 PNG

- 导入支持 PNG 与 JSON。PNG 里的卡数据放在 `tEXt` 块中：`chara` 保存 V2 卡，`ccv3` 保存 V3 卡，内容是 Base64 编码的卡 JSON；同时存在时以 `ccv3` 为准。
- `spec` 只接受 `chara_card_v2` 与 `chara_card_v3`。V3 的字段会原样保留并在构建时回填，但这只说明卡 JSON 层面的保真：本工作区不打包 CHARX，也不做旧格式转换。规范与宿主支持边界见 [来源索引](SOURCES.md)。
- 构建时按卡 JSON 的 `spec` 决定写入 `ccv3` 还是 `chara`，原有图像数据逐字节保留，只替换角色数据块。
- 导入 PNG 时原图存为 `src/assets/avatar.png`，构建会同时输出 `<名称>.png`；导入 JSON 时没有头像，只输出 `<名称>.json`。
- 目录名与字段文件都用项目内相对路径：不接受绝对路径、反斜杠和符号链接。目录名不能包含 `< > : " / \ | ? *`，不能以点或空格结尾，也不能是 Windows 保留名（`con`、`nul`、`com1` 等）。

## 命令

| 命令 | 行为 |
| --- | --- |
| `pnpm setup:workspace` | 首次准备：检查环境，缺依赖或锁文件漂移时按 `--frozen-lockfile` 安装一次；条件不满足时打印操作指导并以退出码 1 结束 |
| `pnpm doctor:workspace` | 只读检查 Node、pnpm、依赖、锁文件与本地工具；不安装、不写文件 |
| `pnpm card new <名称> [--modules …]` | 生成卡片骨架、`src/index.yaml`、`project.json` 与该模块的示例内容；不带 `--modules` 时是纯文字卡 |
| `pnpm card split <PNG或JSON文件> [--name 名称]` | 导入、保存原件并拆分；不带 `--name` 时用文件名 |
| `pnpm card check <名称\|all>` | 静态检查，输出错误、警告、命中样例数与外部依赖 |
| `pnpm card build <名称\|all>` | 先检查再构建，输出到 `dist/<名称>/` |
| `pnpm card diff <名称\|all>` | 用原件基线与当前编辑区做语义比较，并列出待构建项 |
| `pnpm card migrate <名称\|all>` | 把旧版卡片目录原地迁移到 v2，旧快照留在 `.card/migration-v1/` |
| `pnpm card map <名称>` | 打印内容位置索引：创作入口、设置文件、正文文件、构建项与已取消引用的原条目 |
| `pnpm card help` | 打印用法、默认行为与模块清单 |
| `pnpm refs restore [--source <id>]` | 按 `maintenance/references.lock.json` 还原参考资料：只取锁定的完整提交与文件、按 sha256 校验，不修改锁文件；公开包不带 `references/upstream/` 实体，缓存缺失时先跑它 |
| `pnpm refs search <关键词> [--limit N] [--context N]` | 在已 restore 的本地参考资料里检索 |
| `pnpm refs check [--source <id>]` | 校验锁文件、逐文件哈希、必需文件与索引；需要本地已有缓存 |
| `pnpm refs update [--source <id>] [--seed <目录>]` | 刷新来源并重写锁文件；有意升级锁版本时才用 |
| `pnpm refs verify-sources` | 打印当前配置的来源与固定提交 |
| `pnpm verify` | 离线总校验：单元测试 → 官方示例逐张检查／构建 → 发布前检查；不需要参考资料 |
| `pnpm verify:refs` | 在 `pnpm refs restore` 之后校验参考资料与锁版本一致性（等价于 `pnpm refs check`） |
| `pnpm release:check` | 发布前检查：公开清单（`maintenance/public-release.json` 登记的文件、目录与官方示例）、版本与锁文件、许可与文档引用 |

命令输出 JSON：单个卡片命令返回 `{ ok, action, results: [...] }`，参考资料命令返回 `{ ok, command, ... }`。失败时返回退出码 1。

PowerShell 下把模块列表整体加引号，否则逗号会被当成数组分隔符：

```powershell
pnpm card new my-card --modules "worldbook,regex,script,mvu,vue"
```

## 备份与升级

要备份的是 `cards/<名称>/` 整体：`src/` 是正文与配置，`.card/` 保存兼容数据与 `关联` 映射，`original/` 是原件与基线。复制这个目录就能完整恢复一张卡，缺了 `.card/` 会丢失 `关联` 映射与已取消引用记录。`imports/` 是可再归档的原卡、`dist/` 是可再生成的产物、`references/` 是可按锁版本取回的缓存，都不必备份。

升级工作区、迁移旧卡、把自建卡纳入版本管理与回滚，见 [升级与备份](UPDATING.md)。参考资料只按锁文件还原，`pnpm refs update` 属于有意的锁版本升级，不是常规步骤。

## 构建流程

1. 先跑 `check`；有错误就停止，不产生半成品。
2. 逐个执行条目 YAML 上的 `构建`：
   - `script`：用 esbuild 把入口打包成单个 ESM 文件（浏览器目标），结果写回该脚本条目的正文。
   - `html` / `vue`：用 Vite 打包成单文件 HTML，再用 Base64 包装后写回该正则条目的 `替换文件`。
3. 对没有参与构建的 `src/` 文件做资源审计，确认没有残留本地路径或未声明外链。
4. 产物写进 `dist/<名称>/`：先在临时目录生成全部文件，再发布到目标目录。目标目录不存在时直接改名；已存在时先尝试整目录改名，Windows 上遇到 `EPERM`／`EACCES`／`EBUSY`（目录被资源管理器、索引器或编辑器占着）会退回按文件替换，并留下回滚用的备份；失败会恢复原产物，极端情况下备份目录会保留并在错误信息里写明路径。**不保证整目录原子切换**。
5. `build-report.json` 记录输入与产物的 sha256、依赖、外部地址、警告，以及三项检查结论。

产物清单：

| 文件 | 说明 |
| --- | --- |
| `<名称>.json` | 可以导入酒馆的角色卡 |
| `<名称>.png` | 有头像时生成，与 JSON 内容相同 |
| `build-report.json` | 输入哈希、产物哈希、依赖、警告与检查结论 |
| `使用说明.md` | 导入方式、运行前提与依赖清单 |
| `scripts/*`、`ui/*` | 构建结果副本，仅用于检查；编号不保证与旧版或条目顺序一致，绑定以条目上的 `构建` 为准 |

产物总量超过 5 MiB 时会给出警告，提示在目标设备上确认导入与显示性能。

## 检查不做什么

- 不执行卡里的脚本、EJS 或界面代码；只做解析与编译级检查。
- EJS 编译失败目前记为警告，因为跨条目片段需要在实际注入顺序里核对。
- TypeScript 只做语法转换，不做类型检查。
- 不联网加载外链资源来验证可用性。
- 不把 `references/` 里的内容打包进任何卡。
- 不代替真实酒馆测试，`runtimeVerified` 只记录人工确认过的结果。

## 状态

命令、检查与构建的行为以 `tools/card.mjs`、`tools/lib/` 与 `tools/refs.mjs` 的实现为准。v2 创作格式、`migrate` 与 `map` 均已实现；文档与实现不一致时修正对应一侧。
