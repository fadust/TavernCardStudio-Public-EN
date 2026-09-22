# 验证

验证分三层，混在一起报告会让人误判。

| 层级 | 手段 | 能证明什么 |
| --- | --- | --- |
| 静态检查 | `pnpm card check <名称\|all>` | 结构、映射、语法与资源自洽；不能证明运行时可用 |
| 构建 | `pnpm card build <名称\|all>` | 能产出可导入的卡；不能证明导入后表现正确 |
| 真实宿主 | 在装有对应酒馆与扩展的环境里手动验证 | 卡在真实环境的行为；必须记录版本与核实范围 |

`project.json` 的 `runtimeVerified` 默认是 `null`，表示还没有真实宿主证据。做过的核实写进这一项，写清版本和验证了什么。写卡时不要替用户填这个字段，也不要把静态检查的结果混进去。

## 验证命令

| 命令 | 范围 | 前置条件 |
| --- | --- | --- |
| `pnpm doctor:workspace` | 环境与工具是否就绪（Node 版本、pnpm 版本、依赖、锁文件、脚本可用）；只读，不安装不写文件 | 无 |
| `pnpm card check <名称\|all>` | 单卡或全部卡的静态检查 | 无 |
| `pnpm card build <名称\|all>` | 先检查再构建到 `dist/` | 无 |
| `pnpm verify` | 离线总校验：单元测试 → 官方示例逐张 `build` → `release:check` | 已装依赖；不需要参考资料 |
| `pnpm refs restore [--source <id>]` | 只取锁定的完整提交与文件、按 sha256 校验，还原到 `references/upstream/`；不改锁文件 | 能访问锁文件记录的上游 |
| `pnpm verify:refs` | 参考资料完整性、逐文件哈希、索引与锁版本一致性（等价于 `pnpm refs check`） | 先跑 `pnpm refs restore` |
| `pnpm release:check` | 公开清单（`maintenance/public-release.json` 登记的文件、目录与官方示例）、文档链接与常见凭据标记 | 维护者按发布流程使用 |

`pnpm verify` 不读 `references/`，因此新克隆的仓库可以直接跑。反过来，`refs check` 与 `verify:refs` 需要参考资料缓存；公开包不带上游实体，先在能联网的环境跑 `pnpm refs restore`。缓存只按锁文件记录的版本取回，不改变锁版本；`pnpm refs update` 只用于有意升级锁版本。

本地管理页面使用 `pnpm test:studio-ui`，覆盖新建、导入、复制示例、封面、打包、移动端布局与关闭服务。默认使用已安装的 Chrome；CI 使用 Playwright 自带 Chromium：先运行 `pnpm exec playwright install chromium`，再设置 `TAVERN_TEST_BROWSER=chromium` 执行。PowerShell 设置方式是 `$env:TAVERN_TEST_BROWSER='chromium'`。这些检查不执行导入卡代码，不代表真实酒馆环境。

`pnpm test:ui` 是另一套受信任旧示例界面的浏览器测试，需先 `pnpm verify:examples`，会加载指定仓库示例的界面代码；只在维护那些示例时使用，不能把入口改成自动扫描用户卡。

## card check 检查什么

- 必填文本字段的类型、卡名非空、`spec` 与 `spec_version` 一致、`alternate_greetings` 与 `tags` 是字符串数组。
- `project.json` 的结构与版本、`project.name` 与目录名一致，以及 `src/index.yaml` 引用与条目 YAML 的重复与越界、文件是否都在 `src/` 内。
- `src/index.yaml` 的顶层键与条目 YAML 的键是否都在允许列表内；未知键按错误处理，不静默忽略。
- `project.json.state.sha256` 与 `.card/state.json` 是否一致，`.card/` 里的兼容数据与迁移快照是否原样保留，以及 `original/` 原件与基线的 sha256。
- 依赖项：无凭据 HTTPS、地址中包含 `version` 所写的固定版本、无重复。
- 头像能被解析成 PNG。
- 世界书条目：`content` 是字符串、`keys` 是数组；已启用但既非常驻、又没有关键字、也没有向量化的条目会给出警告。
- 正则：id 不重复、`findRegex` 能编译、`replaceString` 是字符串、`placement` 是数组；`substituteRegex` 非 0 时给出警告，因为查找表达式里的宏展开与触发路由只能在真实宿主里核对。
- `src/` 下的源码语法：JavaScript 用 acorn 解析，TypeScript 用 esbuild 只做语法转换（不做类型检查），Vue 做单文件组件解析并编译脚本与模板。
- EJS：文件里出现 `<%` 时尝试编译，失败只记警告，因为跨条目的模板片段需要在实际注入顺序里核对。
- 资源审计：相对资源必须存在且不越界；未声明的外部地址、本机路径、局域网地址、未知协议都算错误；成品里残留的相对资源与未解析模块也算错误。
- 组装出的卡 JSON 里其余字符串同样会扫描 `script`、`img`、`iframe`、`link` 与 `fetch`／`import`，避免隐藏的外链绕过检查。
- 正则样例 `tests/regex.json`：每条按 `id` 或 `name` 找到正则，执行替换后与 `expected` 比较。样例只覆盖固定版本的替换组与 trim 语义，不模拟宏展开和触发路由。

仓库的 `mvu-template.test.mjs` 对受信任模板执行 Zod 初值/夹值/幂等验证、schema.json 投影校对及正则组合测试；`complex-example.test.mjs` 显式核对原创综合示例的各开场初值、派生状态、非法输入与投影。这些测试只执行已审查的固定源码，不扫描或执行用户卡 Schema，也不能将模板通过等同于所有自定义卡都满足变量规则。

`card check` 不会：执行卡里的任何代码、联网请求外链、在浏览器或酒馆里加载卡。

`card diff` 用 `original/card.json` 基线与当前编辑区做语义比较。构建产物与编辑源的差异属于正常现象，`diff` 会单独列出待构建项，产物详情见 `build-report.json`。

## card build 产出什么

1. 先跑一次检查，有错误就停止。
2. 逐个编译条目 YAML 上的 `构建`：`script` 用 esbuild 打成单个 ESM 文件并写回脚本正文；`html` 与 `vue` 用 Vite 打成单文件 HTML，Base64 包装后写回正则条目的 `替换文件`。
3. 对没有参与构建的 `src/` 文件再做一次资源审计，确认随卡资源自包含。
4. 产物写入 `dist/<名称>/`：先写临时目录再整体替换，旧产物在成功后删除，失败时保留原目录。

`build-report.json` 记录：输入文件与产物的 sha256、产物字节数、依赖清单、实际出现的外部地址、警告，以及 `checks` 里的三项结论：`static`、`localBuild`、`realTavern`（未核实时为 `not-tested`）。产物总量超过 5 MiB 时会追加一条警告。

## 跨模块改动的检查顺序

改世界书、变量、正则、脚本或界面时，按 [复杂卡模块联动](COMPLEX-CARDS.md) 的依赖链核对上下游，再选命令：

- 只改文档：检查链接与措辞，不跑构建。
- 只改文本字段、世界书正文或卡内设定字段：`check` 加一次 `build`。
- 改脚本、EJS、界面源码或依赖：`check`、`build`，并在 `dependencies` 里更新版本记录。
- 改 `src/index.yaml` 或条目 YAML 的引用、模块或 `构建`：先 `check`，再 `build`，导入过的卡再跑 `diff` 确认没有意外差异。
- 改模板、工具或官方示例：跑 `pnpm verify`；改过参考资料或锁文件再加 `pnpm refs restore` 与 `pnpm verify:refs`。

相同输入的检查不要反复跑：已经通过的检查，只要输入没变，就不用在新阶段重跑。

## 写完一张卡要报什么

报告里分开写清四件事：

1. 改了哪些文件。
2. 检查与构建的实际结果（命令、通过与否、产出的文件）。
3. 依赖用了哪些外部资源，版本是多少。
4. 哪些结论来自静态检查或构建，哪些来自真实宿主；没做过实机验证就明确写未验证。

没有实机验证时，不要写"已在酒馆中测试通过"，也不要因为字段名对得上就宣称兼容某个酒馆或扩展版本。
