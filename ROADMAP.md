# Roadmap

Planned work and known open issues. Nothing here is scheduled for a particular
release; entries are removed as they are fixed.

## Known issues

### v2.0.0-r7 — asset rename, delete and "set as background" do nothing

**Status:** open, reported against `v2.0.0-r7`
**Affects:** the Assets page (素材库) — 重命名 / 删除 / 设为背景

All three operations report success but leave the file system unchanged.

#### Symptom

| Action | What the user sees | What actually happens |
|---|---|---|
| Rename | notification `Renamed to <name>.` | file keeps its old name |
| Delete | notification `Deleted <name>.` | file is still there |
| Set as background | notification `Background set to <name>. …` | portal background unchanged |

No error is ever shown, which is the main reason the report reads as "无效"
rather than as a failure.

#### Root cause 1 — `run_rpc()` cannot see a backend failure

`htdocs/luci-static/resources/portal/common.js:94`:

```js
run_rpc(action, okMsg) {
    return Promise.resolve()
        .then(action)
        .then((res) => {
            if (okMsg != null && res != null)        // only tests for null
                ui.addNotification(null, E('p', {}, /* … */), 'info');
            return res;
        })
        .catch((err) => { /* … */ return null; });
}
```

The `upload` / `rename` / `remove` methods in
`root/usr/share/rpcd/ucode/portal.uc` report failure by **returning**
`{ ok: false, error: '…' }`. That is a fulfilled promise carrying an ordinary
object, so:

- `res != null` is true, so the success notification is shown;
- `.catch()` never runs, so the actual `error` string is discarded;
- the caller sees a non-null result and proceeds to `reload_soon()`
  (`assets.js:174`), which reloads the page — where the file is, of course,
  still unchanged.

Every `{ ok: false }` return path in `portal.uc` is affected, not just these
three. Any future method must either reject or be checked by the caller.

#### Root cause 2 — "set as background" only stages a value

`htdocs/luci-static/resources/view/portal/assets.js:328`:

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

The value is only *staged*. It is committed by the page footer's
"Save & Apply" button, which re-bakes `links.json` through the `portal`
procd reload trigger. Two things can therefore leave the background unchanged:

- the user never presses "Save & Apply";
- `generate()` runs inside the rpcd plugin process, which uses its own
  `cursor()` and no session save directory, so it cannot see the staged value
  unless the session has been committed *and* applied first.

#### Fix direction

1. Make `run_rpc()` treat a resolved `{ ok: false }` as a failure — throw it so
   the existing `.catch()` reports `error`, or check `res.ok` before notifying.
   The second is less invasive but every call site has to opt in.
2. Have the Assets page chain `ui.changes.apply()` after the background is
   staged, so the value is committed and `links.json` re-baked in one step, the
   way the rest of the UI treats a setting as applied.

Both are code changes and are deliberately **not** part of `v2.0.0-r7`.
