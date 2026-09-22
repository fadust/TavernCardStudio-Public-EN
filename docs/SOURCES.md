# 来源索引

写卡结论要能追溯。这一页列出本工作区使用的资料和它们的边界。

## 本地资料

工作区内的 `references/upstream/` 存放上游源码与文档镜像，配置在 `maintenance/reference-sources.json`，锁定信息在 `maintenance/references.lock.json`，检索索引在 `references/index.json`。`pnpm refs search` 从这里检索，`pnpm refs check` 校验完整性，`pnpm refs restore` 按锁还原，`pnpm refs update` 负责刷新。

每个来源都固定提交（含 `pinCommit` 的来源强制固定），并记录 `fetchedAt`、逐文件 sha256 与许可证。资料目录只读，内容不自动打进卡。

`references/upstream/` 与 `references/index.json` 是本地缓存，**不随公开发布分发**；`maintenance/reference-sources.json` 与 `maintenance/references.lock.json` 随仓库保留。克隆、清理或缓存损坏后先运行 `pnpm refs restore`：它只读锁文件，按锁定的完整提交与文件清单取字节，逐文件按 sha256 校验，已存在且校验通过的文件直接复用；不使用 GitHub tree API，也不解析最新分支，锁文件的内容与时间保持不变，失败会回滚且不损伤现有缓存。只还原部分来源时用 `--source <id>`，其余来源缺失不影响；还原完成会重建本地索引。未还原时 `pnpm refs search` 与 `pnpm refs check` 都会提示先运行 restore。

`pnpm refs update` 是主动刷新，与 restore 分工不同：update 对有 `pinCommit` 的来源使用固定提交，其余解析 `ref` 到当时的最新提交、重新下载、重写锁文件与 `fetchedAt` 并重建索引；只有在需要升级锁定的来源或首次生成锁文件时才用它。日常重建缓存用 restore，不要用 update 顺手改锁。

**许可证不在文档里复述**：每个来源的 `spdx` 与 `source` 字段以 `maintenance/references.lock.json` 为准，实际条款读 `references/upstream/<来源>/` 里那份 LICENSE 原文。锁文件记录与上游标注不一致时，以锁文件加原文为准；不要按项目名或印象补写许可证。

| 来源 id | 内容 |
| --- | --- |
| `tavern-helper` | 酒馆助手运行时 API 类型（`@types/`） |
| `tavern-helper-docs` | 酒馆助手中文文档 |
| `sillytavern` | 角色卡解析、世界书、提示词与聊天注入、宏、斜杠命令、正则引擎源码 |
| `sillytavern-docs` | 官方文档：宏、世界书、角色、聊天、正则 |
| `prompt-template` | ST-Prompt-Template（EJS）文档与源码 |
| `tavern-helper-template` | StageDog 模板：AGENTS.md、.agents 技能、模板与示例、MVU 类型、webpack 入口 |
| `mvu` | MVU 变量框架源码与文档（固定 `3377b494`） |
| `tavern-resource` | Zod 注册适配器源码、产物及必要辅助文件（固定 `69abb272`）；新 MVU 模板使用同一提交 |
| `character-card-spec` | 社区角色卡规范 v2 字段（`chara_card_v2`） |
| `character-card-spec-v3` | 角色卡规范 v3 权威文本（`SPEC_V3.md`） |

`tavern-helper` 的 `@types` 描述的是旧版酒馆助手接口，MVU 相关接口以锁定的 `mvu` 来源为准。`mvu` 锁定到与 jsDelivr 运行依赖 `artifact/bundle.js` 一致的提交；`doc/tutorial.md` 里的 `_.set` 写法只作为上游资料保留，该提交的 JsonPatch 语义以锁定的源码为准。

**规范和宿主支持要分开看**：字段该叫什么、该不该出现，以规范为准；某个酒馆版本能读哪些字段、能不能导入，以那个版本的解析与校验实现为准。本工作区能无损保留 V3 卡 JSON 里的字段，**不等于**支持 CHARX 打包：工具只处理 PNG 与 JSON 两种承载，也不自动转换旧格式。

写卡常用路径：

- 卡 JSON 字段规范：`references/upstream/character-card-spec/spec_v2.md`、`references/upstream/character-card-spec-v3/SPEC_V3.md`（具体文件名以 `maintenance/references.lock.json` 记录的 `local` 路径为准）
- 世界书分组与位置：`references/upstream/sillytavern/public/scripts/world-info.js`；最终消息排列还需核对 `public/script.js` 的 `doChatInject`、`public/scripts/openai.js` 的 `populationInjectionPrompts` 与 `public/scripts/PromptManager.js` 的提示词列表。上述路径相对于该来源根目录。
- 正则作用位置与替换语义：`references/upstream/sillytavern/public/scripts/extensions/regex/engine.js`
- 角色卡解析与校验：`references/upstream/sillytavern/src/character-card-parser.js`、`references/upstream/sillytavern/src/validator/TavernCardValidator.js`
- 酒馆助手接口：`references/upstream/tavern-helper/@types/function/`、`references/upstream/tavern-helper/@types/iframe/`
- MVU 变量更新与事件：`references/upstream/mvu/src/function/`
- MVU JSONPatch 形状校验：`references/upstream/mvu/src/util.ts`；配置与阶段筛选结合 `src/store.ts` 与 `src/function/request/filter_entries.ts`
- Zod 注册器：`references/upstream/tavern-resource/util/mvu_zod.ts`，对应产物 `dist/util/mvu_zod.js`
- EJS 可用函数与语法：`references/upstream/prompt-template/docs/reference_cn.md`

## 公开资料

| 主题 | 地址 |
| --- | --- |
| SillyTavern 文档 | https://docs.sillytavern.app/ |
| SillyTavern 源码 | https://github.com/SillyTavern/SillyTavern |
| 酒馆助手文档 | https://n0vi028.github.io/JS-Slash-Runner-Doc/ |
| 酒馆助手类型声明 | https://github.com/N0VI028/JS-Slash-Runner |
| Prompt Template（EJS） | https://github.com/zonde306/ST-Prompt-Template |
| MVU 变量框架 | https://github.com/MagicalAstrogy/MagVarUpdate |
| StageDog 注册适配器 | https://github.com/StageDog/tavern_resource |
| Zod 4 API | https://zod.dev/api |
| 角色卡规范 V2 | https://github.com/malfoyslastname/character-card-spec-v2 |
| 角色卡规范 V3 | https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md |

## 已核对的实现细节

以下结论在 2026-09-18 对照实现核对过：MVU 用固定提交 `3377b494…`，SillyTavern 用 release 分支当时的提交 `06bde939…`；实际以 `maintenance/references.lock.json` 记录的提交为准。

- 卡内世界书条目的字段与位置枚举、`insertion_order` 的插入方向、深度注入的角色取值，对照 SillyTavern 的 `public/scripts/world-info.js` 与酒馆助手的条目类型声明。
- 正则脚本的字段与作用位置枚举，对照 SillyTavern 的 `public/scripts/extensions/regex/engine.js`。
- 助手脚本的字段结构、MVU 的 `stat_data` 与更新事件、前端与脚本的运行环境，对照 `@types/` 与酒馆助手文档。
- 角色卡 PNG 里的 `chara` 与 `ccv3` 数据块、卡 JSON 与卡内世界书的字段映射，对照 SillyTavern 的 `src/character-card-parser.js`、`src/validator/TavernCardValidator.js` 与锁定资料中的打包实现。
- V3 的字段名与结构对照 `character-card-spec-v3` 的 `SPEC_V3.md`；宿主对 V3 的实际支持范围另看 SillyTavern 的解析与校验实现，两者不互相替代。
- 2026-09-18 至 19 核对 MVU 的五种输出操作、move.to 形状例外、注册器接管命令与逐条解析、宿主全局 Zod 实例；新模板的协议资产与这些固定实现对应。
- 研究用的参考卡只作为输入，技能、模板与测试不依赖任何私有卡文件；提炼后的结论要能脱离原卡使用。
- MVU 自动状态栏标记与阶段过滤：`mvu/src/function/update_variables.ts`、`function_call.ts`、`request/filter_entries.ts`、`request/worldinfo_scan.ts`；模板模式说明见 [MVU-MODES.md](MVU-MODES.md)。
- 同深度多角色排序：上述 SillyTavern 提交的 `public/script.js#doChatInject` 与 `public/scripts/openai.js#populationInjectionPrompts` 最终为 assistant → user → system；缓存官方 prompt-manager 文档描述与代码不一致，此处以实现为准，未替代真实宿主预览。
- 地点扫描注入：`tavern-helper/@types/function/inject.d.ts` 的 `position: 'none'`、`should_scan`，并对照 `sillytavern/public/scripts/world-info.js` 的扫描缓冲与递归筛选。目录或变量里的地名不等于扫描材料。

这些是源码层面的核对结果，来自 `pnpm refs restore` 还原并按 sha256 校验过的锁定源码文本，不代表在真实酒馆里跑过。源码、CI 与真实宿主三类证据不互相替代；实机结论一律记在 `project.json` 的 `runtimeVerified`。

## 引用规则

- 引用字段名、枚举值、函数签名时写清来源文件和版本。
- 引用会变化的资料时记录查阅日期。
- 公开文档滞后于实现时以实现为准，并在文档里注明。
- 转述第三方资料只写通用知识，不复制他人的私有卡协议、提示词或打包配置。
