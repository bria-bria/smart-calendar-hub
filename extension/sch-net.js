// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// IP addresses in the top bar: the local network address of the current
// connection (from NetworkManager) and, only when switched on, the public
// address (asked to api.ipify.org, the only network request made by the
// extension). Left, center or right of the top bar. Clicking opens a menu
// with every address switched on, each one can be copied; the settings choose
// which of them are also shown in the bar. PanelIpBox shows the chosen
// addresses in the side panel, under the tray, one at a time with arrows.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import NM from 'gi://NM';
import Soup from 'gi://Soup';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {_} from './sch-i18n.js';

Gio._promisify(NM.Client, 'new_async');
Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

export const IP_ROLE = 'smart-calendar-hub-ip';
const PUBLIC_IP_URL = 'https://api.ipify.org';
const PUBLIC_REFRESH_SECONDS = 30 * 60;

// Globe of the public address: shipped with the extension, since icon themes
// draw "web-browser" as a compass and have no common globe icon
const GLOBE_ICON = new Gio.FileIcon({
    file: Gio.File.new_for_uri(import.meta.url).get_parent()
        .get_child('icons').get_child('sch-globe-symbolic.svg'),
});

// One VPN: the shield, as in the top bar. Several VPNs: a different icon
// for each one (shield, key, padlock, …), so they are told apart at a glance.
const VPN_ICONS = ['network-vpn-symbolic', 'dialog-password-symbolic',
    'changes-prevent-symbolic', 'security-high-symbolic', 'channel-secure-symbolic'];

// Icon of the local network address: Wi-Fi, cable, other, offline
function lanIconName(kind, ip) {
    if (kind === 'wifi')
        return 'network-wireless-symbolic';
    if (kind === 'wired')
        return 'network-wired-symbolic';
    return ip ? 'network-workgroup-symbolic' : 'network-offline-symbolic';
}

const IpIndicator = GObject.registerClass(
class IpIndicator extends PanelMenu.Button {
    _init(owner) {
        super._init(0.5, _('IP addresses'));
        // [Wi-Fi or cable icon] local IP   [globe] public IP
        const box = new St.BoxLayout({style_class: 'panel-status-indicators-box sch-ip-box'});
        this._lanBox = new St.BoxLayout({style_class: 'sch-ip-part'});
        this._lanIcon = new St.Icon({icon_name: 'network-workgroup-symbolic', style_class: 'system-status-icon'});
        this._lanLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER, style_class: 'sch-ip-label'});
        this._lanBox.add_child(this._lanIcon);
        this._lanBox.add_child(this._lanLabel);
        this._pubBox = new St.BoxLayout({style_class: 'sch-ip-part'});
        this._pubBox.add_child(new St.Icon({gicon: GLOBE_ICON, style_class: 'system-status-icon'}));
        this._pubLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER, style_class: 'sch-ip-label'});
        this._pubBox.add_child(this._pubLabel);
        // [shield] VPN address, only while a VPN (e.g. Tailscale) is active
        this._vpnBox = new St.BoxLayout({style_class: 'sch-ip-part', visible: false});
        this._vpnBox.add_child(new St.Icon({icon_name: 'network-vpn-symbolic', style_class: 'system-status-icon'}));
        this._vpnLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER, style_class: 'sch-ip-label'});
        this._vpnBox.add_child(this._vpnLabel);
        // only when no address is shown in the bar: something to click on
        this._emptyIcon = new St.Icon({icon_name: 'network-workgroup-symbolic', style_class: 'system-status-icon', visible: false});
        box.add_child(this._emptyIcon);
        box.add_child(this._lanBox);
        box.add_child(this._vpnBox);
        box.add_child(this._pubBox);
        this.add_child(box);

        this._lanItem = new PopupMenu.PopupMenuItem('');
        this._lanItem.connect('activate', () => owner.copy(owner.lanIp));
        this.menu.addMenuItem(this._lanItem);
        this._vpnItem = new PopupMenu.PopupMenuItem('');
        this._vpnItem.connect('activate', () => owner.copy(owner.vpnIp));
        this.menu.addMenuItem(this._vpnItem);
        this._publicItem = new PopupMenu.PopupMenuItem('');
        this._publicItem.connect('activate', () => owner.copy(owner.publicIp));
        this.menu.addMenuItem(this._publicItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refresh = new PopupMenu.PopupMenuItem(_('Refresh'));
        refresh.connect('activate', () => owner.refresh(true));
        this.menu.addMenuItem(refresh);
    }

    // show: switched on (in the menu); bar: also in the top bar
    sync({lanIp, kind, publicIp, vpn, show, bar}) {
        this._vpnBox.visible = show.vpn && bar.vpn && !!vpn?.ip;
        this._vpnLabel.text = vpn?.ip ?? '';
        this._vpnItem.visible = show.vpn && !!vpn?.ip;
        this._vpnItem.label.text = vpn?.ip
            ? _('VPN ({name}): {ip}', {name: vpn.name, ip: vpn.ip})
            : '';
        this._lanBox.visible = show.lan && bar.lan;
        this._lanLabel.text = lanIp ?? _('offline');
        // the connection the traffic is going through right now
        this._lanIcon.icon_name = lanIconName(kind, lanIp);
        this._lanItem.visible = show.lan;
        this._lanItem.label.text = _('Local network: {ip}', {ip: lanIp ?? _('offline')});
        this._lanItem.reactive = !!lanIp;
        this._pubBox.visible = show.public && bar.public;
        this._pubLabel.text = publicIp ?? '…';
        this._publicItem.label.text = show.public
            ? _('Public: {ip}', {ip: publicIp ?? '…'})
            : _('Public: switched off in the settings');
        this._publicItem.reactive = show.public && !!publicIp;
        this._emptyIcon.visible = !this._lanBox.visible && !this._vpnBox.visible && !this._pubBox.visible;
        this._emptyIcon.icon_name = this._lanIcon.icon_name;
    }
});

export class IpView {
    constructor(settings) {
        this._settings = settings;
        this._cancellable = new Gio.Cancellable();
        this._signals = [];
        this._primarySignal = null;
        this._timerId = 0;
        this.lanIp = null;
        this.lanKind = null;
        this.publicIp = null;
        this.vpn = null;
        this.vpns = [];
        this._indicator = null;
        // called after every change of the addresses (PanelIpBox)
        this._listeners = new Set();

        // Visibility and position rebuild the indicator; the rest only the label
        this._settingsIds = [
            ...['show-ip', 'ip-position'].map(key =>
                settings.connect(`changed::${key}`, () => this._place())),
            ...['ip-show-lan', 'ip-show-public', 'ip-show-vpn',
                'ip-bar-lan', 'ip-bar-public', 'ip-bar-vpn',
                'panel-ip', 'panel-ip-lan', 'panel-ip-vpn', 'panel-ip-public'].map(key =>
                settings.connect(`changed::${key}`, () => {
                    this._sync();
                    this._schedulePublic();
                })),
        ];
        this._place();
        // the side panel may want the public address with the bar indicator off
        if (!this._timerId)
            this._schedulePublic();
        this._initNetwork().catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.error(`Smart Calendar Hub: network: ${e}`);
        });
    }

    addListener(callback) {
        this._listeners.add(callback);
        return callback;
    }

    removeListener(callback) {
        this._listeners.delete(callback);
    }

    // The public address is asked only if the bar or the side panel shows it
    _wantPublic() {
        const on = key => this._settings.get_boolean(key);
        return (on('show-ip') && on('ip-show-public')) ||
            (on('panel-ip') && on('panel-ip-public'));
    }

    destroy() {
        this._listeners.clear();
        this._cancellable.cancel();
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        this._disconnectNetwork();
        this._client = null;
        this._session?.abort();
        this._session = null;
        this._indicator?.destroy();
        this._indicator = null;
    }

    // (Re)creates the indicator in the chosen box, or removes it
    _place() {
        this._indicator?.destroy();
        this._indicator = null;
        if (!this._settings.get_boolean('show-ip'))
            return;
        const indicator = this._indicator = new IpIndicator(this);
        const pos = this._settings.get_string('ip-position');
        // left: after the other items; center and right: first
        const index = pos === 'left' ? Main.panel._leftBox.get_n_children() : 0;
        Main.panel.addToStatusArea(IP_ROLE, indicator, index, pos);
        indicator.connect('destroy', () => {
            if (Main.panel.statusArea[IP_ROLE] === indicator)
                delete Main.panel.statusArea[IP_ROLE];
        });
        this._sync();
        this._schedulePublic();
    }

    _sync() {
        const flags = prefix => Object.fromEntries(['lan', 'vpn', 'public'].map(
            k => [k, this._settings.get_boolean(`${prefix}-${k}`)]));
        this._indicator?.sync({
            lanIp: this.lanIp, kind: this.lanKind, publicIp: this.publicIp,
            vpn: this.vpn, show: flags('ip-show'), bar: flags('ip-bar'),
        });
        for (const callback of this._listeners) {
            try {
                callback();
            } catch (e) {
                console.error(`Smart Calendar Hub: IP addresses: ${e}`);
            }
        }
    }

    copy(text) {
        if (text)
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
    }

    // ---------------- local network (NetworkManager) ----------------

    async _initNetwork() {
        this._client = await NM.Client.new_async(this._cancellable);
        const watch = (obj, signal) =>
            this._signals.push([obj, obj.connect(signal, () => this.refresh(true))]);
        watch(this._client, 'notify::primary-connection');
        watch(this._client, 'notify::active-connections');
        watch(this._client, 'notify::state');
        this.refresh(true);
    }

    // The address may change without the primary connection changing
    _watchPrimary() {
        if (this._primarySignal) {
            const [obj, id] = this._primarySignal;
            obj.disconnect(id);
            this._primarySignal = null;
        }
        const primary = this._client?.get_primary_connection();
        if (primary)
            this._primarySignal = [primary, primary.connect('notify::ip4-config', () => this.refresh(false))];
    }

    _disconnectNetwork() {
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        if (this._primarySignal) {
            const [obj, id] = this._primarySignal;
            obj.disconnect(id);
            this._primarySignal = null;
        }
    }

    // The address in the local network and its kind ('wifi', 'wired',
    // 'other'), of the connection the traffic goes through now: the primary
    // connection (default route), unless it is a VPN; then the Wi-Fi or
    // cable connection holding the default route under it. IPv4 first,
    // else a global IPv6 address.
    _lanConnection() {
        // VPN tunnels and the loopback (127.0.0.1) are not the local network
        const isVpn = c => c.get_vpn?.() ||
            ['wireguard', 'tun', 'vpn', 'loopback'].includes(c.get_connection_type?.());
        const actives = (this._client?.get_active_connections() ?? []).filter(c => !isVpn(c));
        const primary = this._client?.get_primary_connection();
        const candidates = [
            ...(primary && !isVpn(primary) ? [primary] : []),
            ...actives.filter(c => c.get_default?.()),
            ...actives.filter(c => c.get_default6?.()),
            ...actives,
        ];
        const kindOf = c => {
            const type = c.get_connection_type?.();
            if (type === '802-11-wireless')
                return 'wifi';
            if (type === '802-3-ethernet')
                return 'wired';
            return 'other';
        };
        for (const conn of candidates) {
            const v4 = conn.get_ip4_config()?.get_addresses()?.[0]?.get_address();
            if (v4)
                return {ip: v4, kind: kindOf(conn)};
        }
        for (const conn of candidates) {
            const v6 = (conn.get_ip6_config()?.get_addresses() ?? [])
                .map(a => a.get_address())
                .find(a => a && !a.toLowerCase().startsWith('fe80'));
            if (v6)
                return {ip: v6, kind: kindOf(conn)};
        }
        return {ip: null, kind: null};
    }

    // The active VPNs (Tailscale, WireGuard, OpenVPN…) with an address
    _vpnConnections() {
        const isVpn = c => c.get_vpn?.() ||
            ['wireguard', 'tun', 'vpn'].includes(c.get_connection_type?.());
        const vpns = [];
        for (const conn of (this._client?.get_active_connections() ?? []).filter(isVpn)) {
            const ip = conn.get_ip4_config()?.get_addresses()?.[0]?.get_address() ??
                (conn.get_ip6_config()?.get_addresses() ?? []).map(a => a.get_address())
                    .find(a => a && !a.toLowerCase().startsWith('fe80'));
            if (ip)
                vpns.push({ip, name: conn.get_id?.() || 'VPN'});
        }
        return vpns;
    }

    // networkChanged: the public address may have changed too
    refresh(networkChanged) {
        if (networkChanged)
            this._watchPrimary();
        const lan = this._lanConnection();
        this.lanIp = lan.ip;
        this.lanKind = lan.kind;
        this.vpns = this._vpnConnections();
        this.vpn = this.vpns[0] ?? null;
        if (networkChanged)
            this.publicIp = null;
        this._sync();
        if (networkChanged)
            this._fetchPublic();
    }

    // ---------------- public address (only when switched on) ----------------

    _schedulePublic() {
        if (this._timerId) {
            if (!this.publicIp)
                this._fetchPublic(); // just switched on
            return;
        }
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, PUBLIC_REFRESH_SECONDS, () => {
            this._fetchPublic();
            return GLib.SOURCE_CONTINUE;
        });
        this._fetchPublic();
    }

    async _fetchPublic() {
        if (!this._wantPublic())
            return;
        if (!this.lanIp) {
            this.publicIp = null;
            this._sync();
            return;
        }
        // Only the latest request counts (quick network changes)
        const request = this._publicRequest = (this._publicRequest ?? 0) + 1;
        try {
            this._session ??= new Soup.Session({timeout: 10});
            const message = Soup.Message.new('GET', PUBLIC_IP_URL);
            const bytes = await this._session.send_and_read_async(message,
                GLib.PRIORITY_DEFAULT, this._cancellable);
            if (message.get_status() !== Soup.Status.OK)
                throw new Error(`HTTP ${message.get_status()}`);
            const text = new TextDecoder().decode(bytes.get_data()).trim();
            if (request !== this._publicRequest)
                return;
            // only an IPv4/IPv6 address is accepted and shown
            this.publicIp = /^[0-9a-fA-F:.]{3,45}$/.test(text) ? text : null;
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) || request !== this._publicRequest)
                return;
            this.publicIp = null;
            console.warn(`Smart Calendar Hub: public IP not available: ${e.message}`);
        }
        this._sync();
    }
}

// The chosen addresses in the side panel, under the tray: icon and address,
// one at a time; with two or more, up/down arrows go through them.
// Clicking the address copies it.
export class PanelIpBox {
    constructor(ipView, settings) {
        this._ipView = ipView;
        this._settings = settings;
        this._index = 0;
        this._key = null;

        // Same shape as the weather row: a box with icon and address, the
        // up/down arrows outside it on the right (only with two or more)
        this.actor = new St.BoxLayout({style_class: 'sch-weather-row', x_expand: true, visible: false});
        const card = new St.BoxLayout({style_class: 'sch-calendar-expander sch-ip-panel', x_expand: true});
        this._icon = new St.Icon({icon_size: 16, y_align: Clutter.ActorAlign.CENTER, style_class: 'sch-ip-panel-icon'});
        this._tag = new St.Label({style_class: 'sch-ip-panel-tag', y_align: Clutter.ActorAlign.CENTER, visible: false});
        this._address = new St.Button({
            style_class: 'sch-ip-panel-address',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
            label: '',
        });
        this._address.connect('clicked', () => {
            const item = this._items[this._index];
            if (item?.copy)
                this._ipView.copy(item.copy);
        });
        for (const child of [this._icon, this._tag, this._address])
            card.add_child(child);
        this._arrows = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-city-selector',
            y_align: Clutter.ActorAlign.CENTER,
        });
        for (const [icon, delta, name] of [['pan-up-symbolic', -1, _('Previous address')],
            ['pan-down-symbolic', 1, _('Next address')]]) {
            const btn = new St.Button({
                style_class: 'sch-city-arrow',
                can_focus: true,
                accessible_name: name,
                child: new St.Icon({icon_name: icon, icon_size: 12}),
            });
            btn.connect('clicked', () => this._move(delta));
            this._arrows.add_child(btn);
        }
        this.actor.add_child(card);
        this.actor.add_child(this._arrows);

        this._items = [];
        this._listener = ipView.addListener(() => this._update());
        this.actor.connect('destroy', () => {
            this._ipView?.removeListener(this._listener);
            this._ipView = null;
        });
        this._update();
    }

    destroy() {
        this.actor.destroy();
    }

    // [{key, icon | gicon, tag, text, copy}] of the chosen addresses
    _collect() {
        const on = key => this._settings.get_boolean(key);
        const ip = this._ipView;
        const items = [];
        if (on('panel-ip-lan')) {
            items.push({
                key: 'lan',
                icon: lanIconName(ip.lanKind, ip.lanIp),
                text: ip.lanIp ?? _('offline'),
                copy: ip.lanIp,
                name: _('Local network'),
            });
        }
        if (on('panel-ip-vpn')) {
            ip.vpns.forEach((vpn, i) => items.push({
                // name and address: two VPNs may have the same name
                key: `vpn:${vpn.name}:${vpn.ip}`,
                icon: VPN_ICONS[i % VPN_ICONS.length],
                tag: ip.vpns.length > 1 ? _('VPN {n}', {n: i + 1}) : _('VPN'),
                text: vpn.ip,
                copy: vpn.ip,
                name: vpn.name,
            }));
        }
        if (on('panel-ip-public')) {
            items.push({
                key: 'public',
                gicon: GLOBE_ICON,
                text: ip.publicIp ?? '…',
                copy: ip.publicIp,
                name: _('Public address'),
            });
        }
        return items;
    }

    _move(delta) {
        const n = this._items.length;
        if (n < 2)
            return;
        this._index = (this._index + delta + n) % n;
        this._key = this._items[this._index].key;
        this._show();
    }

    _update() {
        if (!this._ipView)
            return;
        this._items = this._collect();
        // stay on the same address when the list changes (a VPN comes or goes)
        const kept = this._items.findIndex(item => item.key === this._key);
        this._index = kept >= 0 ? kept : Math.min(this._index, Math.max(0, this._items.length - 1));
        this._key = this._items[this._index]?.key ?? null;
        this._show();
    }

    _show() {
        const items = this._items;
        this.actor.visible = this._settings.get_boolean('panel-ip') && items.length > 0;
        if (!this.actor.visible)
            return;
        const item = items[this._index];
        if (item.gicon)
            this._icon.gicon = item.gicon;
        else
            this._icon.icon_name = item.icon;
        this._tag.text = item.tag ?? '';
        this._tag.visible = !!item.tag;
        this._address.label = item.text;
        this._address.accessible_name = _('{name}: {ip} (click to copy)', {name: item.name, ip: item.text});
        this._arrows.visible = items.length > 1;
    }
}
