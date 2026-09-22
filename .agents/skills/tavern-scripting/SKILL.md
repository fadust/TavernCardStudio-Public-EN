---
name: tavern-scripting
description: 编写或维护角色卡酒馆助手脚本与 EJS，处理事件、按钮、变量作用域、MVU 读写和生命周期；界面布局使用 tavern-frontend。
---

# 酒馆助手脚本与 EJS

先读本卡 `src/index.yaml`、`src/scripts/*.yaml` 与 [脚本文档](../../../docs/SCRIPTS.md)。需要具体接口、事件或故障定位时读 [运行时参考](references/script-runtime.md)，再从锁定 `@types` 查函数签名，不全量加载上游。

条目键名与卡 JSON 字段的完整对照见 [中文键对照](../../../docs/ARCHITECTURE.md#中文键对照)。

## 环境与生命周期

- 脚本在宿主 iframe 中运行，正文由 esbuild 打成单个 ESM 写回该脚本条目的正文。条目用 `类型: 脚本`／`类型: 文件夹` 组织，按钮与数据写在条目 YAML：数据小就内联 `数据`，超过 2000 字符时用同名 `.data.yaml` 的 `数据文件`，两者互斥。脚本保存的变量写在 `src/index.yaml` 的 `助手变量`；保留工具生成的 `关联`。
- 本仓库没有自动导入。符号要么显式 import 可解析的本地包，要么由目标宿主提供全局；`check` 不验证未定义名字。
- 注册 Zod 时使用宿主全局 z，不能额外打包另一份 Zod。其它包是否使用全局或打包由实际需求和兼容性决定。
- 初始副作用放在 `$(() => {...})` 等可靠加载入口；动态加载场景不依赖已经触发的 DOMContentLoaded。
- 用 pagehide 清理 DOM、样式、定时器和监听。重复加载、swipe、编辑和切聊天时保持幂等，避免同一副作用执行多次。
- 脚本 iframe 中 `$` 可能指向宿主页面，document 仍是自身 iframe；需要挂 DOM/样式时先确认目标文档。

## 事件、按钮与变量

`eventOn` 返回的 stop 可显式取消；签名以 `@types/iframe/event.d.ts` 为准。跨脚本通信使用自定义事件名，不伪造宿主内建事件。新旧状态比较放更新事件，纯值归一交 Schema。

按钮名称保持稳定，`appendInexistentScriptButtons` 只补缺失按钮；整体替换用 `replaceScriptButtons`。脚本设置使用 `{ type: 'script', script_id: getScriptId() }`，不要混入玩家世界状态。读写前检查作用域和缺失值。

## MVU

- 调用 Mvu API 前 `await waitGlobalInitialized('Mvu')`。脚本列表顺序不保证远程 import 和异步初始化顺序。
- 普通脚本指定 message_id 或 latest；只有楼层 iframe 可用 getCurrentMessageId。写回前保留原变量表的其它键。
- 自己生成但未创建楼层的消息才需要手动 parseMessage，再写回目标楼层；正常框架已解析的消息不重复应用。
- `registerMvuSchema` 的独立注册脚本须尽早订阅初始化事件，和“等待 Mvu 后读写”的消费者流程区分；详细约束见 [Zod skill](../tavern-mvu-zod/SKILL.md)。
- 直接 helper/Mvu 写入不等于走完整模型补丁流程；需要约束时明确校验，不能默认注册器拦截所有直接写入。

## EJS

按状态决定提示文本用 EJS；持续监听、按钮或数据写入用助手脚本。EJS 依赖 Prompt Template，生成和楼层渲染都可能执行，用 runType 区分 `generate/preparation/render/render_permanent`，不要假定只执行一次。

宏 `{{user}}`/`{{char}}` 由宿主处理，不是 EJS。没有 Prompt Template 时 EJS 不会自行执行。把用户文本当数据，不拼成可执行模板；接口与阶段变量见脚本文档。

## 验证

`card check` 解析语法并审计依赖；`card build` 合并代码。对自编受信任逻辑做必要测试，导入卡脚本不执行。真实宿主验证事件、切聊天、重复加载与卸载后的行为；没有证据时不宣称已实机兼容。
