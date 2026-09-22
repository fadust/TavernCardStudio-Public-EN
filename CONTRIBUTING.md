# 参与维护

参与前阅读 [LICENSE](LICENSE)。本工作区内容限非商业使用；提交贡献表示你有权提供该内容，且同意将贡献以本项目许可提供。第三方内容必须保留自己的来源与许可，不得直接改成项目许可。

工具维护从 `tools/` 与 `tests/` 开始；写卡流程见 [AGENTS.md](AGENTS.md)。修复时提供可复现输入、实际与预期行为，并使用自己有权公开的最小样例。不要在问题报告中附上个人会话、密钥、完整私有卡或其它人的作品。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm verify:examples
pnpm release:check
```

这组检查不需要下载参考源码，也不执行导入卡脚本。涉及参考规则时运行 `pnpm refs restore` 和 `pnpm verify:refs`。涉及本地管理页面时按 [验证说明](docs/VERIFICATION.md) 运行浏览器检查。

新功能应保持 PNG/JSON 未知字段与旧工程兼容，外部写入与发布不得成为构建的隐含动作。测试使用隔离的临时工程，禁止以用户自己的作品作为必须存在的夹具。新增公开示例须加入 `maintenance/public-release.json` 的明确名单及 `.gitignore` 的对应例外。

更新版本时同步更新 CHANGELOG，按 [发布说明](docs/RELEASE.md) 在干净目录验证导出包。第三方参考版本更新与普通工具升级分开进行，不为了修复本地缺失文件而升级上游版本。
