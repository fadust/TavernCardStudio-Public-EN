# 脚本运行时细节

补充 [../SKILL.md](../SKILL.md)：脚本字段结构、接口分组、事件要点、MVU 读写、生命周期与报错对照。流程写在工作区文档 [docs/SCRIPTS.md](../../../../docs/SCRIPTS.md)。

## 1. 卡里的脚本结构

`data.extensions.tavern_helper` 里有 `scripts`（脚本树数组；顺序不保证异步初始化完成顺序）和 `variables`（该卡脚本保存的变量）。字段以 `references/upstream/tavern-helper/@types/function/script.d.ts` 为准：

| 字段 | 含义 |
| --- | --- |
| `type` | `script` 或 `folder` |
| `id` | 唯一字符串 id，跨版本保留 |
| `name` | 脚本名 |
| `enabled` | 是否启用 |
| `content` | 脚本正文（构建目标） |
| `info` | 作者注释 |
| `button` | `{ enabled, buttons: [{ name, visible }] }` |
| `data` | 脚本自带数据 |
| `export_with` | `{ data, button }`，导出时是否携带 |
| `icon`/`color`/`scripts` | 只有文件夹有这三项 |

每个脚本条目是一个 `src/scripts/*.yaml`，正文用 `文件` 指向 `src/...`；来自根层旧字段 `extensions` 的脚本会带 `legacy-` 前缀。名称、启用、顺序、按钮、data 与工具生成的 `关联` 都写在条目 YAML 里，保留 `关联`，不要手改或重编号。

## 2. 接口分组（iframe 里直接可用，不需要 import）

| 主题 | 常函数 | 类型文件 |
| --- | --- | --- |
| 楼层消息 | `getChatMessages`、`setChatMessages`、`createChatMessages`、`deleteChatMessages`、`rotateChatMessages` | `@types/function/chat_message.d.ts` |
| 显示 | `formatAsDisplayedMessage` | `@types/function/displayed_message.d.ts` |
| 变量 | `getVariables`、`replaceVariables`、`updateVariablesWith`、`registerVariableSchema` | `@types/function/variables.d.ts` |
| 世界书 | `getWorldbook`、`replaceWorldbook` 等 | `@types/function/worldbook.d.ts` |
| 生成 | `generate`（带预设）、`generateRaw` | `@types/function/generate.d.ts` |
| 正则 | `formatAsTavernRegexedString` | `@types/function/tavern_regex.d.ts` |
| 注入 | `injectPrompts`、`uninjectPrompts` | `@types/function/inject.d.ts` |
| 宏 | `registerMacroLike`、`unregisterMacroLike` | `@types/function/macro_like.d.ts` |
| 共享 | `initializeGlobal`、`waitGlobalInitialized` | `@types/function/global.d.ts` |
| 工具 | `substitudeMacros`、`getLastMessageId`、`errorCatched` | `@types/function/util.d.ts` |
| iframe 专属 | `getScriptId`、`getCurrentMessageId`、`getIframeName`、`reloadIframe`、`getButtonEvent`、`replaceScriptButtons` 等 | `@types/iframe/{util,script}.d.ts` |
| 事件 | `eventOn`、`eventOnce`、`eventMakeFirst`/`eventMakeLast`、`eventEmit`、`eventClearAll` | `@types/iframe/event.d.ts` |

`@types/function/*` 同时导出到宿主的 `window.TavernHelper`；`@types/iframe/*` 只在 iframe 内可用。卡内脚本两者都能用。

事件要点：`eventOn` 的监听在 iframe 关闭时自动卸载；`MESSAGE_RECEIVED` 带第二个参数表示类型（normal/regenerate/swipe/…）；`CHAT_CHANGED` 传的是聊天文件名，切换后原楼层的上下文可能已经变了。要按事件参数写逻辑，去 `@types/iframe/event.d.ts` 的 `ListenerType` 对签名。

## 3. MVU 读写

| 调用 | 作用 |
| --- | --- |
| `await waitGlobalInitialized('Mvu')` | 等 MVU 就绪；MVU 用 `initializeGlobal` 共享（`mvu/src/function/global/index.ts` 的 `initGlobals`） |
| `Mvu.getMvuData(options)` | 读变量表，等价 `getVariables(options)` |
| `Mvu.replaceMvuData(data, options)` | 整体写回（返回 Promise） |
| `Mvu.parseMessage(message, old_data)` | 手动解析更新块，返回新数据或 `undefined` |
| `Mvu.isDuringExtraAnalysis()` | 当前是否额外模型解析轮 |
| `Mvu.events.*` | `VARIABLE_INITIALIZED`、`VARIABLE_UPDATE_STARTED`、`COMMAND_PARSED`、`VARIABLE_UPDATE_ENDED`、`BEFORE_MESSAGE_UPDATE` |

写回与刷新的落点：`mvu/src/function/update_variables.ts` 把 `initialized_lorebooks`、`stat_data`、`schema`、`display_data`、`delta_data` 写进楼层变量（有值才写），并按需 `setChatMessages([{ message_id }], { refresh: 'affected' })` 重建楼层显示。脚本不要旁路这条链路：改数据要么改 `MvuData` 后 `replaceMvuData`，要么在 MVU 事件里调整。

`display_data`/`delta_data` 只在 MVU 确实产生时存在，同文件注释已把它们标为 `@deprecated`（zod 流程不再需要）；读之前先判断存在。

`waitGlobalInitialized` 没有超时机制，界面侧要自己 `Promise.race` 加超时和降级提示（见 [../../tavern-frontend/SKILL.md](../../tavern-frontend/SKILL.md)）。

## 4. 生命周期与清理

```js
$(() => {
  const listener = eventOn(tavern_events.MESSAGE_RECEIVED, messageId => { /* ... */ });
  const $panel = $('<div>').appendTo('body');
  window.addEventListener('pagehide', () => {
    listener.stop();
    $panel.remove();
  }, { once: true });
});
```

- `$()` 是加载时机，`pagehide` 是卸载时机；顶层代码可能被重复加载。
- `eventOn` 的监听会自动卸载，定时器、DOM、复制的样式不会，必须自己清。
- 脚本 iframe 里的 `$` 指向酒馆页面（上游模板 skill 记为 `window.$ = window.parent.$`），`document` 仍是脚本自己的 iframe。给酒馆页面加样式要复制 `<style>` 到宿主 `<head>`（上游 `util/script.ts` 的 `teleportStyle` 是同一思路），卸载时移除。
- 要整段重载用 `reloadIframe()`；它会让 `initializeGlobal` 分享出去的接口失效，需要保留状态就自己写初始化与销毁。

## 5. 报错与证据边界

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 调用 `getScriptId`/`getCurrentMessageId` 抛错 | 这类函数只在对应 iframe 内可用 | 只在脚本正文（或楼层界面）里用；界面用 `getCurrentMessageId`，脚本用 `getScriptId` |
| 变量读出来是 `{}` | 变量还没写，或作用域、`script_id` 不对 | 打印 `getVariables(option)` 核对；读后给默认值 |
| 按钮越点越多 | 每次都 `appendInexistentScriptButtons` 追加新名字 | 名字保持稳定，或用 `replaceScriptButtons` 明确整组 |
| 组件/界面卸载后还在 | 挂载点、样式或定时器没清 | 在 `pagehide` 里成对清理 |
| MVU 事件不触发 | MVU 脚本没启用、顺序在后面，或远程脚本没加载成功 | 检查脚本库顺序和 `dependencies`，用 `waitGlobalInitialized` 加超时提示 |

`check` 只解析语法并审计资源，不执行脚本；本地构建成功不等于真实酒馆里能跑。实机结论记进 `project.json.runtimeVerified`。
