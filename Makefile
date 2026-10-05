#
# Copyright (C) 2026 cocolight
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_VERSION:=2.0.0
PKG_RELEASE:=11

# luci.mk derives PKG_PO_VERSION from git and, without a git checkout, from the
# newest file mtime in the package directory. That changes on every rebuild and
# leaves stale luci-i18n-* artefacts behind, so pin it to the package version.
PKG_PO_VERSION:=$(PKG_VERSION)

PKG_MAINTAINER:=cocolight
PKG_LICENSE:=GPL-2.0-only
PKG_LICENSE_FILES:=LICENSE

LUCI_TITLE:=Portal - static HTML dashboard on a dedicated port
LUCI_DESCRIPTION:=Serves a static HTML navigation portal on a configurable \
	port using its own uhttpd instance. Bookmarks, icons and the background \
	are managed through LuCI and persisted in uci.
LUCI_DEPENDS:=+luci-base +uhttpd +ucode +ucode-mod-fs +ucode-mod-uci +rpcd-mod-ucode
LUCI_PKGARCH:=all
LUCI_URL:=https://github.com/wrttools/luci-app-portal

# package.mk looks up PKG_LICENSE_FILES inside PKG_BUILD_DIR, while luci.mk
# only stages luasrc/ucode/htdocs/root/src there - copy the license ourselves.
# luci.mk copies ./root into $(PKG_BUILD_DIR) right before this hook runs and
# installs it with `cp -pR`, i.e. with whatever mode the file has in the
# working tree. The init script has to be executable, and a checkout that lost
# the bit (Windows tooling, a copy, core.filemode=false hiding the change)
# would otherwise ship a package whose service can never start.
define Build/Prepare/luci-app-portal
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(CP) ./LICENSE $(PKG_BUILD_DIR)/LICENSE
	chmod 0755 $(PKG_BUILD_DIR)/root/etc/init.d/portal
endef

define Package/luci-app-portal/conffiles
/etc/config/portal
endef

define Package/luci-app-portal/postinst
#!/bin/sh
# $${IPKG_INSTROOT} is set by opkg, $${PKG_INSTROOT} by apk-tools.
[ -z "$${IPKG_INSTROOT}$${PKG_INSTROOT}" ] || exit 0

mkdir -p /etc/portal/www/icons /etc/portal/www/bg
[ -f /etc/portal/www/index.html ] || cp -r /usr/share/portal/www/. /etc/portal/www/ 2>/dev/null

# Let rpcd pick up the new ucode plugin, then bake the initial links.json.
# If the reload did not rescan the plugin directory the ubus object stays
# missing and every luci.portal call fails with "Object not found", so fall back
# to a full restart before generating.
/etc/init.d/rpcd reload 2>/dev/null
ubus list 2>/dev/null | grep -q '^luci\.portal$$' || /etc/init.d/rpcd restart 2>/dev/null
sleep 1

# Reported instead of discarded: a silent failure here leaves the portal
# with no bookmarks on it and nothing in the log to explain why.
out=$$(ubus call luci.portal generate 2>&1); \
printf '%s' "$$out" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' \
	|| { echo "luci-app-portal: links.json not generated: $$out" >&2; \
	     logger -t portal "links.json not generated during install: $$out"; }

# root/ is copied verbatim by the build system, so the init script carries
# whatever mode the working tree had. A non-executable script fails both calls
# below and the portal never comes up, so force the mode here as well - that
# also repairs devices updated from a package built with a 0644 script.
chmod 0755 /etc/init.d/portal 2>/dev/null

if ! /etc/init.d/portal enable; then \
	echo "luci-app-portal: failed to enable the portal service" >&2; \
	logger -t portal "failed to enable the portal service"; \
fi
if ! /etc/init.d/portal start; then \
	echo "luci-app-portal: failed to start the portal service" >&2; \
	logger -t portal "failed to start the portal service"; \
fi

rm -f /tmp/luci-indexcache.*
rm -rf /tmp/luci-modulecache/

exit 0
endef

define Package/luci-app-portal/prerm
#!/bin/sh
[ -z "$${IPKG_INSTROOT}$${PKG_INSTROOT}" ] || exit 0

# Same guard as in postinst: a package built before the mode was fixed ships a
# 0644 init script. Here the consequence is worse than at install time - the
# procd instance is declared with `respawn`, so a stop that never runs leaves
# uhttpd holding the port and restarting into a /etc/portal that the line below
# is about to delete.
chmod 0755 /etc/init.d/portal 2>/dev/null

if ! /etc/init.d/portal stop; then \
	echo "luci-app-portal: failed to stop the portal service" >&2; \
	logger -t portal "failed to stop the portal service"; \
fi
if ! /etc/init.d/portal disable; then \
	echo "luci-app-portal: failed to disable the portal service" >&2; \
	logger -t portal "failed to disable the portal service"; \
fi

rm -rf /etc/portal

# /etc/config/portal is a conffile and its removal is left to the package
# manager, so that a modified configuration survives a reinstall.

exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
