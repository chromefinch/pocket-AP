include $(TOPDIR)/rules.mk

PKG_NAME:=pocket-ap
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

PKG_MAINTAINER:=Pocket-AP Contributors
PKG_LICENSE:=GPL-3.0-or-later
PKG_ARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/pocket-ap
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=1. Collections
  TITLE:=Pocket-AP travel router web interface for OpenWrt
  DEPENDS:=+uhttpd +uhttpd-mod-ubus +rpcd +rpcd-mod-ucode +rpcd-mod-iwinfo +rpcd-mod-luci +luci-base
  PKGARCH:=all
endef

define Package/pocket-ap/description
  RaspAP-inspired travel router web interface for OpenWrt. Runs alongside LuCI
  at /pocket-ap/ using native ubus/rpcd APIs for truthful live router state.
endef

define Build/Compile
endef

define Package/pocket-ap/install
	$(INSTALL_DIR) $(1)/www/pocket-ap
	$(CP) ../www/pocket-ap/* $(1)/www/pocket-ap/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/usr/share/rpcd/acl.d/pocket-ap.json $(1)/usr/share/rpcd/acl.d/pocket-ap.json
	$(INSTALL_DIR) $(1)/usr/share/rpcd/ucode
	$(INSTALL_DATA) ./files/usr/share/rpcd/ucode/pocket-ap $(1)/usr/share/rpcd/ucode/pocket-ap
	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./files/usr/libexec/pocket-ap-portal $(1)/usr/libexec/pocket-ap-portal
	$(INSTALL_BIN) ./files/usr/libexec/pocket-ap-switch $(1)/usr/libexec/pocket-ap-switch
	$(INSTALL_DIR) $(1)/etc/rc.button
	$(INSTALL_BIN) ./files/etc/rc.button/BTN_0 $(1)/etc/rc.button/BTN_0
	$(INSTALL_DIR) $(1)/etc/hotplug.d/iface
	$(INSTALL_BIN) ./files/etc/hotplug.d/iface/95-pocket-ap-portal $(1)/etc/hotplug.d/iface/95-pocket-ap-portal
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/etc/uci-defaults/90-pocket-ap $(1)/etc/uci-defaults/90-pocket-ap
endef

$(eval $(call BuildPackage,pocket-ap))
