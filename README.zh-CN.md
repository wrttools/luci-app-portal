# luci-app-portal

给 OpenWrt / ImmortalWrt 用的**静态 HTML 导航页**：跑在你自己指定的端口上，
由独立的 `uhttpd` 实例提供服务，全部通过 LuCI 配置。

[English](README.md)

## 它做什么

路由器照常在原端口提供 LuCI。本应用额外加一个刻意保持极简的页面 —— 一个指向路由器
（或任意位置）上各服务的书签网格，端口由你指定。书签、图标与背景都存放在 `uci` 中，
并烘焙成静态的 `links.json`，因此门户页面本身不需要任何后端。

```
                    ┌──────────────────────────────┐
   :80 / :443  ────►│  uhttpd  (主 LuCI 栈)        │
                    └──────────────────────────────┘
   :8180       ────►┌──────────────────────────────┐      ┌────────────────────┐
   （可配置）        │  uhttpd  (独立实例)│◄─────│ /etc/portal/www/   │
                    │  procd: /etc/init.d/portal   │      │  index.html        │
                    └──────────────────────────────┘      │  portal.js/.css│
                │  links.json  ◄── uci
   LuCI  ─── /admin/services/portal ──────────────────►   │  bg/  icons/       │
                                                          └────────────────────┘
```

## 功能

| | |
|---|---|
| 启用开关 | 一键开关整个门户服务；关闭后守护进程停止、端口关闭，无需重启设备 |
| 独立端口 | 再起一个 `uhttpd` 实例，端口自选，并校验是否与主 LuCI 冲突 |
| 书签 | 增删与启用/禁用；图标支持 emoji、远程 URL 或素材库里的图片 |
| 素材库 | 上传（单个 ≤ 2 MiB）、预览、重命名、列出与删除图标/背景图，并可直接设为页面背景 |
| 外观 | 页面标题、CSS 背景色或背景图，另有背景压暗、磨砂模糊、书签卡片透明度三个 0–100 滑块 |
| Discovery | 读取 `/proc/net/tcp[6]`，把已知的 Web 服务加成**禁用**书签，其余端口交给你决定 |
| 运行状态 | 分别显示进程是否存活、端口是否真的被监听、访问地址与已生成的书签数 |
| 纯静态 | 配置存 `uci`，生成 `links.json` 供前端读取，页面本身不需要后端 |
| 不依赖 `luci-compat` | 现代 LuCI（JavaScript 视图 + ucode 后端），无需 Lua 运行时 |

## 环境要求

| 组件 | 最低版本 |
|---|---|
| OpenWrt / ImmortalWrt | 23.05（JS LuCI + ucode） |
| 软件包 | `luci-base`、`uhttpd`、`ucode`、`rpcd-mod-ucode`（会自动拉取） |

## 安装

```sh
# OpenWrt 25.12 及更新（apk）
apk add --allow-untrusted ./luci-app-portal-2.0.0-r23.apk

# OpenWrt 24.10 及更早（opkg），需用对应 SDK 构建
opkg install ./luci-app-portal_2.0.0-r23_all.ipk
```

然后进 LuCI 的**服务 → Portal**，或直接访问 `http://<路由器>:8180/`。

## 目录结构

| 路径 | 用途 |
|---|---|
| `htdocs/luci-static/resources/portal/common.js` | 共享工具：RPC 封装、状态面板、错误上报 |
| `htdocs/luci-static/resources/view/portal/general.js` | LuCI 视图 —— 开关、端口、标题、背景、维护 |
| `htdocs/luci-static/resources/view/portal/bookmarks.js` | LuCI 视图 —— 书签表格 |
| `htdocs/luci-static/resources/view/portal/assets.js` | LuCI 视图 —— 图标与背景素材库 |
| `root/usr/share/luci/menu.d/luci-app-portal.json` | 菜单注册 |
| `root/usr/share/rpcd/acl.d/luci-app-portal.json` | 各视图的 ubus / uci / 文件权限 |
| `root/usr/share/rpcd/ucode/portal.uc` | 后端：`luci.portal` ubus 对象（仅插件，无 CLI 模式） |
| `root/etc/init.d/portal` | procd 服务：生成 `links.json` + 独立 `uhttpd` |
| `root/usr/share/portal/www/` | 门户前端模板（`index.html`、`portal.js`、`portal.css`） |
| `root/etc/config/portal` | 默认 `uci` 配置 |
| `scripts/check.sh` | 本地与 CI 的全部检查门禁 |
| `docs/` | 架构、完成定义、配置说明与 ADR |

## 后端 API

`/usr/share/rpcd/ucode/portal.uc` 由 `rpcd-mod-ucode` 加载，暴露为 `luci.portal`
ubus 对象：

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

# 素材管理 —— 浏览器只能写 /tmp/portal_upload.tmp，由后端搬到最终文件名
ubus call luci.portal upload '{ "dir": "bg", "name": "wallpaper.jpg" }'
ubus call luci.portal rename '{ "dir": "bg", "name": "wallpaper.jpg", "new_name": "home.jpg" }'
ubus call luci.portal remove  '{ "dir": "bg", "name": "home.jpg" }'
```

上面每个方法都必须出现在 `root/usr/share/rpcd/acl.d/luci-app-portal.json` 中，
否则浏览器里会得到 *Access denied*。`scripts/check.sh` 每次运行都会核对这份对应关系。

扫描结果的 `web` 字段有三种取值：

| 取值 | 含义 |
|---|---|
| `true` | 已知的 Web 服务 —— 会加成禁用状态的书签 |
| `false` | 确定不是浏览器目标（`ssh`、`dns`、`mdns`、`dhcp`、`ntp`、`openvpn`、`wireguard` 等）—— 不会提示 |
| `"unknown"` | `/etc/services` 里没有对应条目 —— 弹窗列出，由你决定 |

端口号本身不携带协议信息，所以 `7890` 可能是代理也可能是任意 TCP 服务，`1053` 是
mDNS。与其双向猜测，不如把未识别的端口列出来让你一次性勾选添加为禁用书签。

该脚本**仅作插件** —— rpcd 加载时不会定义 `ARGV`，因此它无法兼作命令行工具。
按上例通过 ubus 调用即可。

`status` 刻意把「进程存活」与「端口已监听」分开判定：procd 会不断重启一个启动即退出的
守护进程，只看 PID 会掩盖一个根本不应答的门户。

## uci 配置参考

```
config portal
	option enabled           '1'         # 总开关；'0' 停止门户
	option port              '8180'      # 门户监听端口
	option title             'My Portal' # 页面标题与 <title>
	option background        '#0e1116'   # CSS 颜色
	option background_file   ''          # /etc/portal/www 下的绝对路径
	option bg_veil           '78'        # 0-100：背景图被压暗的程度
	option bg_blur           '0'         # 0-100：磨砂模糊，100 等于最大值 20 px
	option card_transparency '45'        # 0-100：100 表示卡片完全透出背景

config link
	option name     'AdGuard Home'
	option url      'http://192.168.1.1:3000'
	option icon_url '🛡️'              # 或：option icon '/etc/portal/www/icons/x.png'
	option enabled  '1'
```

`links.json` 原样带上标题、背景与三个外观百分比；`portal.js` 把百分比转成
`portal.css` 消费的 CSS 自定义属性，所以门户页自己不必读 uci。删掉其中任何一项都会
在后台回落到同一个值 —— 这正是「这些选项存在之前写下的配置」外观不变的原因。

`/etc/config/portal` 一有变化，`links.json` 会自动重新生成（LuCI 点「保存并应用」，
或 `uci commit` 加 `/etc/init.d/portal reload`）。页面上的**立即重新生成 links.json**
按钮可强制刷新。

## 排查

「常规」页有「运行状态」面板；同样的数据也可以从命令行取：

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
| 浏览器控制台报 *Access denied* | 有 ubus 方法没写进 ACL —— 跑一下 `sh scripts/check.sh` |

实例绑定 `0.0.0.0:<端口>`（所有网卡，IPv4）；要只绑某个地址需自行改
`/etc/init.d/portal`。

## 已知限制

| 限制 | 原因 |
|---|---|
| 上传单个文件 ≤ 2 MiB | 前端与后端都做校验，手工构造的请求也绕不过去。多兆的背景图**显示**没问题，限的只是上传 |
| 文件名仅限 ASCII 字母数字与 `.` `-` `_` | 文件名会变成设备路径；直接拒绝比悄悄改写用户输入更安全，也能从根上杜绝路径穿越。中文名与空格会被拒绝 |
| 缩略图依赖门户自身的 HTTP 端口 | 缩略图改为 `http://<路由器>:<端口>/…` 直接取，因此解除了 256 KiB 内联上限。但 LuCI 走 **HTTPS** 时浏览器会按混合内容拦截，此时缩略图降级为文字链接 |
| 不会主动探测未识别端口 | 判定端口是否说 HTTP 需要在同步 ubus 方法里做带超时的 `GET /`，会阻塞整个 rpcd（连带所有 LuCI 页面）。因此改为列出来由你决定 |
| 设为背景只暂存 | 与其他设置一致，需点「保存并应用」才生效 —— `generate()` 跑在后端进程里，用的是它自己的 `uci` cursor，否则会烘出旧值 |

## 构建

构建需要与目标固件匹配的 Linux SDK —— WSL2 + Ubuntu 完全可用，但 SDK 与源码树必须
放在 Linux 文件系统里，**不能**放在 `/mnt/` 下。

```sh
tar --zstd -xf immortalwrt-sdk-<version>-<arch>_gcc-*.tar.zst
cd immortalwrt-sdk-*/

./scripts/feeds update -a
./scripts/feeds install -a

cp -r /path/to/luci-app-portal package/
make defconfig
make package/luci-app-portal/compile V=s
```

产物在 `bin/packages/<arch>/luci/`。注意 SDK 自带的 `.config` 描述的是一整个固件镜像；
除非你确实要编译整个包树，否则请先删掉其中的 `CONFIG_PACKAGE_*=m` 行。

## 开发

```sh
sh scripts/check.sh
```

这就是 CI 跑的那道门禁：JS 语法、JSON 合法性、`shellcheck`、`msgfmt --check`、
ubus↔ACL 对应关系、行尾、以及模板占位符残留。任一项失败即以非零退出。单条命令见
[AGENTS.md](AGENTS.md) §2，代码约定见 [docs/architecture.md](docs/architecture.md)。

## 许可证

GPL-2.0-only，见 [LICENSE](LICENSE)。
