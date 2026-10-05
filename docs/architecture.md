# 架构与代码约定

> 项目：luci-app-portal。本文件说明「代码怎么组织」；
> 「什么时候算完成」见 [definition-of-done.md](definition-of-done.md)。

## 1. 目录结构

本项目是 OpenWrt 软件包，目录含义由 `luci.mk` 约定 —— `htdocs/`、`root/`、`po/` 会
被原样安装到设备，路径本身就是契约。

| 路径 | 安装到设备 | 职责 |
|------|------------|------|
| `htdocs/luci-static/resources/portal/common.js` | `/www/luci-static/resources/portal/` | 跨视图共享：RPC 封装、状态面板、错误上报 |
| `htdocs/luci-static/resources/view/portal/*.js` | `/www/luci-static/resources/view/portal/` | 三个 LuCI 视图，各自 `L.view()` 导出一个页面 |
| `root/usr/share/rpcd/ucode/portal.uc` | 原样 | 后端，`luci.portal` ubus 对象 |
| `root/usr/share/rpcd/acl.d/luci-app-portal.json` | 原样 | 上述方法的权限白名单 |
| `root/usr/share/luci/menu.d/luci-app-portal.json` | 原样 | 菜单注册 |
| `root/usr/share/portal/www/` | `/usr/share/portal/www/` | 门户前端模板；postinst 拷进 `/etc/portal/www/` |
| `root/etc/init.d/portal` | `/etc/init.d/portal` | procd 服务：生成 `links.json` + 起独立 `uhttpd` |
| `root/etc/config/portal` | `/etc/config/portal` | 默认 uci 配置（conffile） |
| `scripts/check.sh` | **不安装** | 本地与 CI 的全部门禁 |
| `docs/` | **不安装** | 文档与 ADR |

`/etc/portal/www/` 是运行时目录：postinst 从 `/usr/share/portal/www/` 拷一份，
用户的图标、背景与 `links.json` 都落在那里。卸载时整个 `/etc/portal` 被删除。

## 2. 分层与依赖方向

依赖单向，不可反向：

```
LuCI 视图 (view/portal/*.js)
        │  浏览器只能写 /tmp/portal_upload.tmp
        ▼
   ubus / luci.portal  ──►  portal.uc  ──►  uci / fs
        │
        ▼
procd init.d/portal  ──►  uhttpd  ──►  /etc/portal/www/（静态文件）
```

- **视图不得包含系统逻辑。** 浏览器读不到 `/proc/net/tcp[6]`，也拿不到 `uci` 以外的系统
  状态。端口扫描、文件读写、配置落盘一律放后端。
- **`common.js` 是唯一的共享层。** 三个视图之间不得互相 `require`，共同逻辑一律提到
  `portal/common.js`。
- **门户前端（`www/portal.js`）不依赖 LuCI。** 它是给访客看的裸页面，只能读
  `links.json`。

## 3. ubus 契约

`portal.uc` 末尾的 `const methods = {…}` 是**唯一**的方法清单，ACL 必须与之对应：

| 方法 | 用途 | 副作用 |
|------|------|--------|
| `generate` | 从 uci 重新烘焙 `links.json` | 写文件 |
| `status` | 进程/端口/书签数状态 | 无 |
| `scan` | 扫 `/proc/net/tcp[6]` | 无 |
| `upload` | 把 `/tmp/portal_upload.tmp` 搬到素材目录 | 写文件 |
| `rename` | 素材改名 | 写文件 |
| `remove` | 素材删除（返回仍被引用的数量） | 删文件 |

**改这个表必须同时改 ACL**，否则运行时才报 *Access denied*。`scripts/check.sh` 里的
ubus↔ACL 项就是为此存在。

两个必须保留的约定：

- `portal.uc` **只是插件**。rpcd 加载时不定义 `ARGV`，因此它不能兼作 CLI 工具，
  也不必为此加 `if (ARGV)` 分支。
- `generate()` 跑在 rpcd 插件进程内，用自己的 `cursor()`。它读不到浏览器侧未提交的
  `uci` 暂存值 —— 这就是「设为背景只暂存」的成因。

## 4. 错误处理

- **后端不抛异常，用 `{ ok: false, error: '…' }` 返回。** rpcd 会把异常吞成
  `ubus call` 的非零退出，浏览器侧拿不到原因。
- **前端必须显式检查 `ok`。** 这是当前的已知缺陷：`common.js:94` 的 `run_rpc()` 只判
  `res != null`，于是 resolved 的 `{ ok: false }` 被当成成功（见
  [ROADMAP.md](../ROADMAP.md) 根因 1）。新增调用点时不要复制这个模式。
- 错误信息要带足定位上下文（哪个文件、哪个目录），但不得含绝对路径以外的用户数据。

## 5. 安全边界

- **ACL 是安全边界。** 收紧可以，放宽必须说明理由。
- **上传有两道闸**：文件名白名单（ASCII 字母数字与 `.` `-` `_`）与 2 MiB 上限在
  **前端和后端各做一次**。不得因为「前端已经拦了」就删后端那一份。
- 文件名直接成为设备路径，因此**拒绝**而非静默改写；这也顺带杜绝了路径穿越。
- 浏览器只被允许写 `/tmp/portal_upload.tmp`，由后端 `rename(2)` 搬到最终位置 ——
  二进制载荷因此不会经过 ubus 消息。

## 6. 日志

- 后端不写日志文件；`/etc/init.d/portal` 用 `>/dev/null 2>&1` 吞掉 ubus 调用的输出。
  排障看 `ubus call luci.portal status`，不要靠日志。

## 7. 命名与风格

| 对象 | 约定 | 例 |
|------|------|-----|
| ucode 函数 | `snake_case` | `upload_asset()`、`classify_port()` |
| ubus 方法名 | `snake_case`，进 ACL 的是**方法名**而非函数名 | `upload` → `upload_asset()` |
| LuCI 视图 | 目录 `view/portal/`，文件名小写单词 | `bookmarks.js` |
| uci 字段 | `snake_case` | `background_file`、`icon_url` |
| JS | ES6+，`const`/`let`，不用 `var`；缩进 **tab** | |

**为什么 `upload` 方法映射到 `upload_asset()` 函数**：`fs` 里已 `import` 了 `rename`，
若本地函数也叫 `rename` 会遮蔽导入。同理 `upload` 会与「HTTP upload」语义混淆。

## 8. 依赖引入规则

- 本项目**不引入编译型依赖或构建步骤** —— 它是纯脚本包，引入工具链会让「clone 即可
  审查」这一性质失效，且 CI 无法在合理时间内验证。
- 新增运行时依赖须进 `LUCI_DEPENDS`（`Makefile`），并说明为什么标准做法做不到。
- 翻译字符串进 `po/templates/portal.pot` 与 `po/zh_Hans/portal.po`；
  `PKG_PO_VERSION` 被钉成 `PKG_VERSION`，否则每次构建 mtime 变化会留下陈旧的
  `luci-i18n-*` 产物。
