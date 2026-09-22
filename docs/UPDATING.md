# 升级与备份

这一页讲三件事：备份哪些文件、怎么升级工作区、怎么让自建卡进入版本管理和回滚。

## 要备份什么

一张卡的全部编辑内容都在 `cards/<名称>/` 里，完整复制这个目录就能恢复：

```text
cards/<名称>/
  project.json      模块、依赖、头像、runtimeVerified、原件校验信息
  .card/            兼容数据、关联映射与迁移快照，工具维护
  original/         导入原件与基线，只读
  src/              正文与配置：文本、世界书、正则、脚本、界面、schema
  内容导航.md        工具生成的内容落点导航
  创作说明.md        创作笔记，不参与打包
```

只备份 `src/` 会丢掉 `.card/state.json` 里的 `关联` 映射与已取消引用记录，导入卡再改条目时会对不上原卡。`dist/` 是可再生成的产物、`references/` 是可按锁文件取回的缓存；`imports/` 中尚未导入或希望独立保存的原卡也应备份。`work/` 是本地临时目录，不要把唯一一份创作资料放在这里。

备份方式按需要选：定期把 `cards/` 压缩存档，或者像下一节那样让自建卡进入版本管理。两种方式都保留 `.card/` 与 `original/`。

## 让自建卡进入版本管理

`cards/` 默认被 `.gitignore` 忽略，只有仓库自带的官方示例被跟踪，名单与 `maintenance/public-release.json` 的 `examples` 一致（那是发布清单，不是用户清单）。要让自己的卡进入版本管理，在仓库根 `.gitignore` 的 `cards/*` 之后追加白名单：

```gitignore
!cards/<你的卡名>/
!cards/<你的卡名>/**
```

然后按平时的方式 `git add`。注意跟着工程一起提交 `project.json`、`.card/` 与 `original/`；不要只提交 `src/`，也不要把自建卡写进 `maintenance/public-release.json`。更省事的做法是把整个卡目录放进你自己的私有仓库，公开包只保留官方示例。

## 升级工作区

1. 备份 `cards/`。
2. 使用 Git 的用户在确认本地改动已保存后拉取或切到目标版本；使用压缩包的用户先解压到新目录，再复制自己完整的卡工程过去。不要对旧工作区整目录覆盖，以免保留已废弃工具文件或覆盖自己的修改。
3. `pnpm setup:workspace`，再用 `pnpm doctor:workspace` 确认 Node、pnpm、依赖与锁文件都正常。
4. `pnpm card check all` 与 `pnpm card build all`，确认现有卡还能构建。
5. 有失败就先看错误信息与 `dist/<名称>/build-report.json`，不要用新模板覆盖已有卡。

模板只影响以后新建的卡，官方示例可以随版本更新整体替换，用户自建卡不会被自动改写。要查参考资料时先 `pnpm refs restore`：它只按 `maintenance/references.lock.json` 取锁定的完整提交与文件、按 sha256 校验，不改变锁版本。`pnpm refs update` 会刷新来源并重写锁文件，只用于有意升级锁版本，不是常规升级步骤。

0.3.0 的 MVU 界面默认改用框架自动添加的 `<StatusPlaceHolderImpl/>`。已有卡若仍用 `<CardStatus/>`，先确认它是否属于创作者的特殊布局；需要迁移时同步改消费正则、移除旧输出要求与开场占位，并在真实宿主确认初始化后显示正常。不要只改一个标签就保留两套生产者。非 MVU 独立界面的 `<CardStatus/>` 不属于这次迁移。

## 旧卡迁移

0.5.0 的新卡使用全局连续编号。已有卡不会在导入、构建或移动目录时自动改顺序；需要对齐列表与提示词布局时运行 `pnpm card arrange <名称>`，原工程留在 `work/order-backups/`，建议将需要长期保留的备份移到自己的备份位置。特殊位置先核对宿主提示词，排好总索引后用 `--order index` 编号。编号会影响预算优先级，完成后运行 `check`、`diff` 并在宿主预览。

导入后的条目先由 agent 分批读正文分类，填写 `分类` 后用 `organize` 安全搬移；`card map` 列出仍待分类的条目。已有正确分类可以保留，不必重新分组。

0.4.0 新建与拆分的世界书使用分类子目录和条目名，取消全局文件编号。旧路径仍能构建，不会因升级自动移动。需要整理某张 v2 工程时运行 `pnpm card organize <名称>`，或在本地工具点击“整理世界书”；工具保留已有子目录、自动备份并核对内容不变。具体边界与手工调整方法见 [世界书文件](WORLDBOOK-FILES.md)。

旧版卡片目录（`schemaVersion: 1`）能继续加载，只在需要改的时候迁移：

```powershell
pnpm card migrate <名称>
```

迁移会先做保真校验，通过才原地升级到 v2，并把迁移前快照留在 `.card/migration-v1/`；校验不通过会保留原目录不动。不要为了统一版本跑 `migrate all`：示例卡与长期不动的卡保持原样即可。迁移完成后按 [验证](VERIFICATION.md) 跑一遍 `check`、`build`，导入过的卡再跑 `diff`。

## 回滚

- **卡改坏了**：用备份的 `cards/<名称>/` 整目录替换回来，再跑 `check` 与 `build`。`.card/migration-v1/` 是迁移时的对照快照，回滚以你的备份为准。
- **迁移后想退回旧格式**：恢复迁移前的备份目录。工具不提供反向迁移命令。
- **工作区升级后不顺**：把代码换回升级前的版本，恢复 `cards/` 备份，再跑 `pnpm setup:workspace`。构建产物 `dist/` 可以随时重新生成，不需要回滚。
- **参考资料不对**：`pnpm refs restore` 始终按当前锁文件还原。换回旧版本的锁文件与来源配置后再 restore，就能回到旧的固定提交；不用手改 `references/upstream/`。

## 报告与证据

升级、迁移、回滚之后，报告里写清：动了哪些目录、跑了哪些命令、`check`／`build` 的实际结果、有没有真实宿主验证。`project.json` 的 `runtimeVerified` 只在真实酒馆里核实过才填；没核实就保持 `null`，静态检查通过不等于实机可用。
