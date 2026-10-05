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
| On/off switch | Turn the whole portal service on or off; switching it off stops the daemon and closes the port, no reboot needed |
| Own port | Runs a second `uhttpd` on a port you pick, validated against clashes with the main instance |
| Bookmarks | Add, enable/disable and delete; emoji, remote URL or an image from the asset library |
| Asset library | Upload (2 MiB per file), preview, rename, list and delete icons and background images, and pick the page background |
| Appearance | Page title, CSS background colour or a background image |
| Discovery | Scans `/proc/net/tcp[6]` for locally reachable listening services, adds the known web ones as *disabled* bookmarks, and asks about the rest |
| Status panel | Reports whether the daemon is running *and* whether it actually owns the port, plus the URL and the baked bookmark count |
| Static output | Everything is persisted in `uci` and rendered into `links.json`; the page is plain HTML/JS |
| No `luci-compat` | Pure JavaScript views on the modern LuCI stack — no Lua runtime required |

## Requirements

| Component | Minimum |
|---|---|
| OpenWrt / ImmortalWrt | 23.05 (JS LuCI + ucode) |
| Packages | `luci-base`, `uhttpd`, `ucode`, `rpcd-mod-ucode` (pulled in automatically) |

## Install

```sh
# OpenWrt 25.12 and newer (apk)
apk add --allow-untrusted ./luci-app-portal-2.0.0-r11.apk

# OpenWrt 24.10 and older (opkg), built from the matching SDK
opkg install ./luci-app-portal_2.0.0-r11_all.ipk
```

Then open **Services → Portal** in LuCI, or go straight to
`http://<router>:8180/`.

## Layout

| Path | Purpose |
|---|---|
| `htdocs/luci-static/resources/portal/common.js` | Shared helpers: RPC wrappers, status panel, error reporting |
| `htdocs/luci-static/resources/view/portal/general.js` | LuCI view — switch, port, title, background, maintenance |
| `htdocs/luci-static/resources/view/portal/bookmarks.js` | LuCI view — the bookmark table |
| `htdocs/luci-static/resources/view/portal/assets.js` | LuCI view — the icon and background image library |
| `root/usr/share/luci/menu.d/luci-app-portal.json` | Menu registration |
| `root/usr/share/rpcd/acl.d/luci-app-portal.json` | ubus / uci / file permissions for the views |
| `root/usr/share/rpcd/ucode/portal.uc` | Backend: the `luci.portal` ubus object (plugin only, no CLI mode) |
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
# { "lan_ip": "192.168.1.1",
#   "ports": [ { "port": 80, "svc": "http", "web": true },
#              { "port": 22, "svc": "ssh", "web": false },
#              { "port": 7890, "svc": "", "web": "unknown" } ] }

ubus call luci.portal status
# { "ok": true, "enabled": true, "running": true, "pid": 1234, "port": 8180,
#   "listening": true, "url": "http://192.168.1.1:8180/", "links": 2,
#   "generated": true, "generated_at": 1791124783 }

# asset management - the browser may only write /tmp/portal_upload.tmp,
# the backend moves the file to its final name
ubus call luci.portal upload '{ "dir": "bg", "name": "wallpaper.jpg" }'
ubus call luci.portal rename '{ "dir": "bg", "name": "wallpaper.jpg", "new_name": "home.jpg" }'
ubus call luci.portal remove  '{ "dir": "bg", "name": "home.jpg" }'
```

The `web` field of a scanned port is one of:

| Value | Meaning |
|---|---|
| `true` | A known web service — added as a disabled bookmark |
| `false` | Definitely not a browser target (`ssh`, `dns`, `mdns`, `dhcp`, `ntp`, `openvpn`, `wireguard`, …) — never offered |
| `"unknown"` | No `/etc/services` entry says what speaks on it — listed in a dialog, your call |

A port number carries no protocol information, so `7890` may be a proxy or an
arbitrary TCP service and `1053` is mDNS. Rather than guess in either direction,
unrecognised ports are shown and can be added as disabled bookmarks in one go.

The script is a plugin only — rpcd does not define `ARGV` while loading it, so it
cannot double as a command line tool. Call it over ubus as shown above.

`status` separates *alive* from *listening* on purpose: procd respawns a daemon
that dies on startup, so a pid alone would hide a portal that never answers.

## uci reference

```
config portal
	option enabled         '1'         # master switch; '0' stops the portal
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

## Troubleshooting

The *General* page has a **Service status** panel; the same numbers come from
ubus:

```sh
ubus call luci.portal status
```

| Symptom | Cause |
|---|---|
| `enabled: false` | The switch in *General* is off — tick it and press **Save & Apply** |
| `running: true` but `listening: false` | The daemon is up but cannot bind — another service already holds the port |
| `running: false` | It was never started: `/etc/init.d/portal enable && /etc/init.d/portal start` |
| Page loads, but no bookmarks | `links.json` missing or empty — press **Regenerate links.json now** |
| Works from the router (`curl http://127.0.0.1:PORT/`) but not from a client | Firewall/zone rule blocks that port for that client |

The instance binds `0.0.0.0:<port>` — every interface, IPv4. Binding a single
address would need an edit to `/etc/init.d/portal`.

## Known limitations

| Limitation | Why |
|---|---|
| Uploads are capped at 2 MiB | Enforced in the UI *and* in the backend, so a hand crafted request cannot bypass it. Multi-megabyte backgrounds are served fine — only the upload is bounded |
| File names are ASCII only: letters, digits, `.`, `-`, `_` | The name becomes a device path. Rejecting is safer than silently rewriting what the user typed, and it rules out path traversal by construction. Chinese names and spaces are refused |
| Thumbnails need the portal's own HTTP port | They are fetched from `http://<router>:<port>/…` instead of being inlined over ubus, which is what lifts the 256 KiB inline limit. When LuCI itself is on **HTTPS**, the browser would block those as mixed content, so the thumbnail degrades to a text link |
| Unrecognised ports are not probed | Deciding whether a port speaks HTTP would need an active `GET /` with a timeout inside a synchronous ubus method, which blocks the whole rpcd — and therefore every other LuCI page. They are listed for you to decide instead |
| Setting a background image is staged, not applied | Like every other setting, it waits for **Save & Apply**. `generate()` runs in the backend process with its own `uci` cursor and would otherwise bake the old value |

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
| Settings page | `luasrc/model/cbi/portal/settings.lua` | `htdocs/.../view/portal/{general,bookmarks,assets}.js` |
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
| 启用开关 | 一键开关整个门户服务；关闭后守护进程停止、端口关闭，无需重启设备 |
| 独立端口 | 再起一个 `uhttpd` 实例，端口自选，并校验是否与主 LuCI 冲突 |
| 书签 | 增删与启用/禁用；图标支持 emoji、远程 URL 或素材库里的图片 |
| 素材库 | 上传（单个 ≤ 2 MiB）、预览、重命名、列出与删除图标/背景图，并可直接设为页面背景 |
| 外观 | 页面标题、CSS 背景色，或背景图 |
| Discovery | 读取 `/proc/net/tcp[6]`，把已知的 Web 服务加成**禁用**书签，其余端口交给你决定 |
| 运行状态 | 直接显示进程是否存活、端口是否真的被监听、访问地址与已生成的书签数 |
| 纯静态 | 配置存 `uci`，生成 `links.json` 供前端读取，页面本身不需要后端 |
| 不依赖 `luci-compat` | 现代 LuCI（JavaScript 视图 + ucode 后端），无需 Lua 运行时 |

**环境要求**：OpenWrt / ImmortalWrt 23.05 及以上，`luci-base` + `uhttpd` +
`ucode` + `rpcd-mod-ucode`（会自动拉取）。

**安装**：

```sh
apk add --allow-untrusted ./luci-app-portal-2.0.0-r11.apk
```

然后进 LuCI 的 **服务 → Portal**，或直接访问 `http://<路由器>:8180/`。

**排查**：「常规」页有「运行状态」面板，「进程存活」与「端口已监听」是分开判定的 ——
procd 会不断重启一个启动即退出的守护进程，只看 PID 会以为一切正常。命令行等价：

```sh
ubus call luci.portal status
```

| 现象 | 原因 |
|---|---|
| `enabled: false` | 「常规」页的开关被关掉了，勾上并点「保存并应用」 |
| `running: true` 但 `listening: false` | 进程活着但绑不上端口，通常已被其他服务占用 |
| `running: false` | 从未启动：`/etc/init.d/portal enable && /etc/init.d/portal start` |
| 页面能开但没有书签 | `links.json` 缺失或为空，点「立即重新生成 links.json」 |
| 路由器上 `curl http://127.0.0.1:端口/` 通、客户端不通 | 防火墙/区域规则拦了该端口 |

实例绑定 `0.0.0.0:<端口>`（所有网卡，IPv4）；要只绑某个地址需自行改 `/etc/init.d/portal`。

**已知限制**：

| 限制 | 原因 |
|---|---|
| 上传单个文件 ≤ 2 MiB | 前端与后端都做校验，手工构造的请求也绕不过去。多兆的背景图**显示**没问题，限的只是上传 |
| 文件名仅限 ASCII 字母数字与 `.` `-` `_` | 文件名会变成设备路径；直接拒绝比悄悄改写用户输入更安全，也能从根上杜绝路径穿越。中文名与空格会被拒绝 |
| 缩略图依赖门户自身的 HTTP 端口 | 缩略图改为 `http://<路由器>:<端口>/…` 直接取，因此解除了 256 KiB 内联上限。但 LuCI 走 **HTTPS** 时浏览器会按混合内容拦截，此时缩略图降级为文字链接 |
| 不会主动探测未识别端口 | 判定端口是否说 HTTP 需要在同步 ubus 方法里做带超时的 `GET /`，会阻塞整个 rpcd（连带所有 LuCI 页面）。因此改为列出来由你决定 |
| 设为背景只暂存 | 与其他设置一致，需点「保存并应用」才生效 —— `generate()` 跑在后端进程里，用的是它自己的 `uci` cursor，否则会烘出旧值 |

**配置**：改动 `/etc/config/portal` 后（LuCI 点「保存并应用」即可）会自动重新生成
`links.json`；也可以点页面上的「立即重新生成」按钮强制刷新。改端口、或开关门户的启用
开关，同样会自动重启门户的 `uhttpd`，不需要手动敲命令。

**从 1.x 升级**：`uci` 配置格式未变，原有的 `/etc/config/portal` 可直接沿用。两处行为变化：

* 图标新增 `icon_url`（emoji / 远程 URL），上传的图标仍写入 `icon`，新旧两种值都能识别；
* 端口扫描会跳过只监听 `127.0.0.1` 的服务 —— 用路由器地址做书签根本连不上。

卸载不再删除 `/etc/config/portal`（它是 conffile，交给包管理器处理），已生成的门户目录
`/etc/portal` 仍会清理。

## 许可证

GPL-2.0-only，见 [LICENSE](LICENSE)。
