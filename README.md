# TavernCardStudio

本地编写 SillyTavern 角色卡的工作区。一张卡一个目录，卡文本、世界书、酒馆正则、酒馆助手脚本、EJS 模板、MVU 变量和 HTML/Vue 界面都在同一处维护，再用一条命令打包成可以导入酒馆的 PNG 或 JSON。人和 AI 编辑同一份源文件，用工具检查和打包。

## 首次使用

先安装 [Node.js](https://nodejs.org/) **22.12 或更高版本**，然后重新打开终端。pnpm 版本以 [package.json](package.json) 的 `packageManager` 字段为准；本版本可复制下面的安装命令。进入解压后的工作区目录再运行：

```powershell
npm install --global pnpm@11.17.0  # 只在尚未安装该版本 pnpm 时执行
pnpm setup:workspace     # 检查环境；缺依赖或锁文件漂移时按 --frozen-lockfile 安装一次
pnpm doctor:workspace    # 只读检查 Node、pnpm、依赖、锁文件与本地工具
```

已经装过依赖的工作区直接跑 `pnpm doctor:workspace` 就够了。`setup:workspace` 只在依赖缺失或锁文件漂移时执行一次 `pnpm install --frozen-lockfile`，条件不满足就打印操作指导并以退出码 1 结束；`doctor:workspace` 全程只读，不会安装依赖，也不会替用户改系统环境。

不想用命令行时，双击根目录的 **`打开角色卡工具.cmd`**，浏览器会打开本地创作工具：导入并拆分角色卡、新建卡片、复制工程、改工程名与角色显示名、添加或更换封面、检查和打包，也能直接打开原卡、编辑区与成品文件夹。操作说明见 [创作工具使用说明](docs/STUDIO.md)。服务只监听本机地址，启动后保留命令窗口。

## 三条上手路径

### 1. 简单卡：先让对话跑通

```powershell
pnpm card new my-card
pnpm card check my-card
pnpm card build my-card
```

不带 `--modules` 就是纯文字卡。改 `cards/my-card/src/index.yaml` 和它引用的 `src/text/*.md`：`第一条消息` 是开场白，`文本` 里只写真正要用的字段。

人物设定可以写进 `角色描述`、`性格`、`场景`、`对话示例`，也可以写进世界书条目——这是创作选择，不是限制。新卡推荐世界书，因为条目能按触发条件注入、便于逐条增删；用传统字段同样可以打包和分发，只要 `文本` 引用了对应的键。两条路都成立，同一段设定别写两遍。

### 2. 复杂卡：世界书 + 变量 + 界面

```powershell
# PowerShell 里模块列表要整体加引号，否则逗号会被当成数组分隔符
pnpm card new advanced-card --modules "worldbook,regex,script,mvu,vue"
pnpm card check advanced-card
pnpm card build advanced-card
```

复杂卡的模块互相引用：世界书条目注入变量规则 → 主 API 或额外 API 请求产生变量更新 → MVU 解析与 Zod 约束取值 → 正则隐藏更新块，并把 MVU 自动添加的固定占位符渲染成楼层界面 → 脚本读写变量。MVU 卡不需要提示模型输出状态栏占位符。改动前先定位内容落在哪里，再动那一处：

```powershell
pnpm card map advanced-card        # 创作入口、设置文件、正文文件与构建项
pnpm card diff advanced-card       # 导入过的卡还要看有没有意外差异
```

卡根目录的 `内容导航.md` 由工具生成，列出世界书、正则、脚本、文本与界面的落点。完整流程看 [复杂卡模块联动](docs/COMPLEX-CARDS.md)，字段与顺序含义看 [架构与操作](docs/ARCHITECTURE.md)。

### 3. 导入已有卡

```powershell
pnpm card split "imports/某角色卡.png" --name my-card
pnpm card diff my-card      # 确认拆分和回填没有丢字段
pnpm card build my-card     # 生成可导入的卡
```

可以先把原卡放进 `imports/`，也可以在创作工具里直接选择任意位置的旧卡；工具会先把完整原卡归档到 `imports/`，再拆分到 `cards/<名称>/src/`。**完整原卡 `imports/` → 拆分编辑区 `cards/<名称>/src/` → 打包成品 `dist/<名称>/`**。之后只在编辑区修改，不要重新拆分覆盖。

## 用 AI 写卡

AI 和 agent 的入口是 [AGENTS.md](AGENTS.md)：先看它的「跨 agent 入口」和「按任务加载技能」，再按下表取技能，不要一次加载全部资料。

| 任务 | 入口 |
| --- | --- |
| 新卡、整体改造、复杂卡研究 | [.agents/skills/tavern-card-authoring/SKILL.md](.agents/skills/tavern-card-authoring/SKILL.md) |
| 提示词文体 | [.agents/skills/tavern-prompt-style/SKILL.md](.agents/skills/tavern-prompt-style/SKILL.md) |
| 世界书 | [.agents/skills/tavern-worldbook/SKILL.md](.agents/skills/tavern-worldbook/SKILL.md) |
| MVU 变量 | [.agents/skills/tavern-mvu/SKILL.md](.agents/skills/tavern-mvu/SKILL.md) |
| Zod 结构 | [.agents/skills/tavern-mvu-zod/SKILL.md](.agents/skills/tavern-mvu-zod/SKILL.md) |
| 正则 | [.agents/skills/tavern-regex/SKILL.md](.agents/skills/tavern-regex/SKILL.md) |
| 助手脚本与 EJS | [.agents/skills/tavern-scripting/SKILL.md](.agents/skills/tavern-scripting/SKILL.md) |
| HTML/Vue 界面 | [.agents/skills/tavern-frontend/SKILL.md](.agents/skills/tavern-frontend/SKILL.md) |

把下面这段连同填空一起贴给任意 AI，就能开工；更完整的一份在 [templates/prompts/AI 开工指令.md](templates/prompts/AI%20开工指令.md)。

```text
在 <工作区路径> 里做一张 SillyTavern 角色卡。
先读 README.md 的「首次使用」和 AGENTS.md，按任务加载 .agents/skills/ 下的技能，
不要一次读完 references/。
卡名：<名称>
要做的体验：<一句话目标>
用哪条路径：简单卡 / 复杂卡（模块：____）/ 导入已有卡（文件：____）
必须保留：<设定、范围、禁忌>
可以自行决定：<题材细节、条目划分、界面样式>
交付：改完跑 pnpm card check <名称> 和 pnpm card build <名称>，
报告改了哪些文件、检查与构建结果、未验证的部分。
不要声称在真实酒馆里测试过，也不要执行卡里的脚本、EJS 或界面代码。
```

**用户偏好和工具强约束是两层。** 题材、文风、数值、条目划分、界面布局按上面填的目标走，示例卡只是参考，不是必须照抄的模板。依赖地址必须是无凭据 HTTPS 且含固定版本、`.card/` 与 `original/` 不能手改、条目 YAML 的键要在允许列表内——这些是工具会报错的硬约束，不能靠偏好绕开。完整说明在 [AGENTS.md](AGENTS.md#用户偏好与工具强约束)。

## 目录与产物

| 路径 | 用途 |
| --- | --- |
| `imports/<原文件名>.png` 或 `.json` | 完整导入原卡；界面导入与 CLI 拆分都会归档，不进 Git |
| `cards/<名称>/src/` | 编辑区：卡文本、世界书、正则、脚本、界面 |
| `cards/<名称>/src/index.yaml` | 卡片总入口：角色、文本、开场白、世界书、正则、脚本都从这里引用 |
| `cards/<名称>/内容导航.md` | 工具生成的内容导航，说明内容在哪个文件 |
| `cards/<名称>/src/{worldbook,regex,scripts}/*.yaml` | 条目配置；正文与代码用 `文件` 指向 `src/...` |
| `cards/<名称>/project.json` | 模块、依赖、头像、`runtimeVerified`、`original` 与工具维护的 `source`／`state` |
| `cards/<名称>/.card/` | 机器兼容数据与迁移快照，随工程一起备份；不要手改 |
| `cards/<名称>/original/` | 导入原件与基线，只读 |
| `dist/<名称>/` | 构建产物，不手改 |
| `references/` | 锁定的参考资料缓存，只读，不参与打包 |

`cards/` 默认不提交 Git，仓库自带的官方示例按 [.gitignore](.gitignore) 的名单跟踪，名单与 [maintenance/public-release.json](maintenance/public-release.json) 的 `examples` 一致；用户自建卡留在本地。要把自己的卡纳入版本管理，见 [升级与备份](docs/UPDATING.md)。打包产物在仓库根目录：

```text
dist/my-card/
  my-card.json        可以导入酒馆的角色卡
  my-card.png         只有卡片带头像时才生成，与 JSON 内容相同
  build-report.json   输入哈希、产物哈希、依赖、警告与检查结论
  使用说明.md         导入方式与运行前提
  scripts/ ui/        构建结果副本，用于检查，不需要另外部署
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm setup:workspace` | 首次准备：检查环境，缺依赖或锁文件漂移时按 `--frozen-lockfile` 安装一次 |
| `pnpm doctor:workspace` | 只读检查 Node、pnpm、依赖、锁文件与本地工具，指出缺什么 |
| `pnpm card new <名称> [--modules worldbook,regex,script,mvu,html,vue]` | 新建卡片；不带 `--modules` 时是纯文字卡，`html` 与 `vue` 初始模板二选一 |
| `pnpm card split <PNG或JSON文件> [--name 名称]` | 导入已有卡；默认用文件名做卡片名 |
| `pnpm card check <名称\|all>` | 静态检查字段、映射、语法、依赖与资源 |
| `pnpm card build <名称\|all>` | 检查通过后构建，输出到 `dist/<名称>/` |
| `pnpm card diff <名称\|all>` | 对比原件基线与当前编辑区 |
| `pnpm card migrate <名称\|all>` | 把旧版卡片目录原地迁移到 v2，旧快照留在 `.card/migration-v1/` |
| `pnpm card map <名称>` | 打印内容位置索引与已取消引用的原条目 |
| `pnpm card help` | 打印用法、默认行为与模块清单 |
| `pnpm inspect-card <JSON或PNG>` | 只读结构摘要；用 `--entries`、`--entry <id>` 定点读取大卡 |
| `pnpm refs restore [--source <id>]` | 按锁文件还原参考资料：只取锁定的完整提交与文件、按 sha256 校验，不改锁文件 |
| `pnpm refs search <关键词>` ／ `pnpm refs check` | 在已还原的资料里检索、校验完整性 |
| `pnpm verify` | 离线总校验：单元测试 → 官方示例逐张检查／构建 → 发布前检查 |
| `pnpm verify:refs` | 需要在 `pnpm refs restore` 之后运行，校验参考资料与锁版本 |
| `pnpm release:check` | 发布前检查：公开清单（`maintenance/public-release.json`）、文档链接与常见凭据标记 |

`card`、`refs` 与发布命令输出 JSON；`check`／`build` 成功时带 `ok: true`，失败时返回退出码 1。`setup:workspace`、`doctor` 默认显示可读提示，`doctor:workspace --json` 可输出结构化报告。`pnpm refs update` 只给维护者有意升级锁版本时使用，日常创作和升级工作区都不需要跑它。

## 示例卡

| 示例 | 用途 |
| --- | --- |
| `cards/示例-纯文字/` | 完整的邮局档案员林恩：角色字段 + 开场白，无扩展依赖 |
| `cards/示例-世界书创作/` | 推荐入门：世界书 + 正则 + 脚本，设定写在世界书条目 |
| `cards/示例-雾港调查局/` | 复杂卡参考：世界书 + MVU + Vue 界面 + 脚本 + 正则 + 多开场白 |
| `cards/示例-MVU-Zod-Vue/` | 当前 MVU 模板：Zod 注册链、固定四条目与流式正则 |
| 其余 `cards/示例-*` | 旧版迁移示例，保留原有写法、继续兼容，不作为新卡默认 |

示例卡可以整篇对照结构，也可以只用其中一个模块的做法。它们不是必须遵循的模板；新卡先确定体验目标，再选需要的模块。

## 备份与升级

- **备份**：保存完整的 `cards/<名称>/`（含 `src/`、`.card/` 与 `original/`）。`imports/` 中尚未导入或希望独立保留的原卡也一起保存；`dist/` 可以重新构建。
- **升级工作区**：先备份 `cards/`，再更新代码、跑 `pnpm setup:workspace` 与 `pnpm doctor:workspace`，然后 `pnpm card check all` 与 `pnpm card build all` 确认现有卡还能构建。构建失败先看报告，不要用新模板覆盖已有卡。
- **旧卡按需迁移**：只对确实要改的卡跑 `pnpm card migrate <名称>`；迁移会保留 `.card/migration-v1/` 快照。
- **参考资料按锁版本**：`pnpm refs restore` 只取锁文件记录的版本。升级工作区不会自动刷新参考资料，也不需要跑 `pnpm refs update`。

怎么让自建卡进入版本管理、怎么回滚和保留旧版本，见 [升级与备份](docs/UPDATING.md)。

## 文档

AI 写卡先按 [AGENTS.md 的技能索引](AGENTS.md#按任务加载技能) 选择任务模块。技能提供工作步骤与关键约束，以下文档保存按需查询的字段、协议和示例。

- [创作指南](docs/CREATION.md)：从需求到卡，三条路径、模块选择与写卡检查清单。
- [复杂卡模块联动](docs/COMPLEX-CARDS.md)：世界书、变量、正则、脚本、界面怎么串起来，以及怎么定位内容。
- [运行环境与语法](docs/ENVIRONMENT.md)：宏、EJS、脚本、MVU、界面分别在哪里生效。
- [世界书](docs/WORLDBOOK.md) 与 [世界书条目写作](docs/WORLDBOOK-WRITING.md)：条目字段、触发策略、注入位置与正文组织。
- [正则](docs/REGEX.md)、[变量与 MVU](docs/VARIABLES.md)、[MVU Zod](docs/MVU-ZOD.md)、[助手脚本与 EJS](docs/SCRIPTS.md)、[前端资源](docs/FRONTEND.md)：各模块字段与样例。
- [MVU 更新模式](docs/MVU-MODES.md)：主 API、额外 API、阶段标记与自动状态栏占位。
- [地点扫描与树状设定](.agents/skills/tavern-worldbook/references/location-scan.md)：关键词层级与按需的脚本扫描接入。
- [外链资源](docs/REMOTE-ASSETS.md)：将自写脚本或前端发布到公开 Git 后，以固定版本在卡内加载。
- [架构与操作](docs/ARCHITECTURE.md)：目录、`src/index.yaml`、`project.json`、命令与构建流程。
- [升级与备份](docs/UPDATING.md)：备份范围、升级步骤、旧卡迁移、自建卡的版本管理与回滚。
- [验证](docs/VERIFICATION.md)：检查覆盖、证据层级与报告方式。
- [来源索引](docs/SOURCES.md)：锁定的参考资料与公开来源。

## 边界

- 工具只做本地静态检查与打包，**不等于真实酒馆实测**。`project.json` 的 `runtimeVerified` 记录实际核实结果，`null` 表示尚未核实。
- `check` 只做解析与编译级检查，不执行卡里的脚本、EJS 和界面代码，也不联网验证外链可用性。
- 公开依赖必须写进 `project.json` 的 `dependencies`：无凭据 HTTPS，地址里含固定版本或提交；自写资源默认内嵌，也可按 [外链资源](docs/REMOTE-ASSETS.md) 发布到自己的公开仓库。
- 界面 HTML 以 Base64 编码写进卡，用来避开宿主对 `$1` 和宏的替换，属于编码而不是加密，内容仍然可读。
- 本工作区内容限非商业使用，详见 [LICENSE](LICENSE)。
