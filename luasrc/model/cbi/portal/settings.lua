-- CBI settings page for luci-app-portal
local m, s, o
local uci = require "luci.model.uci".cursor()

m = Map("portal", translate("Portal Settings"),
  translate("Static HTML portal served on a custom port by its own uhttpd instance. "
            .. "Changes are saved to uci and baked into the static page on apply."))

-- General
s = m:section(TypedSection, "portal", translate("General"))
s.anonymous = true
s.addremove = false

o = s:option(Value, "port", translate("Listen port"))
o.datatype = "port"
o.default = "8180"
o.rmempty = false
function o.validate(self, value)
    local p = tonumber(value)
    if p == 80 or p == 8080 then
        return nil, translate("Port 80/8080 are reserved by the main web server.")
    end
    local inuse = false
    uci:foreach("uhttpd", "uhttpd", function(x)
        for _, l in ipairs({ x.listen_http or "", x.listen_https or "" }) do
            local pp = l:match(":(%d+)$")
            if pp and tonumber(pp) == p then inuse = true end
        end
    end)
    if inuse then
        return nil, translate("Port already used by the main uhttpd instance.")
    end
    return value
end

o = s:option(Value, "title", translate("Page title"))
o.rmempty = true

o = s:option(Value, "background",
    translate("Background (hex color, e.g. #0e1116)"))
o.rmempty = true
o.placeholder = "#0e1116"

o = s:option(FileUpload, "background_file",
    translate("Or upload a background image"))
o.root_dir = "/etc/portal/www/bg"
o.archive = false
o.forcewrite = true
s:option(FileRemove, "background_file_rm", translate("Remove background image"))

-- Bookmarks
ls = m:section(TypedSection, "link", translate("Bookmarks"))
ls.anonymous = true
ls.addremove = true
ls.template = "cbi/tblsection"

o = ls:option(Value, "name", translate("Name"))
o.rmempty = false
o = ls:option(Value, "url", translate("URL"))
o.rmempty = false
o = ls:option(Value, "icon_url",
    translate("Icon (emoji or remote URL)"))
o.rmempty = true
o = ls:option(FileUpload, "icon", translate("Or upload an icon"))
o.root_dir = "/etc/portal/www/icons"
o.archive = false
o.forcewrite = true
ls:option(FileRemove, "icon_rm", translate("Remove icon"))
o = ls:option(Flag, "enabled", translate("Enabled"))
o.default = "1"

-- Actions
local b = s:option(Button, "_gen", translate("Static page"))
b.inputtitle = translate("Regenerate now")
b.onclick = "location.href='" .. luci.dispatcher.build_url("admin/services/portal/generate") .. "'"

local sb = s:option(Button, "_scan", translate("Discovery"))
sb.inputtitle = translate("Scan ports & add (disabled)")
sb.onclick = "location.href='" .. luci.dispatcher.build_url("admin/services/portal/scanadd") .. "'"

-- Bake the static page after Save & Apply (fallback: use the button above).
function m.on_after_apply(self)
    require("luci.portal").generate()
end

return m
