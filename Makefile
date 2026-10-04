include $(TOPDIR)/rules.mk
include $(INCLUDE_DIR)/package.mk

PKG_NAME:=luci-app-portal
PKG_VERSION:=1.0
PKG_RELEASE:=1
PKG_ARCH:=all

define Package/luci-app-portal
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=Pure HTML navigation portal (custom port)
  PKGARCH:=all
  DEPENDS:=+uhttpd
endef

define Package/luci-app-portal/description
  Static HTML portal/dashboard served on a user-configurable port by its own
  uhttpd instance. Bookmarks, icons and background persist via uci.
endef

define Package/luci-app-portal/conffiles
/etc/config/portal
endef

define Package/luci-app-portal/install
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller
	$(CP) ./luasrc/controller/portal.lua $(1)/usr/lib/lua/luci/controller/portal.lua
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci
	$(CP) ./luasrc/portal.lua $(1)/usr/lib/lua/luci/portal.lua
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/model/cbi/portal
	$(CP) ./luasrc/model/cbi/portal/settings.lua $(1)/usr/lib/lua/luci/model/cbi/portal/settings.lua
	$(INSTALL_DIR) $(1)/usr/share/portal/www
	$(CP) ./root/usr/share/portal/www/* $(1)/usr/share/portal/www/
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./root/etc/init.d/portal $(1)/etc/init.d/portal
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./root/etc/config/portal $(1)/etc/config/portal
endef

define Package/luci-app-portal/postinst
#!/bin/sh
[ -z "$$IPKG_INSTROOT" ] || exit 0
mkdir -p /etc/portal/www/icons /etc/portal/www/bg
[ -f /etc/portal/www/index.html ] || cp -r /usr/share/portal/www/. /etc/portal/www/
lua -e "require('luci.portal').generate()"
/etc/init.d/portal enable 2>/dev/null
/etc/init.d/portal start 2>/dev/null
exit 0
endef

define Package/luci-app-portal/prerm
#!/bin/sh
[ -z "$$IPKG_INSTROOT" ] || exit 0
/etc/init.d/portal stop 2>/dev/null
/etc/init.d/portal disable 2>/dev/null
rm -rf /etc/portal
rm -f /etc/config/portal
exit 0
endef

$(eval $(call BuildPackage,luci-app-portal))
