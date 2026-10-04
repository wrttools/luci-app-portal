-- luci.portal: shared library (generate static page from uci, port scan)
module("luci.portal", package.seeall)

local jsonc = require "luci.jsonc"
local nixio = require "nixio"
local uci   = require "luci.model.uci".cursor()

local WWW = "/etc/portal/www"

-- Build /etc/portal/www/links.json from uci config.
-- Uploaded assets live under WWW/icons and WWW/bg so the served page
-- can reference them by relative path (icons/xxx, bg/xxx).
function generate()
    local data = {
        title      = uci:get("portal", "@portal[0]", "title") or "Portal",
        background = "",
        links      = {}
    }

    local bg  = uci:get("portal", "@portal[0]", "background") or ""
    local bgf = uci:get("portal", "@portal[0]", "background_file") or ""
    if bgf ~= "" then
        data.background = "bg/" .. bgf
    elseif bg ~= "" then
        data.background = bg
    end

    uci:foreach("portal", "link", function(s)
        if s.enabled ~= "0" then
            table.insert(data.links, {
                name = s.name or "",
                url  = s.url or "",
                icon = s.icon or s.icon_url or ""
            })
        end
    end)

    nixio.fs.mkdir(WWW)
    nixio.fs.mkdir(WWW .. "/icons")
    nixio.fs.mkdir(WWW .. "/bg")
    local f = io.open(WWW .. "/links.json", "w")
    if f then
        f:write(jsonc.stringify(data))
        f:close()
    end
    return data
end

-- Service name guess for well-known ports.
local SVC = {
    [22]="ssh", [53]="dns", [80]="http", [443]="https",
    [3000]="?", [5000]="?", [5053]="dns", [8000]="http",
    [8080]="http-alt", [8081]="?", [8123]="?", [8181]="?",
    [8384]="?", [8443]="https-alt", [8888]="?", [9000]="?",
    [9090]="?", [6888]="?", [1194]="openvpn", [51820]="wireguard"
}

local DEFAULT_PORTS = {
    22, 53, 80, 443, 3000, 5000, 5053, 8000, 8080, 8081,
    8123, 8181, 8384, 8443, 8888, 9000, 9090, 6888, 1194, 51820
}

-- Scan 127.0.0.1 for open ports (router-hosted services).
-- ports: optional array; defaults to common service ports.
-- Uses busybox nc (-z zero-I/O scan, -w1 1s timeout).
function scan(ports)
    ports = ports or DEFAULT_PORTS
    local res = {}
    for _, p in ipairs(ports) do
        local ok = os.execute("nc -z -w1 127.0.0.1 " .. p .. " >/dev/null 2>&1")
        if ok == 0 or ok == true then
            table.insert(res, { port = p, svc = SVC[p] or "" })
        end
    end
    return res
end
