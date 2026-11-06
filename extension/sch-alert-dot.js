// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// A red dot next to the clock while one of the chosen apps has unread
// notifications or its tray icon asks for attention; with the pointer on the
// clock, a label under it names those apps. Silenced apps never light it.
// The apps seen are listed in notify-apps-seen for the settings.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {_} from './sch-i18n.js';
import {Connections} from './sch-signals.js';
import {oneLine, setStrvIfChanged} from './sch-settings-model.js';
import {sourceKey} from './sch-notifications.js';

// An icon counts as "normal" for an app only after being shown this long
const NORMAL_ICON_MIN_SECONDS = 600;

export class AlertDot {
    constructor(dateMenu, settings, notifications) {
        this._dateMenu = dateMenu;
        this._settings = settings;
        this._notifications = notifications;
        this._sources = new Set();
        this._tray = new Map();
        this._iconStats = null;
        this._iconShown = null;
        this._iconSaveId = 0;
        this._dotOn = false;
        this._signals = new Connections();
        const clock = dateMenu._clockDisplay;
        const clockBox = clock?.get_parent();
        if (!clockBox)
            return;

        // Always in place (transparent when off): showing and hiding it
        // would move the clock and the widgets next to it.
        this._dot = new St.Widget({
            style_class: 'sch-alert-dot',
            y_align: Clutter.ActorAlign.CENTER,
            opacity: 0,
        });
        // on the left of the time
        clockBox.insert_child_below(this._dot, clock);
        // Another extension may destroy the box we live in (see the weather badge).
        this._dot.connect('destroy', () => {
            this._dot = null;
        });

        this._signals.connect(Main.messageTray,
            'source-added', (_t, source) => this._watchSource(source),
            'source-removed', (_t, source) => {
                source.disconnectObject(this);
                this._sources.delete(source);
                this.update();
            });
        for (const source of Main.messageTray.getSources())
            this._watchSource(source);
        this._signals.connect(settings,
            'changed::muted-apps', () => this.update(),
            'changed::alert-apps', () => this.update());
        this._buildTip();
        this.syncTray();
    }

    destroy() {
        this._signals.disconnectAll();
        for (const source of this._sources)
            source.disconnectObject(this);
        this._sources.clear();
        // a destroyed icon has already left the map (its 'destroy' handler)
        for (const [sni, ids] of this._tray) {
            this._accountTrayIcon(sni); // last stretch of time of its icon
            ids.forEach(id => sni.disconnect(id));
        }
        this._tray.clear();
        if (this._iconSaveId)
            GLib.source_remove(this._iconSaveId);
        this._iconSaveId = 0;
        this._saveIconStats();
        this._dot?.destroy();
        this._dot = null;
        this._tip?.destroy();
        this._tip = null;
    }

    // The names written in the list of the settings, in the language loaded now
    retranslate() {
        for (const sni of this._tray.keys())
            this._rememberTrayApp(sni);
    }

    _watchSource(source) {
        if (this._sources.has(source))
            return;
        this._sources.add(source);
        source.connectObject('notify::count', () => {
            this._rememberSource(source);
            this.update();
        }, this);
        this._rememberSource(source);
        this.update();
    }

    // Adds the app to the list shown in our settings (kept across sessions).
    _rememberSource(source) {
        const key = sourceKey(source);
        if (key)
            this._rememberApp(key, source.title || key);
    }

    _rememberApp(key, rawLabel) {
        const label = oneLine(rawLabel);
        const line = `${key}\t${label}`;
        const seen = this._settings.get_strv('notify-apps-seen');
        if (seen.includes(line))
            return;
        const list = seen.filter(l => !l.startsWith(`${key}\t`));
        list.push(line);
        list.sort();
        // Keep at most 150 entries, but never drop an app switched on for the dot.
        const chosen = new Set(this._settings.get_strv('alert-apps'));
        let extra = list.length - 150;
        const kept = list.filter(l => {
            if (extra > 0 && !chosen.has(l.slice(0, l.indexOf('\t')))) {
                extra--;
                return false;
            }
            return true;
        });
        this._settings.set_strv('notify-apps-seen', kept);
    }

    // Names of the chosen apps that are alerting right now (no duplicates).
    _alertingApps() {
        const wanted = new Set(this._settings.get_strv('alert-apps'));
        const names = new Set();
        for (const s of this._sources) {
            const key = sourceKey(s);
            // silenced apps: no banner and no red dot, only the panel list
            if (s.count > 0 && wanted.has(key) && !this._notifications.isMuted(key))
                names.add(s.title || key);
        }
        for (const sni of this._tray.keys()) {
            if (wanted.has(`tray:${sni.id}`) && this._trayAlerting(sni))
                names.add(sni.title || sni.id);
        }
        return [...names];
    }

    update() {
        if (!this._dot)
            return;
        const apps = this._alertingApps();
        this._dotOn = apps.length > 0;
        this._dot.opacity = this._dotOn ? 255 : 0;
        if (this._tip?.visible)
            this._showTip();
    }

    // Label under the clock, while the pointer is on it and the dot is on,
    // telling which apps the dot is about.
    _buildTip() {
        // Not reactive, on top of everything (raised again when shown)
        this._tip = new St.Label({style_class: 'sch-alert-tip', visible: false, reactive: false});
        Main.uiGroup.add_child(this._tip);
        this._signals.connect(this._dateMenu, 'notify::hover', () => {
            if (this._dateMenu.hover && this._dotOn && !this._dateMenu.menu.isOpen)
                this._showTip();
            else
                this._tip.hide();
        });
        this._signals.connect(this._dateMenu.menu, 'open-state-changed', () => this._tip.hide());
    }

    _showTip() {
        const apps = this._alertingApps();
        if (!apps.length) {
            this._tip.hide();
            return;
        }
        this._tip.text = _('Notifications from: {apps}', {apps: apps.join(', ')});
        Main.uiGroup.set_child_above_sibling(this._tip, null);
        this._tip.show();
        // Under the clock, kept inside its monitor
        const button = this._dateMenu;
        const [bx, by] = button.get_transformed_position();
        const [bw, bh] = button.get_transformed_size();
        const monitor = Main.layoutManager.findMonitorForActor(button) ?? Main.layoutManager.primaryMonitor;
        const [, natWidth] = this._tip.get_preferred_width(-1);
        const x = Math.min(Math.max(bx + (bw - natWidth) / 2, monitor.x + 4),
            monitor.x + monitor.width - natWidth - 4);
        this._tip.set_position(Math.floor(x), Math.floor(by + bh + 6));
    }

    // Tray icons (AppIndicator) can also ask for attention: either with the
    // NeedsAttention status, or, like Telegram, by switching to an icon whose
    // name says so. Apps that only draw a badge inside the image cannot be read.
    _trayAlerting(sni) {
        return sni.status === 'NeedsAttention' ||
            /attention|unread|updates-available/i.test(sni.icon?.name ?? '') ||
            this._trayIconChanged(sni);
    }

    // Name + checksum of the image (and of the overlay, used by some apps)
    _iconFingerprint(sni) {
        const parts = [];
        for (const icon of [sni.icon, sni.hasOverlayIcon ? sni.overlayIcon : null]) {
            if (!icon)
                continue;
            parts.push(icon.name ?? '');
            // pixmap: a GVariant array of images, when the app sends pixels
            if (icon.pixmap?.n_children() > 0) {
                parts.push(GLib.compute_checksum_for_bytes(GLib.ChecksumType.MD5,
                    icon.pixmap.get_data_as_bytes()));
            }
        }
        return parts.join('|') || null;
    }

    _loadIconStats() {
        this._iconStats = new Map(); // app id -> Map(fingerprint -> seconds)
        this._iconShown = new Map(); // sni -> {fp, since}
        for (const line of this._settings.get_strv('tray-icon-stats')) {
            const [id, fp, secs] = line.split('\t');
            if (!id || !fp)
                continue;
            if (!this._iconStats.has(id))
                this._iconStats.set(id, new Map());
            this._iconStats.get(id).set(fp, Number(secs) || 0);
        }
    }

    // Animated icons (e.g. a sync spinner) change many times a second:
    // write the setting at most once a minute (and on disable).
    _queueSaveIconStats() {
        if (this._iconSaveId)
            return;
        this._iconSaveId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60, () => {
            this._iconSaveId = 0;
            this._saveIconStats();
            return GLib.SOURCE_REMOVE;
        });
    }

    _saveIconStats() {
        if (!this._iconStats)
            return;
        const lines = [];
        for (const [id, fps] of this._iconStats) {
            // the three icons seen longest are enough
            [...fps].sort((a, b) => b[1] - a[1]).slice(0, 3)
                .forEach(([fp, secs]) => lines.push(`${id}\t${fp}\t${Math.round(secs)}`));
        }
        setStrvIfChanged(this._settings, 'tray-icon-stats', lines);
    }

    // Adds the time the current icon has been shown, then restarts the count
    _accountTrayIcon(sni) {
        const shown = this._iconShown?.get(sni);
        const now = Date.now() / 1000;
        if (shown?.fp) {
            if (!this._iconStats.has(sni.id))
                this._iconStats.set(sni.id, new Map());
            const fps = this._iconStats.get(sni.id);
            fps.set(shown.fp, (fps.get(shown.fp) ?? 0) + Math.max(0, now - shown.since));
        }
        this._iconShown?.set(sni, {fp: this._iconFingerprint(sni), since: now});
    }

    _trayIconChanged(sni) {
        const shown = this._iconShown?.get(sni);
        const fps = this._iconStats?.get(sni.id);
        if (!shown?.fp || !fps)
            return false;
        const running = Date.now() / 1000 - shown.since;
        let normal = null;
        let best = 0;
        for (const [fp, secs] of fps) {
            const total = secs + (fp === shown.fp ? running : 0);
            if (total > best) {
                best = total;
                normal = fp;
            }
        }
        return best >= NORMAL_ICON_MIN_SECONDS && normal !== shown.fp;
    }

    // Follows every AppIndicator icon (wherever it is) for the red dot.
    syncTray() {
        for (const indicator of Object.values(Main.panel.statusArea)) {
            const sni = indicator?._indicator;
            if (!sni?.id || this._tray.has(sni) || typeof sni.connect !== 'function')
                continue;
            const update = () => this.update();
            if (!this._iconStats)
                this._loadIconStats();
            this._iconShown.set(sni, {fp: this._iconFingerprint(sni), since: Date.now() / 1000});
            const ids = [
                sni.connect('icon', () => {
                    this._accountTrayIcon(sni);
                    this._queueSaveIconStats();
                    this.update();
                }),
                sni.connect('status', update),
                sni.connect('destroy', () => {
                    this._accountTrayIcon(sni);
                    this._iconShown?.delete(sni);
                    this._queueSaveIconStats();
                    this._tray.delete(sni);
                    this.update();
                }),
            ];
            this._tray.set(sni, ids);
            this._rememberTrayApp(sni);
        }
        this.update();
    }

    _rememberTrayApp(sni) {
        this._rememberApp(`tray:${sni.id}`, _('{app} (tray icon)', {app: sni.title || sni.id}));
    }
}
