# AGENTS.md — 给 AI 编码助手的行为规则

> 本文件供 AI 编码助手（WorkBuddy / Claude Code / Cursor 等）自动读取。
> **开始任务前先读完本文件；需求含糊时先提问，不要臆造。**
>
> 本项目遵循 [ai-template-repository](https://github.com/cocolight/ai-template-repository)
> 的协作规范；与模板的差异（无编译型测试、以语法级门禁替代单测）在下文各节就地说明。

## 0. 项目

luci-app-portal — 给 OpenWrt / ImmortalWrt 用的静态 HTML 导航页：跑在用户指定端口上，
由独立的 `uhttpd` 实例提供服务，全部配置通过 LuCI 管理并持久化在 `uci`。

技术栈：LuCI JavaScript 视图 + ucode（rpcd 插件）+ POSIX shell（procd init 脚本）。
**没有编译型单元测试**，因此质量门禁是「语法级检查 + 交叉引用一致性」，见 §2。

## 1. 上下文入口（按此顺序阅读）

1. `AGENTS.md`（本文件）— 规则与红线
2. `ROADMAP.md` — 当前任务、已知缺陷与「验收标准」
3. `README.md` — 定位、安装、uci 参考、排查手册（英文）；`README.zh-CN.md` 为中文版
4. `docs/architecture.md` — 目录 / 分层 / ubus 契约 / 错误处理 / 命名规则
5. `docs/definition-of-done.md` — 完成定义（DoD）
6. `docs/adr/` — 已接受的架构决策（改动相关模块前先读）
7. 与任务相关的源码：`htdocs/luci-static/resources/portal/common.js`、
   `htdocs/luci-static/resources/view/portal/*.js`、`root/usr/share/rpcd/ucode/portal.uc`、
   `root/etc/init.d/portal`

## 2. 常用命令（可直接复制执行）

> **未运行过命令，不得声称「已通过检查」。** 本地无 WSL 时用 `python3 -m json.tool` 代替。

| 目的 | 命令 | 说明 |
|------|------|------|
| 依赖安装 | 无 | 纯脚本项目，无包管理器依赖；构建需另配 ImmortalWrt SDK（见 [docs/configuration.md](docs/configuration.md) §6） |
| JS 语法检查 | `for f in htdocs/luci-static/resources/portal/*.js htdocs/luci-static/resources/view/portal/*.js root/usr/share/portal/www/portal.js; do node --check "$f" || exit 1; done` | 5 个 JS 文件；LuCI 视图与门户前端 |
| shell 检查 | `shellcheck -s sh root/etc/init.d/portal` | 唯一的 shell 脚本；`# shellcheck shell=ash` 已声明 |
| JSON 校验 | `for f in root/usr/share/luci/menu.d/*.json root/usr/share/rpcd/acl.d/*.json; do python3 -m json.tool "$f" >/dev/null || exit 1; done` | 菜单注册与 rpcd ACL |
| 翻译校验 | `msgfmt --check -o /dev/null po/zh_Hans/portal.po` | 需 gettext；CI 用 `sudo apt-get install -y gettext` |
| 行尾检查 | `git ls-files --eol \| grep -v 'i/lf.*w/lf' ` | 期望无输出；有输出说明工作区未按 `.gitattributes` 归一化 |
| 占位符残留 | `sh scripts/check.sh`（含该项） | 期望输出 `none`；模板占位符不得残留 |
| 本地全量 | `sh scripts/check.sh` | 与 CI 完全一致（CI 调用的就是它）；**新增检查只加在这一处** |
| 构建 .apk | 见 [README.md](README.md) §Building | 需匹配目标固件的 SDK，耗时数分钟，不适合每次改动都跑 |

> `scripts/check.sh` 是 §2 表中除「依赖安装 / 构建 / 行尾检查」外的全部检查，
> 且与 `.github/workflows/build.yml` 跑同一个脚本 —— **改检查只改一处**，避免本地与 CI 漂移。

## 3. 工作流

- 保护分支 `main`，禁止直接推送。
- 一个功能 = 一个 `feature/<名称>` 分支 = 一个 PR。
- 提交：Conventional Commits，type 用英文前缀（`feat`/`fix`/`docs`/`test`/`chore`/`refactor`/`ci`）；描述可用中文；标题总长 ≤ 72 字符。
- 每完成一项，更新 `ROADMAP.md` 对应行状态。
- **本项目特有**：改动任何 ubus 方法时，必须同步核对
  `root/usr/share/rpcd/acl.d/luci-app-portal.json` 的白名单 —— 只改 `.uc` 不改 ACL 的结果是
  `Access denied`，而这类失败在本地看不出来。

## 4. 红线（违反即回滚）

1. 不得删除 / 跳过 / 弱化检查（含从 `scripts/check.sh` 摘掉一项、给它加 `|| true`、放宽断言），不得伪造「检查已通过」。
2. 大改动先确认：单次改动 > 5 个文件 或 > 200 行，先给方案，等确认再动手。
3. 不得擅自 `git commit` / `push` / `rebase` / `reset` / `--force`、切分支或改远程；仅在明确要求时执行。
4. 不得为了让检查「变绿」而修改 CI、hook、lint 配置或门禁。
5. 不得修改 `docs/adr/` 中「已接受」的记录；变更须新增 ADR。
6. 绝不提交密钥 / token / 私钥 / `.env`（用环境变量或仓库外文件）。
7. 含糊需求先提问；同一问题连续 2 次修复失败，停下说明现状并求助。
8. 只改与任务相关的文件，不做无关重构、不顺手改格式。
9. **本项目特有**：不得引入编译型依赖或构建步骤 —— 本项目是纯脚本包，引入工具链会让
   「clone 即可审查」这一性质失效，且 CI 无法在合理时间内验证。
10. **本项目特有**：不得把 `root/etc/init.d/portal` 之外的 shell 逻辑塞进 LuCI 视图 ——
    浏览器侧无法读取 `/proc/net/tcp[6]`，也拿不到 `uci` 之外的系统状态。

## 5. 完成定义（DoD）

详见 `docs/definition-of-done.md`。任一功能完成须同时满足：

- [ ] `ROADMAP.md` 该行「验收标准」全部满足
- [ ] `bash scripts/check.sh` 全部通过（输出 `ALL CHECKS PASSED`）
- [ ] 改过 ubus 方法则 ACL 白名单已同步
- [ ] 新增的用户可见字符串已进 `po/zh_Hans/portal.po` 与 `po/templates/portal.pot`
- [ ] 相关文档（README / AGENTS / architecture / ADR）同步更新
- [ ] `ROADMAP.md` 状态更新为 `done`

## 6. 并发协作（多 AI / 多人）

- 一个分支只由一个执行者写入；动手前先 `git fetch`，避免同文件并发编辑。
- 遇到冲突立即停止并说明，不要擅自 `--force`。

## 7. 安全

- 绝不提交密钥 / token / 私钥。
- **`scripts/check.sh` 必须保持可运行**（它是本项目全部自动化门禁的载体）。
- **本项目特有**：ACL 文件是安全边界。收紧可以（少给权限），放宽必须说明理由 ——
  `write.ubus` 里的 `generate` / `upload` / `rename` / `remove` 都能改设备上的文件。
- **本项目特有**：上传文件名白名单（ASCII 字母数字与 `.` `-` `_`）与 2 MiB 上限
  在前端与后端**各做一次**，不得因为「前端已经拦了」就删掉后端校验。
