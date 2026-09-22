# 公开外链资源

这一页讲一件事：把自己写的脚本或界面放到公开 Git，用固定版本的 HTTPS 地址在卡里加载时，应该怎么写、怎么登记、哪里会失败、升级要注意什么。

`pnpm card check` 与 `pnpm card build` 只做本地静态检查与打包：不上传、不创建仓库、不推送、不发布，把产物提交到 Git 是你自己在 Git 平台完成的动作。自己写的代码默认随卡内嵌；外链是可选路径，只在多张卡共用同一份代码、需要频繁升级或产物很大时才值得用。

## 先构建，再发布

外链只能指向一个能直接加载的文件：

- 脚本：单个 JavaScript 文件。仓库内的产物由脚本条目上的 `构建: { 类型: script, 入口: src/... }` 用 esbuild 打成一份单文件 ESM，见 [助手脚本与 EJS](SCRIPTS.md)；你自己的打包流程要产出同样形状的单文件。
- 界面：单个 HTML 文件，由 `html`／`vue` 构建产出，见 [前端资源](FRONTEND.md)。

不要把下面这些当发布地址：

- `https://github.com/<owner>/<repo>/blob/...` 是 GitHub 文件浏览网页，返回页面而不是目标代码；它与浏览器的 `blob:` 临时地址是两回事。
- `blob:` 是浏览器在生成它的那次会话里的临时地址，对玩家的浏览器没有意义；写死的 `blob:` 地址会让 `check` 给出警告。
- `file:`、盘符路径、UNC 路径是本地文件；`check` 直接报错。
- `http://localhost`、`127.0.0.1`、`10.`、`192.168.`、`172.16.`–`172.31.` 是开发或局域网地址；`check` 直接报错。
- 未经构建的多文件工程：外链只会加载你写下的那一个地址，它的相对依赖必须由你自己发布在同一相对路径下，`check` 看不到你仓库里的其它文件。

## 依赖登记格式

公开外链登记在 `cards/<名称>/project.json` 的 `dependencies`，一条资源一项：

```json
"dependencies": [
  {
    "url": "https://cdn.jsdelivr.net/gh/<owner>/<repo>@<完整提交号>/dist/panel.js",
    "purpose": "本卡楼层脚本；固定提交，玩家不需要额外安装。",
    "version": "<完整提交号>"
  }
]
```

`url`、`purpose`、`version` 三个字段都是必填的非空字符串。`check` 的判定条件：

| 条件 | 判定 |
| --- | --- |
| 无凭据 HTTPS | 协议必须是 `https:`，地址里不能有用户名密码；查询串出现 `token=`、`access_token=`、`authorization=`、`key=`、`secret=` 也算带凭据 |
| 地址含固定版本 | `decodeURIComponent(url)` 必须包含 `version` 写的那串字符 |
| 版本不是可变引用名 | `version` 不能是 `latest`、`main`、`master`、`beta`、`dev`、`head`（不区分大小写） |
| 不重复登记 | 同一个 `url` 只能出现一次 |

推荐写完整提交号。部分非保留分支名或移动 tag 可能通过工具的字符串检查，但这不代表它们固定了版本，仍不符合工作区分发规范。版本目录也须实际保留旧文件；只在同一个可变文件后添加 `?v=...` 不会锁住字节。

同一份代码只登记一次，引用处与登记处使用一致的地址。协议相对地址会按 `https://` 再比较一次，登记处仍写完整 HTTPS 地址；默认也使用完整地址引用。

## 卡里怎么写引用

| 写法 | 语义与代价 |
| --- | --- |
| 脚本条目正文写 `import 'https://…/<提交>/panel.js';` | ESM 模块：严格模式、顶层 `this` 是 `undefined`，同一模块上下文同地址通常只求值一次；需要正确的 JavaScript MIME 和 CORS |
| 正则替换文本或内联 HTML 里写 `<script src="https://…/<提交>/panel.js"></script>` | 经典脚本：可在同一页面用全局共享；默认跨域加载与模块的 CORS 要求不同，但仍受 MIME、CSP 和 crossorigin 等设置影响 |
| `$.getScript('https://…')` | 加载并执行经典脚本，不适合含静态 import/export 的 ESM 产物 |
| `$(元素).load('https://…')` | 读取 HTML 插入当前 DOM，需要跨域许可；HTML 内脚本能否启动取决于其类型、选择器用法和宿主，不能与 getScript 混为一谈 |
| `$.ajax({ url: … })`、`$.get(…)`、`$.post(…)`、`$.getJSON(…)` | 选项或首参里的绝对地址进入资源审计；相对地址和变量地址给出人工核对警告，运行时地址需另查 |

ESM 与经典脚本不能混用：静态 `import` 语句只能出现在模块里；经典脚本加载器不适合直接加载本工作区的 ESM 产物。ESM 可通过 `export`/`import` 共享接口；跨脚本 iframe 共享则沿用酒馆助手全局初始化接口。不要默认挂 `window` 就能跨 iframe 访问。

## 扫描范围

`check` 扫描 `src/` 下的文本文件与卡 JSON，`build` 之后再扫一次构建产物。会进入依赖审计的位置：

- 资源标签：`<script|img|link|source|video|audio|iframe|object|embed>` 的 `src`、`href`、`poster`、`data` 属性与 `srcset`。
- 样式：`url(...)` 与 `@import`（`new URL(...)`、`foo.url(...)` 这类 JS 调用不算 CSS 资源地址）。
- 脚本：ESM `import`、`export … from`、`import()`、`fetch()`、`load()`、`getScript()`、`new Worker()`、`WebSocket()`、`EventSource()`、`setAttribute('src'|'href'|'poster'|'data', …)`、给 `.src`／`.href`／`.poster` 赋值，以及 jQuery 的 `$.ajax`／`$.get`／`$.post`／`$.getJSON`。
- 卡 JSON 里保留的字符串（例如正则替换文本、导入卡里的原始字段）也按同一套规则扫描。

地址分类的结果：

| 地址 | 结果 |
| --- | --- |
| `https://` 或协议相对 `//` | 必须在 `dependencies` 里能找到同一串地址，否则报「未声明的外部资源」 |
| `data:`、`#` | 跳过（自包含内容或页内锚点） |
| `blob:` | 警告：只在生成它的那次会话里有效 |
| `file:`、盘符、UNC、`localhost`、局域网 | 报错 |
| 其它带协议的地址（例如 `ftp:`） | 报错：不支持自动打包的资源协议 |
| 相对路径 | `check` 按引用它的文件位置在 `src/` 里找这个文件；`build` 阶段一律报错，因为成品不能再依赖本地文件 |
| 裸模块名（例如 `import 'vue'`） | `check` 跳过（交给打包器解析）；`build` 后仍然存在就报错 |

## 主机要求：MIME、CORS、CSP

外链是否加载成功取决于实际响应头和加载方式，登记依赖不代替网络与宿主验证：

- JavaScript 模块需要正确的 JavaScript MIME 与跨域许可。返回 `text/plain` 的 raw 文件地址不适合直接当模块执行；CDN 地址也要检查实际文件响应，而不是只看域名。
- 以 `iframe src` 导航到 HTML，需要对方返回可渲染的 HTML，且允许被嵌入；返回 `text/plain` 的 HTML 文件不能直接当网页导航。
- `jQuery.load` 是先跨域读取文本，再把 HTML 插入当前楼层 iframe。它与直接导航不同，可以用于 CDN 上以文本形式返回的 HTML，但仍需 CORS、脚本执行与宿主 CSP 允许。
- 响应头与缓存策略会变化，发布时检查具体固定版本地址；不要把某次某个文件的响应推广成整个托管平台的保证。

自己核对响应头：

```powershell
curl.exe -sS -I "https://cdn.jsdelivr.net/gh/<owner>/<repo>@<提交>/dist/panel.js"
```

## 界面怎么外链

默认仍是随卡内嵌单文件 HTML，见 [前端资源](FRONTEND.md)。外链 HTML 的一种常见方式是在正则 `替换文件` 中保存下面整个围栏；所有尖括号里的仓库/提交占位都必须换成真实值，URL 需登记在 `dependencies`：

````text
```html
<body>
<script>
$(() => {
  $('body').load('https://cdn.jsdelivr.net/gh/<owner>/<repo>@<完整提交号>/dist/panel.html', function (_response, status) {
    if (status === 'error') $(this).text('界面加载失败，请检查资源地址与网络。');
  });
});
</script>
</body>
```
````

目标 HTML 应来自已审阅的单文件产物，不再依赖相对脚本、样式或图片。这里代码位于楼层界面 iframe，`$('body')` 指向该界面；不要直接粘进脚本 iframe 操作宿主页面。`.load()` 不等于完整页面导航，部分 head 等元素处理可能不同；URL 后不要随意追加 ` #selector`，那会选择片段并移除其中脚本。需核对模块启动、样式和卸载清理。机制见 [jQuery.load 官方说明](https://api.jquery.com/load/)。

如果自己的构建流程产出的是可自行挂载 DOM 的单文件 ESM，也可以用以下加载页（它不能直接替代普通 HTML 产物）：

````text
```html
<body>
<div id="card-panel"></div>
<script type="module" src="https://cdn.jsdelivr.net/gh/<owner>/<repo>@<完整提交号>/dist/panel.js"></script>
</body>
```
````

保持围栏和 `<body>` 完整，酒馆助手据此识别渲染。MVU 卡的查找标记仍为 `<StatusPlaceHolderImpl/>`，不必增加让模型输出的条目。

直接嵌套跨域 `<iframe src="...">` 会创建另一层来源与上下文，不能假定里面仍有 `Mvu`、`getCurrentMessageId` 或其它酒馆助手接口；也受 `X-Frame-Options`/`frame-ancestors` 限制。需要宿主 API 的楼层面板优先在助手提供的 iframe 内加载。

## 将已有内嵌构建切换成外链

1. 用原来的 `构建` 配置打包，在 `build-report.json` 中核对目标与产物；将对应 `dist/<卡名>/ui/*.html` 或 `scripts/*.js` 复制到自有发布仓库。检查副本编号不是稳定接口，不凭编号猜绑定关系。
2. 提交发布文件，取得包含这些文件的完整 commit，验证公开固定地址可读。不要上传整个私人工作区；本工作区的 `dist/` 默认被忽略，单跑 build 不会把它发布到 Git。
3. 保留本地源文件。消费外链的正则改用加载页，并移除该正则原来的 `构建`，否则下次 build 会覆盖加载页。脚本改成外链 import loader，并核对其 `文件` 与可选 `构建.入口` 都指向 loader。
4. 更新 `dependencies`，再 check/build 分发卡。后续需要重编原界面时，恢复原构建绑定或用独立的资产工程生成新文件，再发布新 commit 并更新加载地址。

工具只检查卡里的加载页，不能静态遍历远程产物的全部传递依赖。发布者应检查远程产物本身；单文件内嵌是减少这一负担的默认选择。

## 缓存与升级

- 提交号地址的缓存是 immutable：内容不会随你的新提交自动更新，**改内容就要换地址**。
- 升级一次要做三件事：改 `project.json` 里的 `url` 与 `version`、改所有引用处、跑 `pnpm card check <名称>` 与 `pnpm card build <名称>`。之后在真实酒馆里确认新版本真的生效，再把结果写进 `runtimeVerified`，见 [验证](VERIFICATION.md)。
- 只改仓库内容、不改卡里的地址，玩家会继续拿到旧提交的内容。
- 删除或改名已发布的文件、把仓库改成私有、移动 tag，都会让已经发出去的卡失效；发布地址要按长期有效来规划。

## 常见故障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `check`／`build` 报「未声明的外部资源」 | 地址没登记，或与登记写法不一致（空格、协议相对、大小写） | 让引用处与 `dependencies` 写同一串地址 |
| `check`／`build` 报「成品残留未解析模块」 | 产物里还留着一个没被解析的裸模块名（例如 `import 'vue'`） | 换成打包器能解析的依赖，或改成已登记的完整外链地址 |
| `build` 报「成品残留相对资源」 | 产物里还留着相对路径引用 | 把资源内联进产物，或换成已登记的绝对地址 |
| 控制台提示 MIME 类型不对、拒绝执行 | 对方把 `.js` 当 `text/plain` 返回（例如 `raw.githubusercontent.com`） | 换成返回 JavaScript MIME 的地址 |
| 控制台提示 CORS | 对方没有 `access-control-allow-origin` | 换成允许跨域的主机，或把代码内嵌 |
| `Cannot use import statement outside a module` | 在经典脚本或 `$.getScript` 里写了 ESM 语法 | 改成 `<script type="module">`／模块 `import`，或去掉 `import` 语法 |
| 404 | 路径、大小写或提交号不对，文件不在该提交里 | 直接用提交号打开一次文件地址确认 |
| 改了代码但玩家没变化 | 地址没变，命中了缓存的旧提交 | 换新提交号，并同步改 `dependencies` 与引用处 |
| 卡里出现 `blob:` 地址 | 把浏览器预览地址当成了资源地址 | 换成发布后的固定地址 |

## 边界

- 静态检查与本地构建不等于外链真能加载：`check` 不联网，验证不了可达性、MIME、CORS、CSP，也验证不了宿主 iframe 的行为。
- 私有资源（不打算公开的脚本、样式、字体、图片）必须内嵌，不要使用带凭据或带有效期签名的地址。
- 本页描述的是本工作区当前的扫描与登记实现：字段与判定以 `tools/lib/resources.mjs` 的 `validateDependencies`／`auditResources` 为准，命令行为以 `tools/` 实现为准，文档与实现不一致时修正对应一侧。
