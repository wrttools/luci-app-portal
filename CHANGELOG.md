# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

-

### Changed

-

### Fixed

-

### Removed

-

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
