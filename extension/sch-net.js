// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// IP addresses in the top bar: the local network address of the current
// connection (from NetworkManager) and, only when switched on, the public
// address (asked to api.ipify.org, the only network request made by the
// extension). Left, center or right of the top bar. Clicking opens a menu
// where each address can be copied.

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
        this._pubBox.add_child(new St.Icon({icon_name: 'web-browser-symbolic', style_class: 'system-status-icon'}));
        this._pubLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER, style_class: 'sch-ip-label'});
        this._pubBox.add_child(this._pubLabel);
        // [shield] VPN address, only while a VPN (e.g. Tailscale) is active
        this._vpnBox = new St.BoxLayout({style_class: 'sch-ip-part', visible: false});
        this._vpnBox.add_child(new St.Icon({icon_name: 'network-vpn-symbolic', style_class: 'system-status-icon'}));
        this._vpnLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER, style_class: 'sch-ip-label'});
        this._vpnBox.add_child(this._vpnLabel);
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

    sync(lanIp, publicIp, showLan, showPublic, kind, vpn, showVpn) {
        this._vpnBox.visible = showVpn && !!vpn?.ip;
        this._vpnLabel.text = vpn?.ip ?? '';
        this._vpnItem.visible = !!vpn?.ip;
        this._vpnItem.label.text = vpn?.ip
            ? _('VPN ({name}): {ip}', {name: vpn.name, ip: vpn.ip})
            : '';
        this._lanBox.visible = showLan;
        this._lanLabel.text = lanIp ?? _('offline');
        // the connection the traffic is going through right now
        this._lanIcon.icon_name = kind === 'wifi' ? 'network-wireless-symbolic'
            : kind === 'wired' ? 'network-wired-symbolic'
                : lanIp ? 'network-workgroup-symbolic' : 'network-offline-symbolic';
        this._pubBox.visible = showPublic;
        this._pubLabel.text = publicIp ?? '…';
        this._lanItem.label.text = _('Local network: {ip}', {ip: lanIp ?? _('offline')});
        this._publicItem.label.text = showPublic
            ? _('Public: {ip}', {ip: publicIp ?? '…'})
            : _('Public: switched off in the settings');
        this._publicItem.reactive = showPublic && !!publicIp;
        this._lanItem.reactive = !!lanIp;
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
        this.publicIp = null;
        this._indicator = null;

        // Visibility and position rebuild the indicator; the rest only the label
        this._settingsIds = [
            ...['show-ip', 'ip-position'].map(key =>
                settings.connect(`changed::${key}`, () => this._place())),
            ...['ip-show-lan', 'ip-show-public', 'ip-show-vpn'].map(key =>
                settings.connect(`changed::${key}`, () => {
                    this._sync();
                    this._schedulePublic();
                })),
        ];
        this._place();
        this._initNetwork().catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.error(`Smart Calendar Hub: network: ${e}`);
        });
    }

    destroy() {
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
        this._indicator?.sync(this.lanIp, this.publicIp,
            this._settings.get_boolean('ip-show-lan'),
            this._settings.get_boolean('ip-show-public'),
            this.lanKind, this.vpn,
            this._settings.get_boolean('ip-show-vpn'));
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

    // The first active VPN (Tailscale, WireGuard, OpenVPN…) with an address
    _vpnConnection() {
        const isVpn = c => c.get_vpn?.() ||
            ['wireguard', 'tun', 'vpn'].includes(c.get_connection_type?.());
        for (const conn of (this._client?.get_active_connections() ?? []).filter(isVpn)) {
            const ip = conn.get_ip4_config()?.get_addresses()?.[0]?.get_address() ??
                (conn.get_ip6_config()?.get_addresses() ?? []).map(a => a.get_address())
                    .find(a => a && !a.toLowerCase().startsWith('fe80'));
            if (ip)
                return {ip, name: conn.get_id?.() || 'VPN'};
        }
        return null;
    }

    // networkChanged: the public address may have changed too
    refresh(networkChanged) {
        if (networkChanged)
            this._watchPrimary();
        const lan = this._lanConnection();
        this.lanIp = lan.ip;
        this.lanKind = lan.kind;
        this.vpn = this._vpnConnection();
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
        if (!this._settings.get_boolean('show-ip') || !this._settings.get_boolean('ip-show-public'))
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
