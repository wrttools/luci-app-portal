# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [2.0.0-r22] - 2026-10-06

本版含此前**未对外发布**的 `2.0.0-r21` 内容（`r21` 未出过 Release），二者一并发布。

### Added

- 书签页行内「保存」成功后，该行按钮文字变为「已保存」；保存失败时仍显示「保存」（`2.0.0-r21`）。

### Changed

- 素材库的上传 / 改名 / 删除不再整页刷新：`assets.js` 用 `refresh_assets()` 重新读取两个
  素材目录并只替换列表容器，滚动位置与未应用的暂存改动都不再丢失；操作结果仍由通知
  横幅告知。「设为背景」也走同一路径，好让「(current)」标记立刻跟上暂存值（`2.0.0-r22`）。

### Fixed

- 书签页连续点「保存」或勾选「全选」时，上方通知横幅不再逐条累计：`portal/common.js`
  新增 `notify()`，`run_rpc()` 与书签页的两处直接调用改走它。此前 `ui.addNotification()`
  只往 `#maincontent` 顶部插入、从不移除旧的，横幅会越堆越多、页面越来越高（`2.0.0-r21`）。
- 门户页设置背景图后书签被照片盖住、页面上只剩图片：`portal.css` 增加一层只压暗、
  不吃事件的暗幕（`body::before`），并把卡片底色由 6% 白改为半透明深色加磨砂。
  原来那套「深色底 + 浅灰字 + 近透明卡片」的配色在明亮照片上会让内容整个消失
  （素材库到 v2.0.0-r20 才能正常设背景，此前该组合从未被验证过。`2.0.0-r22` 修复）。

## [2.0.0-r20] - 2026-10-06

### Added

- 书签页：行内「保存」（只提交该行）、列表内「全选」复选框、「删除禁用书签」与
  「清空所有书签」。

### Changed

- 书签页表头：「启用」文字从标题行移到描述行，标题行该列只留复选框。
- 「设为背景」保持**暂存**语义：值写入 UCI 后仍需点「保存并应用」生效，不链式提交
  （按用户决定，避免顺带提交其它页面的未保存改动）。

### Fixed

- **素材库的上传 / 重命名 / 删除 / 设为背景会提示「成功」但文件毫无变化** —— 三个
  独立层次，分别随 `2.0.0-r18` / `r19` / `r20` 修复：
  1. rpcd 方法表未声明 `args`，具名参数在回调执行前即被 ubus 以
     `UBUS_STATUS_INVALID_ARGUMENT` 拒绝（`r18`）；
  2. LuCI `rpc.declare` 的数组 `params` 是**位置映射**，调用点却传了对象字面量，
     参数根本没拼对（`r19`）；
  3. 上传的搬运用了 `rename(2)`，而 `/tmp`（tmpfs）与 `/etc/portal/www`（overlay）
     属不同挂载点，跨设备 rename 返回 `EXDEV`；改用 `readfile` + `writefile` +
     `unlink`（`r20`）。
- **后端失败在 UI 上被读成成功**：`run_rpc()` 现在把 resolved 的 `{ ok: false }` 抛出
  （`r17`），且本 App 全部 `rpc.declare` 声明 `reject: true`，ubus 层错误不再被当作
  结果 resolve（`r18`）。
- 所有文件系统失败的报错带上 errno 文本（如 `Cross-device link`），不再一律显示同
  一句话。
- `links.json` 生成失败时不再静默；落盘后显式 `chmod 644`（原先 0600，网页读不到）。
- `init.d/portal` 以 0644 打进包，导致安装/卸载脚本静默失败。
- `lan_ip()` 把带掩码的 `ipaddr` 直接拼进 URL。

### Removed

- 无

## [2.0.0]

### Added

- 门户素材库：图标与背景图的上传（单个 ≤ 2 MiB）、预览、重命名、删除，并可直接设为
  页面背景。
- 端口扫描改读 `/proc/net/tcp[6]`，只列出从 LAN 地址可达的监听端口，并按
  `/etc/services` 把端口分为「已知 Web 服务」「确定非浏览器目标」「未知」三类。
- 状态面板同时报告**进程存活**与**端口已监听** —— procd 会不断重启启动即退出的守护
  进程，只看 PID 会掩盖一个根本不应答的门户。
- `/admin/services/portal` 菜单注册与 rpcd ACL。

### Changed

- **破坏性（仅 1.x）**：前端由 Lua + `luci-compat` 改为 JavaScript 视图，后端由
  `luasrc/portal.lua` 改为 ucode rpcd 插件（`luci.portal` ubus 对象）。
- **破坏性（仅 1.x）**：端口扫描不再逐端口跑 `nc -z`，也不再扫描只监听 `127.0.0.1`
  的服务 —— 用路由器地址做书签根本连不上它们。
- 图标新增 `icon_url`（emoji / 远程 URL）；上传的图标仍写入 `icon`，新旧两种值都能识别。
- 构建改用 `luci.mk`。

### Fixed

- 独立 `uhttpd` 实例显式绑定 IPv4 通配地址。传裸 `:PORT` 会让 `getaddrinfo()` 报
  「Name does not resolve」，uhttpd 随即以「No sockets bound」退出，门户完全不可达。
- `/etc/config/portal` 不再在卸载时删除：它是 conffile，交给包管理器处理，已定制的
  门户配置因此能在重装后存活。

### Removed

- `luasrc/`、CBI model、Lua controller 全部移除。

## [1.0.0]

### Added

- 首个版本：静态 HTML 导航页 + 独立 `uhttpd` 实例 + LuCI 配置界面。
