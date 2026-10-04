-- luci.controller.portal: menu entry, public redirect, and backend actions
module("luci.controller.portal", package.seeall)

local portal = require "luci.portal"
local uci    = require "luci.model.uci".cursor()
local http   = require "luci.http"
local sys    = require "luci.sys"

function index()
    local page = entry({"admin", "services", "portal"}, firstchild(), _("Portal"), 60)
    page.dependent = false
    entry({"admin", "services", "portal", "settings"}, cbi("portal/settings"), _("Settings"), 1)
    entry({"admin", "services", "portal", "scan"},    call("action_scan"),    nil).leaf = true
    entry({"admin", "services", "portal", "scanadd"}, call("action_scanadd"), nil).leaf = true
    entry({"admin", "services", "portal", "generate"},call("action_generate"),nil).leaf = true
    -- public landing (no login required); redirects to the custom-port site
    entry({"portal"}, call("show_portal"), nil).leaf = true
end

function show_portal()
    local port = uci:get("portal", "@portal[0]", "port") or "8180"
    local host = http.getenv("HTTP_HOST") or "192.168.1.1"
    host = host:match("^[^:]+")   -- strip any existing port
    http.redirect("http://" .. host .. ":" .. port .. "/")
end

function action_generate()
    portal.generate()
    http.redirect(luci.dispatcher.build_url("admin/services/portal/settings"))
end

function action_scan()
    local raw = http.formvalue("ports") or ""
    local list = {}
    for p in raw:gmatch("%d+") do
        list[#list + 1] = tonumber(p)
    end
    local res = portal.scan(#list > 0 and list or nil)
    http.prepare_content("application/json")
    http.write_json(res)
end

-- One-click scan: add every open port as a DISABLED bookmark so the user
-- can tick the ones they want. URL uses the router LAN address.
function action_scanadd()
    local ip = (sys.exec("uci -q get network.lan.ipaddr") or ""):gsub("%s+", "")
    if ip == "" then ip = "192.168.1.1" end

    local res = portal.scan()
    for _, s in ipairs(res) do
        uci:section("portal", "link", nil, {
            name    = (s.svc ~= "" and s.svc or "port") .. " " .. s.port,
            url     = "http://" .. ip .. ":" .. s.port,
            icon    = "🔌",
            enabled = "0"
        })
    end
    uci:commit("portal")
    portal.generate()
    http.redirect(luci.dispatcher.build_url("admin/services/portal/settings"))
end
