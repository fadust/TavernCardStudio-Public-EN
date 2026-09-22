# 模板使用

`pnpm card new <名称>` 使用 `base/` 下的骨架创建纯文字卡的 `src/index.yaml` 与 `project.json`。`--modules "worldbook,regex,script,mvu,html,vue"` 从 `modules/` 按需组合；初始界面请选择 `html` 或 `vue` 中一种。

模板是起点，不是已完成的角色。创建后编辑卡目录的 `src/`，不要修改模板来修改一张已有卡。更新模板只影响以后新建的卡。

世界书模板中的 `category` 仅指定新建工程的本地分类目录，不写入卡 JSON，不改变激活或注入顺序。生成路径使用 `src/worldbook/<分类>/<条目名>.yaml` 与正文文件；深度条目默认系统角色。已有工程整理见 [世界书文件](../docs/WORLDBOOK-FILES.md)。

| 模块 | 提供内容 | 运行依赖 |
| --- | --- | --- |
| worldbook | 常驻设定和关键词条目示例 | 酒馆世界书功能 |
| regex | 备注折叠正则与测试样例 | 酒馆正则功能 |
| script | 消息事件监听与卸载示例 | 酒馆助手 |
| mvu | 初始状态、固定变量列表/输出协议、更新规则、Zod 4 schema.ts 与注册器、完整/流式四条正则及样例 | 酒馆助手（提供全局 z）、固定提交的 MVU 与 Zod 适配器，加载公开地址需要网络 |
| html | 普通 HTML/CSS/JavaScript 状态栏 | 酒馆助手前端渲染、卡内正则 |
| vue | Vue 单文件界面；同时选择 mvu 时替换为 MVU 读取界面 | 酒馆助手前端渲染、卡内正则；MVU 按组合决定 |

普通前端也可以接入酒馆助手原生变量、自写逻辑或固定文本，不要求 MVU。MVU 卡也可以只输出叙事，不要求界面。

MVU＋界面组合消费框架自动添加的 `<StatusPlaceHolderImpl/>`，不生成让模型输出占位符的条目；无界面时另配两条显示/提示词清理。独立界面继续使用 `<CardStatus/>`。世界书模块默认按世界观、地理总览、地点、角色总览、人物与深度规则排列，双方递归关闭；这些是可按创作者目标调整的模板默认值。

`prompts/创作简报.md` 和 `prompts/角色写作检查.md` 用于组织创作需求，不会自动进入角色卡。

## 修改或增加模块模板

每个模块由 `module.json` 声明世界书条目、正则、脚本、资源与构建类型。正文使用 `contentFile`，正则替换文本使用 `replacementFile`，脚本使用 `source`。新建工具分配新的正则和脚本 UUID；导入已有卡不使用该流程，也不重置 UUID。

`files` 是模板资源到新卡相对路径的映射。可执行构建入口由工具登记到对应正则或脚本条目的 `构建` 上，不使用私有仓库外链。修改构建行为时同时补充离线资源测试。

MVU 新模板的 `src/schema.ts` 是运行时结构真源，独立注册脚本通过固定提交的 `registerMvuSchema` 接入 MVU。`src/variables/schema.json` 是编辑参考投影；仓库模板测试会校对投影，普通卡的 `check/build` 不执行 Schema，也不会自动重新生成 JSON。

固定协议资产为 `modules/mvu/variables.md`、`modules/mvu/format.md`；普通写卡不改宏、标签和操作字段，只改 `schema.ts`、`initvar.json`、`rules.md` 与需要展示的 UI。协议升级与来源证据见 [MVU 模板说明](modules/mvu/NOTES.md)。完整规则由 [MVU skill](../.agents/skills/tavern-mvu/SKILL.md) 和 [Zod skill](../.agents/skills/tavern-mvu-zod/SKILL.md) 按需加载。
