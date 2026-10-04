# luci-app-portal

A static HTML navigation dashboard for OpenWrt / ImmortalWrt, served on its own
port by a dedicated `uhttpd` instance and configured entirely from LuCI.

[中文说明](#中文说明)

## What it does

The router keeps serving its normal LuCI on its usual port. This app adds a
second, deliberately minimal page — a grid of bookmarks to the services running
on the router (or anywhere else) — on a port of your choice. Bookmarks, icons
and the background are stored in `uci` and baked into a static `links.json`, so
the portal page itself never needs a backend.

```
                    ┌──────────────────────────────┐
   :80 / :443  ────►│  uhttpd  (main LuCI stack)   │
                    └──────────────────────────────┘
   :8180       ────►┌──────────────────────────────┐      ┌────────────────────┐
   (configurable)   │  uhttpd  (own instance)      │◄─────│ /etc/portal/www/   │
                    │  procd: /etc/init.d/portal   │      │  index.html        │
                    └──────────────────────────────┘      │  portal.js/.css    │
                                                          │  links.json  ◄── uci
   LuCI  ─── /admin/services/portal ──────────────────►   │  bg/  icons/       │
                                                          └────────────────────┘
```

## Features

| | |
|---|---|
| Own port | Runs a second `uhttpd` on a port you pick, validated against clashes with the main instance |
| Bookmarks | Add, drag-to-reorder, enable/disable; emoji, remote URL or uploaded icon |
| Appearance | Page title, CSS background colour or an uploaded background image |
| Discovery | Scans `/proc/net/tcp[6]` for locally reachable listening services and adds them as *disabled* bookmarks in one click |
| Static output | Everything is persisted in `uci` and rendered into `links.json`; the page is plain HTML/JS |
| No `luci-compat` | Pure JavaScript view on the modern LuCI stack — no Lua runtime required |

## Requirements

| Component | Minimum |
|---|---|
| OpenWrt / ImmortalWrt | 23.05 (JS LuCI + ucode) |
| Packages | `luci-base`, `uhttpd`, `ucode`, `rpcd-mod-ucode` (pulled in automatically) |

## Install

```sh
# OpenWrt 25.12 and newer (apk)
apk add --allow-untrusted ./luci-app-portal-2.0.0-r1.apk

# OpenWrt 24.10 and older (opkg), built from the matching SDK
opkg install ./luci-app-portal_2.0.0-r1_all.ipk
```

Then open **Services → Portal** in LuCI, or go straight to
`http://<router>:8180/`.

## Layout

| Path | Purpose |
|---|---|
| `htdocs/luci-static/resources/view/portal/settings.js` | LuCI view — the whole UI, in JavaScript |
| `root/usr/share/luci/menu.d/luci-app-portal.json` | Menu registration |
| `root/usr/share/rpcd/acl.d/luci-app-portal.json` | ubus / uci / file permissions for the view |
| `root/usr/share/rpcd/ucode/portal.uc` | Backend: the `luci.portal` ubus object, also usable as a CLI |
| `root/etc/init.d/portal` | procd service: `links.json` generation plus the dedicated `uhttpd` |
| `root/usr/share/portal/www/` | Portal frontend template (`index.html`, `portal.js`, `portal.css`) |
| `root/etc/config/portal` | Default `uci` configuration |

## Backend API

`/usr/share/rpcd/ucode/portal.uc` is loaded by `rpcd-mod-ucode` and exposed as
the `luci.portal` ubus object:

```sh
ubus call luci.portal generate
# { "ok": true, "title": "My Portal", "links": 2 }

ubus call luci.portal scan
# { "lan_ip": "192.168.1.1", "ports": [ { "port": "80", "svc": "http" } ] }

# The same file is a command line tool (no rpcd involved):
ucode /usr/share/rpcd/ucode/portal.uc --cli generate
```

## uci reference

```
config portal
	option port            '8180'      # listening port of the portal
	option title           'My Portal' # page heading and <title>
	option background      '#0e1116'   # CSS colour
	option background_file ''          # absolute path below /etc/portal/www

config link
	option name     'AdGuard Home'
	option url      'http://192.168.1.1:3000'
	option icon_url '🛡️'              # or: option icon '/etc/portal/www/icons/x.png'
	option enabled  '1'
```

`links.json` is regenerated automatically whenever `/etc/config/portal` changes
(LuCI *Save & Apply*, or `uci commit` plus `/etc/init.d/portal reload`). The
**Regenerate links.json now** button forces it.

## Building

Building needs a Linux SDK matching the target firmware — WSL2 + Ubuntu works
fine, but the SDK and the source tree must live on the Linux filesystem, never
under `/mnt/`.

```sh
tar --zstd -xf immortalwrt-sdk-<version>-<arch>_gcc-*.tar.zst
cd immortalwrt-sdk-*/

./scripts/feeds update -a
./scripts/feeds install -a

cp -r /path/to/luci-app-portal package/
make defconfig
make package/luci-app-portal/compile V=s
```

The artefact lands in `bin/packages/<arch>/luci/`. Note that the SDK ships a
`.config` describing a whole firmware image; strip its `CONFIG_PACKAGE_*=m`
lines before compiling unless you actually want to build the entire package
tree.

## Migrating from 1.x

2.0.0 replaces the Lua implementation (`luasrc/`, CBI model, Lua controller)
with a JavaScript view plus an ucode rpcd backend:

| | 1.x | 2.0.0 |
|---|---|---|
| LuCI runtime | Lua + `luci-compat` | JavaScript, no compatibility layer |
| Settings page | `luasrc/model/cbi/portal/settings.lua` | `htdocs/.../view/portal/settings.js` |
| Backend | `luasrc/portal.lua` (`lua -e require(...)`) | `root/usr/share/rpcd/ucode/portal.uc` (ubus) |
| Port scan | one `nc -z` per port, loopback only | `/proc/net/tcp[6]`, LAN-reachable services only |
| Build | hand-written `Makefile` | `luci.mk` |

The `uci` schema is unchanged, so an existing `/etc/config/portal` is picked up
as is. Two behavioural changes:

* icons use `icon_url` for emoji/URLs; uploaded icons still go to `icon`, and
  both old and new style values are understood;
* the port scan skips services bound to `127.0.0.1` only, because a bookmark
  pointing at the router address could never reach them.

`/etc/config/portal` is no longer deleted on uninstall — it is a conffile and is
now left to the package manager, so a customised portal survives a reinstall.
Uninstalling still removes the generated page under `/etc/portal`.

## License

GPL-2.0-only. See [LICENSE](LICENSE).

---

## 中文说明

一个给 OpenWrt / ImmortalWrt 用的**静态 HTML 导航页**：跑在你自己指定的端口上，
由独立的 `uhttpd` 实例提供服务，全部通过 LuCI 配置。

| | |
|---|---|
| 独立端口 | 再起一个 `uhttpd` 实例，端口自选，并校验是否与主 LuCI 冲突 |
| 书签 | 增删、拖动排序、启用/禁用；图标支持 emoji、远程 URL 或上传文件 |
| 外观 | 页面标题、CSS 背景色，或上传背景图 |
| 服务发现 | 读取 `/proc/net/tcp[6]`，一键把本机可访问的服务加成**禁用**书签 |
| 纯静态 | 配置存 `uci`，生成 `links.json` 供前端读取，页面本身不需要后端 |
| 不依赖 `luci-compat` | 现代 LuCI（JavaScript 视图 + ucode 后端），无需 Lua 运行时 |

**环境要求**：OpenWrt / ImmortalWrt 23.05 及以上，`luci-base` + `uhttpd` +
`ucode` + `rpcd-mod-ucode`（会自动拉取）。

**安装**：

```sh
apk add --allow-untrusted ./luci-app-portal-2.0.0-r1.apk
```

然后进 LuCI 的 **服务 → Portal**，或直接访问 `http://<路由器>:8180/`。

**配置**：改动 `/etc/config/portal` 后（LuCI 点「保存并应用」即可）会自动重新生成
`links.json`；也可以点页面上的「立即重新生成」按钮强制刷新。改端口同样会自动重启
门户的 `uhttpd`，不需要手动敲命令。

**从 1.x 升级**：`uci` 配置格式未变，原有的 `/etc/config/portal` 可直接沿用。两处行为变化：

* 图标新增 `icon_url`（emoji / 远程 URL），上传的图标仍写入 `icon`，新旧两种值都能识别；
* 端口扫描会跳过只监听 `127.0.0.1` 的服务 —— 用路由器地址做书签根本连不上。

卸载不再删除 `/etc/config/portal`（它是 conffile，交给包管理器处理），已生成的门户目录
`/etc/portal` 仍会清理。

## 许可证

GPL-2.0-only，见 [LICENSE](LICENSE)。
