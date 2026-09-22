# 安装环境

只需准备一次，以后打开工作区就能继续写卡。工作区使用 Node.js 运行工具，pnpm 安装它需要的依赖。

## 让 agent 帮忙

在你常用的 agent 中打开解压后的工作区，直接说：

> 帮我检查并安装这个工作区需要的环境，确认角色卡工具能打开。

有终端和安装权限的 agent 可以检查已有环境、安装缺少的部分并验证结果。若遇到系统权限或安装窗口，它会告诉你需要操作哪一步；纯聊天窗口不能直接替本机安装。

## 自己安装（Windows）

1. 从 [Node.js 官网](https://nodejs.org/en/download) 安装 **Node.js 24**，然后重新打开终端或 agent。已安装符合要求的 Node.js 可以继续用；工作区最低版本见 `package.json`。
2. 打开工作区文件夹，在资源管理器地址栏输入 `cmd` 并回车，依次运行：

   ```bat
   npm install --global pnpm@11.17.0
   pnpm setup:workspace
   ```

3. 双击根目录的 **`打开角色卡工具.cmd`**，浏览器打开后就能导入或新建卡片。

第一次安装需要联网。如果提示“找不到 node/npm/pnpm”，先关闭并重新打开终端；仍然失败，把报错给 agent 处理即可。

macOS / Linux 也先安装 Node.js，再在工作区终端运行上面两条命令。之后用 `sh 打开角色卡工具.sh` 或 `pnpm studio` 打开工具。

## 给 agent 的准备步骤

用户请求准备环境时，直接完成必要安装，不让用户自己研究模块或填写开工表。

- 先检查 Node.js、npm、pnpm 是否可用，读取 `package.json` 的 `engines.node` 与 `packageManager`；满足要求就复用。新装优先 Node.js 24，与 CI 环境一致；pnpm 使用项目固定版本。
- 缺 Node.js 时按当前系统从官方渠道安装；不要为了一个工作区卸载其它项目的运行环境。涉及系统权限或客户端审批时按当前权限处理，并说明确切需要用户做的步骤。
- Node.js 可用后可直接运行 `node tools/doctor.mjs`，即使 pnpm 尚未安装也能给出诊断。缺 pnpm 时安装项目指定版本，然后运行 `pnpm setup:workspace`，按锁文件安装依赖，不更改依赖版本。
- 运行 `node tools/doctor.mjs` 确认就绪，再启动 `pnpm studio` 验证本地页面能打开；没有浏览器能力时说明只验证到了哪一步。最后用一句话告诉用户以后怎么启动。

启动器会在 Node.js 和 pnpm 就绪后检查并补装项目依赖，**不会自行安装 Node.js 或全局 pnpm**。参考资料在需要查阅时才用 `pnpm refs restore` 下载，不是首次写卡的前提。
