# 界面运行时与构建细节

补充 [../SKILL.md](../SKILL.md)：流程写在工作区文档 [docs/FRONTEND.md](../../../../docs/FRONTEND.md)，这里写本仓库具体怎么编译、运行时装在哪、报错是什么意思。

## 1. 卡里实际有什么

`pnpm card new <名称> --modules 'vue'`（或 `html`）一次做四件事，实现见 `tools/lib/templates.mjs`：

| 位置 | 内容 |
| --- | --- |
| `src/ui/html/` 或 `src/ui/vue/` | `index.html`、`main.js`、`style.css`；Vue 还有 `App.vue` |
| 正则条目的 `构建` | `{ 类型: 'html' 或 'vue', 入口: 'src/ui/<kind>/index.html' }` |
| `src/regex/*.yaml` 的两条正则 | `内嵌状态栏`（仅格式显示，`查找` 就是占位符）、`屏蔽状态栏占位（仅提示词）` |
| 卡内容 | 与 MVU 组合时使用框架自动添加的 `<StatusPlaceHolderImpl/>`，不生成输出条目；独立界面才在 `first_mes` 末尾添加 `<CardStatus/>` 并配 `状态栏输出位置` 条目 |

`vue` 且同时选了 `mvu` 时，`App.mvu.vue` 会覆盖 `App.vue` 然后被删除。`构建` 写在正则条目上，结果写回它的 `替换文件`：界面不需要单独的脚本条目。

在已有卡上手动加第二个界面时，补齐标记、正则、构建与可靠的生产者。MVU 标准标记由框架产生；其它标记可由脚本或明确的输出约定产生，不一律交给模型。每个独立界面使用不同标记，或在一次替换中组合，避免正则互相抢。

## 2. 构建怎么写回

- `script` 构建：esbuild（`bundle: true`、`format: 'esm'`、`platform: 'browser'`、`target: 'es2022'`），产物必须只有一个文件。脚本里 `import './x.css'` 会多出一个文件并直接报错：`脚本生成了多个文件（例如独立 CSS）；请将界面作为 html/vue 构建。`
- `html`/`vue` 构建：Vite（`configFile: false`、root 为入口目录、`publicDir: false`、`base: './'`）+ `vite-plugin-singlefile`，`assetsInlineLimit: () => true` 把所有资源内联；产物必须同时只有一个 `.html`，否则报 `未能生成单文件 HTML，残留: ...`。
- 写回：脚本写进 `content`；界面经 `embedHTML` 包成带 ```` ```html ```` 围栏的完整 HTML 后写进 `replaceString`。围栏里是 `<!doctype html><html><head><meta charset='utf-8'></head><body><script>(()=>{const html=new TextDecoder().decode(Uint8Array.from(atob('...'),c=>c.charCodeAt(0)));document.open();document.write(html);document.close();})();</script></body></html>` 这个形状（Base64 是编码不是加密）。
- 构建前先 `checkProject`，构建后再对产物跑一次 `auditResources(..., { bundled: true })`：成品里残留相对资源或裸模块导入都算错误。
- `dist/<名称>/scripts/*`、`ui/*` 只是检查副本，编号不保证与旧版或条目顺序一致；写回哪个条目由该条目上的 `构建` 决定，不要按产物文件名反推条目。

## 3. 依赖与资源审计（`tools/lib/resources.mjs`）

- `dependencies` 每项必须有 `url`、`purpose`、`version` 三个非空字符串；URL 必须是无凭据 HTTPS，且 `decodeURIComponent(url)` 里要包含 `version` 写的字符串；`version` 不能是 `latest`/`main`/`master`/`beta`/`dev`/`head`。
- 会拦下：`file:`、盘符路径、UNC 路径、`localhost`/`127.`/`0.0.0.0`/`[::1]`/`10.`/`192.168.`/`172.16-31.` 等开发或局域网地址、未在 `dependencies` 声明的外部地址、未知协议。
- 打包产物（`bundled: true`）：残留的相对资源、残留的裸模块 import 都算错误。
- 拼出来的动态地址、带宏/模板变量的地址、动态 `fetch`/`import()` 不会被拦，但会进 `dist/<名称>/build-report.json` 的 warnings，需要人工核对。

## 4. 运行时装在哪、能用什么

| 类别 | 内容 | 证据 |
| --- | --- | --- |
| 楼层 iframe 接口 | `eventOn`、`getChatMessages`、`getVariables`、`getWorldbook`、`generate`、`injectPrompts`、`registerMacroLike`… | `references/upstream/tavern-helper/@types/function/` |
| iframe 专属接口 | `getCurrentMessageId`、`getIframeName`、`reloadIframe`、`eventEmit`、`tavern_events`、`iframe_events` | `references/upstream/tavern-helper/@types/iframe/` |
| 跨脚本共享 | `initializeGlobal`、`waitGlobalInitialized` | `@types/function/global.d.ts` |
| MVU | `Mvu.getMvuData`、`replaceMvuData`、`parseMessage`、`events` | `references/upstream/mvu/` |
| iframe 内置第三方库 | `$`(jQuery)、`_`(lodash)、`toastr`、`Vue`、`VueRouter`、`YAML`、`z`(zod)、`PIXI`、showdown（`builtin.renderMarkdown`）、tailwindcss | `references/upstream/tavern-helper-docs/src/guide/功能详情/内置第三方库.md` |

这些第三方库是**扩展运行时**给 iframe 的全局变量，不是本仓库的包：可以直接用，但 `check` 只做 acorn 语法解析（`tools/lib/validation.mjs`），拼错名字、目标版本没带这个库都不会在本地报错，要到实机才暴露。哪个版本、哪类 iframe 里一定齐全需要实机核对，没核对前不要写进结论。

jQuery 的作用域在两处不同：

- 脚本 iframe：上游模板 skill 记为 `window.$ = window.parent.$`，`$('body')` 选的是酒馆页面的 body。
- 楼层界面 iframe：`$` 和 `document` 都在这个 iframe 自己的文档里。

## 5. 上游模板是另一套构建环境

| 方面 | 上游 `references/upstream/tavern-helper-template/` | 本仓库 |
| --- | --- | --- |
| 打包 | webpack（`webpack.config.ts`），`dist/` 交给 jsDelivr | esbuild（脚本）、Vite + singlefile（界面），产物内嵌进卡 |
| 自动导入 | `unplugin-auto-import` 注入 `vue`、`pinia`、`@vueuse/core`、`klona`、`z`、`dedent` 等 | 没有；每个符号都要自己 import，或来自运行时全局 |
| 未安装的包 | `externals` 把 `jquery`/`lodash`/`toastr`/`vue`/`vue-router`/`yaml`/`zod` 映射到 iframe 全局，其余自动变成 jsDelivr 的 `+esm` 远程 import | 只解析 `node_modules`；远程地址必须声明在 `dependencies` |
| 样式 | sass/postcss/tailwind、`<style lang='scss'>`、html-loader、remark-loader、`?raw` | Vite 原生 CSS、`?raw`/`?url`；没有 sass/tailwind 构建链 |
| 交付 | 仓库托管 `dist/`，卡里用 URL 加载 | 默认单文件随卡内嵌；可按 [外链流程](../../../../docs/REMOTE-ASSETS.md) 选择固定版本托管 |

上游 `util/`（`mvu.ts` 的 `defineMvuDataStore`、`script.ts` 的 `teleportStyle`/`createScriptIdIframe`、`streaming.ts` 的 `mountStreamingMessages`）依赖 pinia、`@vueuse/core`、`klona`、`?raw` 与 html 加载器，属于那套环境。要复用就得按本仓库工具链改写或补依赖。

## 6. 报错对照

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `未声明的外部资源 <URL>` | 外链没写进 `project.json.dependencies` | 声明 `{url, purpose, version}`，或改成内嵌 |
| `依赖地址必须包含固定版本或提交` | `version` 不在 URL 里，或写成了 latest/main | 固定到提交或版本号，URL 同步改 |
| `成品残留未解析模块 <包名>` | 代码里 import 了没安装的包 | 改用运行时全局，或补依赖（仓库级改动） |
| `成品残留相对资源 <路径>` | 资源没被内联（动态拼接、运行时构造的 URL） | 改成静态 import 或内联 data URL |
| `脚本生成了多个文件` | 脚本里 import 了会单独产出文件的资源（如 CSS） | 把界面做成 `html` 或 `vue` 构建 |
| 界面在酒馆里不显示 | 缺 `<body>`、正则被禁用、没开前端渲染、占位符没进楼层 | 逐项对照本文第 1、2 节与 `渲染器.md` |
