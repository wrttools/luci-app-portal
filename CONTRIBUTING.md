# 贡献指南

> 项目：luci-app-portal

## 分支策略

- `main` 为保护分支，不要直接推送。
- 从 `main` 切 `feature/<名称>` 分支，一个功能一个分支。

## 提交规范

- Conventional Commits，type 用英文前缀：
  `feat:`（新功能）`fix:`（修复）`docs:`（文档）`test:`（测试）`chore:`（杂项）`refactor:`（重构）`ci:`（CI）。
- 描述可用中文，简明；标题总长 ≤ 72 字符。
- **一个提交只改一件事。**

## Pull Request

- 向 `main` 提 PR，说明做了什么、为什么，并关联 `ROADMAP.md` 对应行。
- 描述精简但准确，不反复论证。
- 确保本地检查通过后再提。

## 本地检查

```sh
sh scripts/check.sh
```

这就是 CI 跑的全部检查（JS 语法、JSON、shellcheck、msgfmt、ubus↔ACL、行尾、占位符），
退出码非零即失败。**加检查请改 `scripts/check.sh`，不要在 CI workflow 里另加** ——
否则本地与 CI 会漂移。

## 红线与完成定义

- 提交前请阅读 [AGENTS.md](AGENTS.md) 的「红线」。
- 功能是否算完成，以 [docs/definition-of-done.md](docs/definition-of-done.md) 为准。

## 改动了什么就要同时改什么

| 你改了 | 还必须改 |
|--------|----------|
| `portal.uc` 的 `const methods = {…}` | `rpcd/acl.d/luci-app-portal.json` |
| 用户可见字符串 | `po/templates/portal.pot`、`po/zh_Hans/portal.po` |
| `Makefile` 的 `PKG_VERSION` | `README.md` / `README.zh-CN.md` 里的安装命令版本号 |
| 本地检查项 | `AGENTS.md` §2（若命令有变） |
| 某个「为什么」 | `docs/adr/` 增一条记录（已接受的记录不得改） |

前两项漏掉时，`scripts/check.sh` 会抓到；后三项不会 —— 靠这条表和 review。

## 许可证

本项目采用 GPL-2.0-only 许可证，详见 [LICENSE](LICENSE)。
