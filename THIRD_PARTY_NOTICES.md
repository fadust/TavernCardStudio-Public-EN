# 第三方来源归属

本文件只记录本工作区按配置锁定的上游参考来源，供追溯取用。它不复述、也不改变本项目自有内容的许可条款；第三方协议不并入本项目自身的许可，二者分开维护。

- 来源配置：`maintenance/reference-sources.json`
- 锁定提交、许可证标识（`license.spdx`）、许可证文件（`licenseFile`）与逐文件 sha256：以 `maintenance/references.lock.json` 为准
- 许可证条款原文：在 `references/upstream/<来源 id>/` 里对应的许可证文件中

`references/upstream/` 与 `references/index.json` 是本地缓存，不随发布分发；克隆后运行 `pnpm refs restore`，按 `maintenance/references.lock.json` 只取锁定的完整提交与文件，并逐文件按 sha256 校验还原。以下来源都只作只读资料，内容不自动打进卡、不自动执行。

| 来源 id | 上游仓库 |
| --- | --- |
| `tavern-helper` | https://github.com/N0VI028/JS-Slash-Runner |
| `tavern-helper-docs` | https://github.com/N0VI028/JS-Slash-Runner-Doc |
| `sillytavern` | https://github.com/SillyTavern/SillyTavern |
| `sillytavern-docs` | https://github.com/SillyTavern/SillyTavern-Docs |
| `prompt-template` | https://github.com/zonde306/ST-Prompt-Template |
| `tavern-helper-template` | https://github.com/StageDog/tavern_helper_template |
| `mvu` | https://github.com/MagicalAstrogy/MagVarUpdate |
| `character-card-spec` | https://github.com/malfoyslastname/character-card-spec-v2 |
| `character-card-spec-v3` | https://github.com/kwaroran/character-card-spec-v3 |
| `tavern-resource` | https://github.com/StageDog/tavern_resource |

上游标注的许可证与锁文件记录不一致时，以锁文件加还原后的原文为准；不要按项目名或印象补写许可证。
