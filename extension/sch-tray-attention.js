// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Tray icons that ask for attention, as notifications (option of the Smart
// notifications). An app in the tray (through the "AppIndicator and
// KStatusNotifierItem Support" extension) can set its icon to "needs
// attention": when that happens a notification with its name and icon
// appears, and a click on it opens the icon's menu. Only read: the other
// extension and its icons are not changed.

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {_} from './sch-i18n.js';

// New tray icons are picked up with a light look every few seconds: the
// AppIndicator extension adds them to the top bar when their app starts
const SCAN_INTERVAL_S = 3;
const NEEDS_ATTENTION = 'NeedsAttention';

export class TrayAttention {
    constructor() {
        // indicator → {sni, signalId, attention, source}
        this._watched = new Map();
        this._scan();
        this._scanId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, SCAN_INTERVAL_S, () => {
            this._scan();
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        GLib.source_remove(this._scanId);
        this._scanId = 0;
        for (const indicator of [...this._watched.keys()])
            this._forget(indicator);
    }

    _scan() {
        const present = new Set();
        for (const indicator of Object.values(Main.panel.statusArea)) {
            const sni = indicator?._indicator;
            if (typeof sni?.connect !== 'function' || !('status' in sni))
                continue;
            present.add(indicator);
            if (this._watched.get(indicator)?.sni === sni)
                continue;
            this._forget(indicator);
            const info = {sni, attention: sni.status === NEEDS_ATTENTION, source: null};
            info.signalId = sni.connect('status', () => this._onStatus(indicator, info));
            this._watched.set(indicator, info);
        }
        for (const indicator of [...this._watched.keys()]) {
            if (!present.has(indicator))
                this._forget(indicator);
        }
    }

    _forget(indicator) {
        const info = this._watched.get(indicator);
        if (!info)
            return;
        info.sni.disconnect(info.signalId);
        info.source?.destroy();
        this._watched.delete(indicator);
    }

    // Only the change to "needs attention" makes a notification, once
    _onStatus(indicator, info) {
        const attention = info.sni.status === NEEDS_ATTENTION;
        if (attention && !info.attention)
            this._notify(indicator, info);
        info.attention = attention;
    }

    _notify(indicator, info) {
        const sni = info.sni;
        const name = sni.title || sni.accessibleName || sni.id || _('Tray icon');
        const gicon = indicator._icon?.gicon ?? null;
        if (!info.source) {
            info.source = new MessageTray.Source({title: name, icon: gicon});
            info.source.connect('destroy', () => {
                info.source = null;
            });
            Main.messageTray.add(info.source);
        }
        const notification = new MessageTray.Notification({
            source: info.source,
            title: name,
            body: _('Needs your attention'),
            gicon,
        });
        notification.connect('activated', () => indicator.menu?.open?.(true));
        info.source.addNotification(notification);
    }
}
