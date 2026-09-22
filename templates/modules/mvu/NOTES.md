# MVU 模板依据（仓库内部说明，不会打进卡）

这个文件记录 module.json、schema.ts、正则与世界书条目的来源和边界，供以后升级模板时核对。
核对时间：2026-09-18（UTC）。只读源码与产物比对，没有执行任何远程卡脚本、第三方脚本或构建产物。

## 固定依赖

| 用途 | 地址 | 固定值 |
| --- | --- | --- |
| MVU 变量框架 | https://cdn.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@提交/artifact/bundle.js | 提交 3377b494cd7277230f3056230062124fe117f93f（本地镜像与 jsDelivr 同源） |
| 官方注册 helper | https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource@提交/dist/util/mvu_zod.js | 提交 69abb272d46bed4057a0dfb31758f6164cb7ecef，sha256 78c40f52d81022d9d769a923a49e673b8babb562656051a7d0410b6b19f45184（4705 B） |

helper 的该提交与浮动地址、tag v0.3.451 当时字节一致；源码路径是 util/mvu_zod.ts（不在 src/ 下）。
卡里只保留提交固定形式，浮动地址会随上游改动而变。

## 注册时序

上游模板与官方 skill 的写法都是 import 后立刻 $(() => registerMvuSchema(Schema))，模板沿用同一形状：

- helper 在调用时就同步订阅事件（dist 里紧跟 const r=z 之后执行），并立刻调用一次 registerVariableSchema；
  MVU 本体则按事件触发变量初始化（src/function/initvar/index.ts 在加载时、GENERATION_STARTED、MESSAGE_SENT 都会跑 initCheck，
  src/function/initvar/variable_init.ts 在第一条消息处 emit mag_variable_initialized）。
- 所以注册不依赖 Mvu 是否已经初始化：waitGlobalInitialized('Mvu') 是给读取变量的脚本或界面用的，
  注册脚本里先 await 它反而可能错过第一次 mag_variable_initialized，只留下后续轮次才生效的结构。
- schema 的求值发生在模块导入时，前提是此刻宿主已经提供全局 z；没有副作用，也不等待任何宿主对象。

## 为什么 schema 用宿主全局 z

util/mvu_zod.ts 的注册链是：registerMvuSchema(input) → 取 input 或 input() → input instanceof z.ZodObject ? z.looseObject(input.shape) : input
→ registerVariableSchema(z.object({ stat_data: schema }), { type: 'message' })，再在 mag_command_parsed_for_zod 里自己执行命令
（并在 mag_command_parsed_ended_for_zod 里清空命令数组，命令执行权归 zod 层）；路径段以 _ 开头时命令直接被丢弃。

- helper 用的是宿主全局 z：dist 产物里是 const r=z，没有 import zod。酒馆助手文档《内置第三方库》写明 zod 用 z 变量访问。
- 因此 src/schema.ts 只写 import type，运行时读宿主那份全局 z（declare const z），仓库的 zod 依赖只放在 devDependencies 供单测注入。
- 本机实测（zod 4.4.3 × 4.6.5）：zod v4 的 instanceof 跨副本并不一定失配，实测两个方向都为真；但不同版本的结构互相解析会出错，
  例如把 4.6.5 建立的结构交给 4.4.3 的 z.looseObject(shape) 解析会报 invalid_type、缺省字段变成 undefined（反向正常）。
  用宿主同一份实例能减少这类兼容风险，所以卡内不 import 运行时的 zod，测试注入的版本也与锁定的酒馆助手一致（4.4.3）。

## 输出协议（对照 MVU 3377b494）

- src/util.ts:48-62 的 isJsonPatch：空数组合法；否则每个 op 都要是普通对象、op.op 是字符串，并且
  typeof op.path === 'string' 或 op.op === 'move' 且 op.to 是字符串。一个操作缺 path 会让整块补丁不通过校验（every）。
- src/function/update_variables.ts:365-422 的 extractJsonPatch：replace→set、delta→add（数值增量）、insert/add→insert、
  remove→delete、move→move(args [from, path 或 to])；switch 没有 default 分支，op 名写错会被静默忽略。
- 上游自己的 json patch 测试只覆盖 add/replace/remove（tests/helpers/json_patch_suite.ts:23），delta/insert/move 只有源码依据。
- 所以模型可见的 format.md 只列五种规范 op，move 用上游固定写法 from + to；add 等价于 insert、move 可用 path 代替 to
  这些兼容细节留在这里，不写进提示词。

## 四个标准条目

条目名对齐上游 tavern-helper-template 的角色卡模板：[initvar]变量初始化勿开（enabled: false，蓝灯/constant）、
变量列表、[mvu_update]变量更新规则、[mvu_update]变量输出格式（蓝灯、@D0、role 0 system）。

- MVU 读取注释里含 [initvar] 的条目，不筛选启用状态（src/function/initvar/variable_init.ts:262-291），条目内容是 JSON/YAML 都能解析。
- module.json 的 order 是模块内部相对次序；新建时先组合模块，再按全局提示词布局重编为 1..N，禁用初始化条目放末尾。world-info.js 的 sortFn = (a, b) => b.order - a.order 配合
  entries.unshift，使同深度同角色内 order 小的先出现，于是提示词顺序是 变量列表 → 更新规则 → 输出格式。
- extensions.position = 4（atDepth）、depth 0、role 0（system）来自 world-info.js 的 world_info_position 与 extension_prompt_roles。
- 变量列表与上游一致用 format_message_variable::stat_data；只去掉了上游同步工具用的 YAML --- 前置行。

## 正则

0.3.0 起，界面默认消费 MVU 自动添加的 `<StatusPlaceHolderImpl/>`，不要求模型输出。依据 `src/function/update_variables.ts` 的 `handleVariablesInMessage` 与 `src/function/function_call.ts`；没有界面时模板引擎另配两条占位清理正则。有界面时配显示渲染与提示词清理两条。以下四条只指更新块处理，不包含界面占位处理。更新模式与阶段标记见 [更新模式](../../../docs/MVU-MODES.md)。

四条，覆盖完整块与流式未闭合块，按 update 与 UpdateVariable（大小写不敏感）匹配：

- 仅显示（markdownOnly）：折叠完整块、折叠未闭合块。placement 是用户输入 + AI 输出（regex_placement.USER_INPUT = 1、AI_OUTPUT = 2）。
- 仅提示词（promptOnly）：删除完整块与未闭合块。两者都不是改聊天记录，见 regex/engine.js:349-356：
  只有 markdownOnly 与 promptOnly 都为 false 才会改写来源消息本身。
- fixtures 覆盖单块、多块、未闭合与已闭合块在前、未闭合块在后四种情况，由 pnpm card check 实际跑替换结果。

## schema.json 的来源

本仓库没有 schema.json 生成器，也没有构建步骤会写这个文件：它是 src/schema.ts 结构的投影，手工落盘在这里，
由 pnpm test 里的 mvu-template 测试用 z.toJSONSchema(Schema, { io: 'input' }) 重新计算并逐字段比对，不一致就直接失败。
所以改了 schema.ts 必须同步这个文件，测试失败信息里会给出完整的新内容。

- 只能用 io: 'input'：zod 4 对 transform 在 io: 'output' 下会直接抛 Transforms cannot be represented in JSON Schema。
- 结构里的范围（信任 0~100）由 transform 夹值实现，.meta({ minimum, maximum }) 只是让投影能表达这个范围，不参与校验。
- schema.json 只给人和编辑器参考，运行时注册的结构以 src/schema.ts 为准。

## 未核实

- 没有在真实酒馆里导入构建产物，也没有执行远程 helper：注册链行为来自源码与文档阅读，实机结论要写进卡片的 runtimeVerified。
- 玩家实际安装的酒馆助手版本可能不是锁定镜像里的 zod 4.4.3；结构只用了 zod 4 基础 API，但真实宿主表现仍需实测。
- 上游浮动地址与固定提交的等价性只在核对当天成立。
