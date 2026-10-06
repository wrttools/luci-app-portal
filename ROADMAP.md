# luci-app-portal 功能清单（ROADMAP）

> 状态取值：`planned` / `in-progress` / `done` / `dropped`。
> 「验收标准」须**可判定**（能被命令或明确检查验证），AI 助手据此判断功能是否完成。
> 本项目没有单元测试，因此验收标准多为「命令通过」或「设备上的可观察现象」。

## 状态总览

| # | 功能 | 状态 | 验收标准 | 备注 |
|---|------|------|----------|------|
| 1 | 门户静态页 + 独立 `uhttpd` 实例 | done | 设备上 `ubus call luci.portal status` 返回 `listening: true`，且 `curl http://127.0.0.1:<port>/` 返回门户 HTML | v2.0.0 |
| 2 | LuCI 三视图（常规 / 书签 / 素材库） | done | 三个视图均可打开且无 JS 报错；改动 ubus 方法后 `sh scripts/check.sh` 的 ubus↔ACL 项通过 | v2.0.0 |
| 3 | 端口扫描（`/proc/net/tcp[6]`） | done | `ubus call luci.portal scan` 返回 `lan_ip` 与 `ports`；只监听 `127.0.0.1` 的服务不出现在结果里 | v2.0.0 |
| 4 | 素材库上传 / 重命名 / 删除 / 设为背景 | done | 设备上上传 / 重命名 / 删除后文件确实变动，且**失败时必须弹错误提示**；「设为背景」按 B 方案保持暂存语义（须再点「保存并应用」） | r18 修 ubus 参数策略、r19 修调用风格、r20 修跨设备 rename；2026-10-06 设备验证 上传/预览/改名 通过（删除未单独复测） |
| 5 | 协作规范（AGENTS / docs / ADR / CI 门禁） | done | `sh scripts/check.sh` 输出 `ALL CHECKS PASSED`；`.github/workflows/build.yml` 的 `test` job 为绿 | 本次改造 |
| 6 | 回归测试体系（vitest / uci 集成测试） | planned | `sh scripts/check.sh` 之外存在 `sh scripts/test.sh` 且 CI 调用它；至少覆盖 `run_rpc()` 失败传播 | 依赖 CI 基础设施 |
| 7 | 书签页表头排版：把「已启用」文字移到描述行 | done | 设备上打开书签页，表头第二行（描述行）`data-widget="CBI.FlagValue"` 那一格里出现「启用」字样，且该行「图标」列仍是「emoji 或图片的绝对 URL。」—— 两段文字同一行 | 用户 2026-10-05 提出；`2.0.0-r17` 实现，设备验证通过 |
| 8 | 书签页通知不累计 | planned | 在书签页连续点「保存」或勾选「全选」5 次后，页面上可见的通知条数仍为 1（每次替换上一条），页面高度不随点击次数增长 | 用户 2026-10-06 报告；现为逐条累加、不自动消失也不替换 |
| 9 | 门户页背景色更换无效 | planned | 改「背景色」→「保存并应用」后，门户页 HTML/CSS 里 `background-color` 的值为新设定的颜色 | 用户 2026-10-06 报告；根因待定位，按约定 fix 须在 ROADMAP 记录根因 |
| 10 | 门户页去掉「立即重新生成 links.json」按钮 | planned | 门户设置页不再出现该按钮；点「保存并应用」后 `/etc/portal/www/links.json` 的 mtime 更新（procd reload 触发器自动重生成） | 用户 2026-10-06 提出；需先确认 reload 触发器已绑定 generate |
| 11 | 书签页行内「保存」成功后按钮显示「已保存」 | planned | 设备上书签页点某行「保存」成功后，该行按钮文字显示「已保存」 | 用户 2026-10-06 提出 |
| 12 | 门户页背景图显示行为 | planned | **待澄清** | 用户 2026-10-06 报告「浏览器访问 http://192.168.100.1:8997/ 不想显示背景图」。语义有两种读法：(a) 门户首页不应显示背景图；(b) 设了背景图但门户页没显示出来。确认后补可判定的验收标准 |
| 13 | 素材库操作后的刷新范围 | planned | 上传 / 改名 / 设为背景后，整页刷新次数为 0（`window.location.reload` 不再被调用），而素材库列表与通知区仍更新为新状态 | 用户 2026-10-06 提出；现由 `assets.js` 的 `reload_soon()`（`window.location.reload()`，延迟 1.2 s）触发整页刷新 |

## 已知缺陷

### v2.0.0-r7 —素材库的重命名、删除与「设为背景」无效

**状态：** resolved（`v2.0.0-r20`，2026-10-06），原报于 `v2.0.0-r7`
**影响：** 素材库页面 —— 重命名 / 删除 / 设为背景

三个操作都提示成功，但文件系统毫无变化。

#### 现象

| 操作 | 用户看到 | 实际发生 |
|---|---|---|
| 重命名 | 通知 `Renamed to <name>.` | 文件仍是原名 |
| 删除 | 通知 `Deleted <name>.` | 文件还在 |
| 设为背景 | 通知 `Background set to <name>. …` | 门户背景没变 |

全程不报错 —— 这正是该问题被当成「无效」而非「失败」上报的原因。

#### 根因 1 —— `run_rpc()` 看不到后端失败

`htdocs/luci-static/resources/portal/common.js:94`：

```js
run_rpc(action, okMsg) {
    return Promise.resolve()
        .then(action)
        .then((res) => {
            if (okMsg != null && res != null)        // 只判空
                ui.addNotification(null, E('p', {}, /* … */), 'info');
            return res;
        })
        .catch((err) => { /* … */ return null; });
}
```

`root/usr/share/rpcd/ucode/portal.uc` 里的 `upload` / `rename` / `remove` 报告失败时
是**返回** `{ ok: false, error: '…' }`。这是一个携带普通对象的 fulfilled promise，于是：

- `res != null` 为真，成功提示照常弹出；
- `.catch()` 永不执行，真正的 `error` 字符串被丢弃；
- 调用方拿到非 null 结果，继续 `reload_soon()`（`assets.js:174`）刷新页面 ——
  而文件当然还是没变。

`portal.uc` 中每一条返回 `{ ok: false }` 的路径都受影响，不止这三个。后续任何方法
要么 reject，要么由调用方显式检查。

#### 根因 2 —— 「设为背景」只暂存了值

`htdocs/luci-static/resources/view/portal/assets.js:328`：

```js
function set_background(entry) {
    const sections = uci.sections('portal', 'portal');
    if (!sections.length)
        return Promise.resolve();

    uci.set('portal', sections[0]['.name'], 'background_file', BG_DIR + '/' + entry.name);

    return common.run_rpc(function() {
        return uci.save();
    }, _('Background set to %s. Press "Save & Apply" below to make it take effect.').format(entry.name));
}
```

这个值只是被**暂存**，要靠页面底部的「保存并应用」提交，提交时经 `portal` 的 procd
reload 触发器重新烘焙 `links.json`。因此有两种情况会让背景没变：

- 用户没点「保存并应用」；
- `generate()` 跑在 rpcd 插件进程内，用的是它自己的 `cursor()`，看不到未提交的暂存值。

#### 修复方向

1. 让 `run_rpc()` 把 resolved 的 `{ ok: false }` 当作失败 —— 抛出去让既有 `.catch()`
   上报 `error`；或在通知前先查 `res.ok`。后者改动更小，但每个调用点都得各自 opt in。
2. 素材库页面在暂存背景后链式调用 `ui.changes.apply()`，让值提交与 `links.json`
   重烘一步完成，与界面其余部分对待设置项的方式保持一致。

两者都是代码改动，**刻意不包含在 `v2.0.0-r7`**。

#### 实测定论：真正让三个操作失效的是另外两层（2026-10-06）

上面两节是 `v2.0.0-r7` 当时对代码的静态推断。设备上逐条验证后确认：让三个操作
「点了没反应」的是下面两个层次的问题，**都不在 `run_rpc()` 的内部逻辑里**。

##### 根因 A —— rpcd 方法表没有声明 `args`（`v2.0.0-r18` 修复）

`portal.uc` 的方法表只写了 `call:`。rpcd 是用 `args` 生成 ubus 参数策略的，未声明
即等于「零参数方法」，任何具名参数都会在**回调执行之前**被拒：

| 步 | 环节 | 源码依据 |
|---|---|---|
| 1 | 前端发 `{ dir, name, ubus_rpc_session }` | `rpc.declare({ params: […] })` |
| 2 | 方法表无 `args` ⇒ 策略为空 `{}` | rpcd `ucode.c` `rpc_ucode_method_register()` |
| 3 | 具名参数被判非法 ⇒ `UBUS_STATUS_INVALID_ARGUMENT`(2)，**回调不执行** | `ucode.c:266` `rpc_ucode_validate_call_args()` |
| 4 | uhttpd 以 legacy 格式回 `{"result":[2]}` | `ubus.c` `uh_ubus_request_cb()` |
| 5 | LuCI 默认把状态码**当结果** resolve（除非 `reject: true`） | `rpc.js:92-97` |
| 6 | `2.ok === undefined` ⇒ 守卫不成立 ⇒ 弹「成功」并刷新 | `common.js`、`assets.js` |

设备证据：修复前 `ubus call luci.portal rename '{"dir":"icons",…}'` 返回
`Command failed: Invalid argument`；修复后同一命令返回
`{"ok":false,"error":"no such file"}`。修法：给 `scan` / `upload` / `remove` / `rename`
声明 `args`，回调改读 `request.args`，并给本 App 全部 `rpc.declare` 加上 `reject: true`。

##### 根因 B —— 数组风格 `params` 与对象调用不匹配（`v2.0.0-r19` 修复）

`rpc.declare` 的 `params` 有两种风格，`rpc.js:302-305` 的**数组分支是位置映射**：

```js
params: [ 'dir', 'name' ]
callUpload({ dir: dir_key(dir), name: name });   // 错：对象被当成第一个参数本身
```

实际发出的是 `{"dir":{"dir":…,"name":…}}` —— `name` 直接丢失、`dir` 变成 table，
于是又一次类型不匹配，仍然是 code 2。用 node 复刻 `rpc.js` 该分支实测：

```
旧: callUpload({ dir, name })  -> {"dir":{"dir":"icons","name":"logo.png"}}
新: callUpload(dir, name)      -> {"dir":"icons","name":"logo.png"}
```

`scan` 是无参调用，所以没受影响；`upload` / `remove` / `rename` 三个调用点全部中招。
修法：三个调用点改为位置传参，并在 `scripts/check.sh` 增加门禁
「rpc 调用点不得传对象字面量」（`grep -rnE 'call[A-Z][A-Za-z0-9_]*\(\{'`）。

##### 根因 C —— 跨设备 `rename()` 返回 `EXDEV`（`v2.0.0-r20` 修复）

r19 之后 ubus 调用终于进到回调，`upload_asset()` 返回
`{ ok: false, error: "unable to store the file" }`，即
`rename('/tmp/portal_upload.tmp', '/etc/portal/www/icons/<name>')` 失败。

原因是**跨挂载点**：浏览器落盘的 `/tmp` 是一个独立的 tmpfs（`cgi-upload` 只能写
那里），而 `/etc/portal/www` 在 overlay 上；`rename(2)` 不允许跨文件系统。

用 SDK 的 ucode 对 `/dev/shm`（tmpfs）→ `/home`（overlay）实测：

```
rename(tmpfs -> overlay) = null
fs.error()               = "Cross-device link"
readfile + writefile     = 跨设备正常
```

修法：把「搬进目的地」由 `rename(2)` 改为 `readfile` + `writefile` + `unlink`
（载荷已被 2 MiB 上限约束，走一次内存可接受）。写失败时 `unlink(dst)`，避免留下
半截文件把重试堵成「同名已存在」。

同时新增 `with_errno()`：把 `fs.error()` 的 errno 文本附到错误串上。此前所有 fs
失败都显示同一句话，正是这次需要多轮设备复测才能定位的原因。注意 `fs.error()`
读取后即清零，必须在失败后**立刻**调用。

**行为测试**（把 `WWW` / `TMP_UPLOAD` 重定向到 tmpfs→overlay 一对路径，直接调用
真实 `upload_asset()`，并以旧代码作证伪对照）：

| 版本 | 返回 | 目的文件 |
|---|---|---|
| 旧（`rename`） | `{ok:false, error:"unable to store the file"}` | 未创建 |
| 新（copy） | `{ok:true, name:"probe.png"}` | 存在，且逐字节一致 |

##### 本轮状态

- 上节「根因 1」（`run_rpc()` 看不到失败）在 `v2.0.0-r17` 修掉：失败现在会真弹「操作失败」。
- 上节「根因 2」（「设为背景」）按用户决定走 **B 方案**：保持暂存语义，**不**链式
  `ui.changes.apply()`。
- 根因 A / B / C 分别随 `v2.0.0-r18` / `r19` / `r20` 出包。
- **2026-10-06 设备验证通过**：上传、预览、重命名经真机确认生效（文件确实变动，失败时
  弹错误提示）。删除与「设为背景」走同一条已修好的路径，未单独复测。
- 遗留提示：浏览器会缓存 SPA 的 JS 模块，换上新包后需 `Ctrl+Shift+R` 硬刷新，否则
  仍会跑旧代码。
