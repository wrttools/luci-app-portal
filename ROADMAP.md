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
| 4 | 素材库上传 / 重命名 / 删除 / 设为背景 | in-progress | 设备上四个操作后文件确实变动，且**失败时必须弹错误提示** —— 当前不满足，见 [已知缺陷](#已知缺陷) | v2.0.0-r7 |
| 5 | 协作规范（AGENTS / docs / ADR / CI 门禁） | done | `sh scripts/check.sh` 输出 `ALL CHECKS PASSED`；`.github/workflows/build.yml` 的 `test` job 为绿 | 本次改造 |
| 6 | 回归测试体系（vitest / uci 集成测试） | planned | `sh scripts/check.sh` 之外存在 `sh scripts/test.sh` 且 CI 调用它；至少覆盖 `run_rpc()` 失败传播 | 依赖 CI 基础设施 |
| 7 | 书签页表头排版：把「已启用」文字移到描述行 | planned | 设备上打开书签页，表头第二行（描述行）`data-widget="CBI.FlagValue"` 那一格里出现「启用」字样，且该行「图标」列仍是「emoji 或图片的绝对 URL。」—— 两段文字同一行 | 用户 2026-10-05 提出，纯排版、不动数据；书签页进入 r16 后再做 |

## 已知缺陷

### v2.0.0-r7 —素材库的重命名、删除与「设为背景」无效

**状态：** open, reported against `v2.0.0-r7`
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
