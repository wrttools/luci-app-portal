# luci-app-portal

A pure-HTML navigation portal for ImmortalWrt 25.x, packaged as a `luci-app`.
Served by its own `uhttpd` instance on a user-configurable port, so it never
touches the main web server on 80/8080. Bookmarks, icons and background are
persisted via `uci` and baked into a static `links.json`.

## Features

- Custom listen port (validated against 80/8080 and the main uhttpd).
- User bookmarks with emoji / remote-URL / uploaded icons.
- Background: hex color or uploaded image.
- One-click port scan (router localhost) adds open ports as disabled bookmarks.
- Clean uninstall: `prerm` removes all runtime data under `/etc/portal`.

## Build (ImmortalWrt SDK)

```sh
tar -xf immortalwrt-sdk-25.*-<arch>.tar.xz && cd immortalwrt-sdk-*
cp -r luci-app-portal package/
make package/luci-app-portal/compile V=s
# bin/packages/<arch>/.../luci-app-portal_1.0-1_all.apk
```

## Install

```sh
apk add ./luci-app-portal_*.apk
# open http://<router-ip>:<port>/   (default port 8180)
```

## Configure

LuCI → Services → Portal. Save & Apply regenerates the static page. Changing the
listen port requires `/etc/init.d/portal restart`.

## Uninstall

```sh
apk del luci-app-portal   # no residue left
```

---

# luci-app-portal（中文）

ImmortalWrt 25.x 的纯 HTML 导航门户，打包为 `luci-app`。由独立 `uhttpd` 实例在
用户自定义端口托管，不占用主 web 服务的 80/8080。书签、图标、背景通过 `uci`
持久化，并烘进静态 `links.json`。

## 功能

- 自定义监听端口（校验避开 80/8080 及主 uhttpd）。
- 书签支持 emoji / 远程 URL / 上传图标。
- 背景支持 hex 颜色或上传图片。
- 一键端口扫描（路由器本机）将开放端口以禁用书签加入，供勾选启用。
- 卸载干净：`prerm` 清除 `/etc/portal` 下全部运行时数据。

## 构建（ImmortalWrt SDK）

```sh
tar -xf immortalwrt-sdk-25.*-<arch>.tar.xz && cd immortalwrt-sdk-*
cp -r luci-app-portal package/
make package/luci-app-portal/compile V=s
```

## 安装

```sh
apk add ./luci-app-portal_*.apk
# 浏览器打开 http://<路由器IP>:<端口>/   （默认端口 8180）
```

## 配置

LuCI → 服务 → Portal。保存并应用即重新生成静态页。修改监听端口后需
`/etc/init.d/portal restart`。

## 卸载

```sh
apk del luci-app-portal   # 无残留
```
