// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Notification banners away from the mouse. GNOME shows a banner (at the top
// centre, or where an extension moved it) even when the pointer is right
// there, so a click meant for a window opens the notification instead.
// While the pointer is inside the area where the banner would appear (larger by the
// percentage of the setting banners-away-margin), the notification waits in
// GNOME's own queue (same order, nothing lost) and shows up as soon as the
// pointer leaves. Critical notifications are never held back.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Urgency} from 'resource:///org/gnome/shell/ui/messageTray.js';

import {logWarning} from './sch-log.js';

const CHECK_INTERVAL_MS = 200;
const WATCH_INTERVAL_MS = 100;

// Where an aligned box sits in the free space: 0 start, 0.5 centre, 1 end
function alignShift(align) {
    if (align === Clutter.ActorAlign.START)
        return 0;
    return align === Clutter.ActorAlign.END ? 1 : 0.5;
}

export class BannerGuard {
    constructor(settings) {
        this._settings = settings;
        const tray = Main.messageTray;
        const original = tray._showNotification;
        this._checkId = 0;
        this._watchId = 0;
        this._size = null;
        // GNOME calls _showNotification() from _updateState() when the queue
        // has a notification to show. An own property on the tray: deleting it
        // brings back GNOME's method.
        this._wrapper = tray._showNotification = () => {
            if (this._mustWait()) {
                this._waitForPointer();
                return;
            }
            original.call(tray);
            this._watchBanner();
        };
    }

    destroy() {
        if (this._checkId) {
            GLib.source_remove(this._checkId);
            this._checkId = 0;
        }
        if (this._watchId) {
            GLib.source_remove(this._watchId);
            this._watchId = 0;
        }
        const tray = Main.messageTray;
        tray._bannerBin.show();
        if (tray._showNotification === this._wrapper)
            delete tray._showNotification;
        else
            logWarning('_showNotification patched by someone else, left as is');
        this._wrapper = null;
        // a notification that was waiting shows up now
        tray._updateState();
    }

    _mustWait() {
        const next = Main.messageTray._notificationQueue[0];
        return next?.urgency !== Urgency.CRITICAL && this._pointerInBannerArea();
    }

    // One check every 200 ms, only while a notification is waiting
    _waitForPointer() {
        if (this._checkId)
            return;
        this._checkId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CHECK_INTERVAL_MS, () => {
            const tray = Main.messageTray;
            if (tray.queueCount > 0 && this._pointerInBannerArea())
                return GLib.SOURCE_CONTINUE;
            this._checkId = 0;
            tray._updateState();
            return GLib.SOURCE_REMOVE;
        });
    }

    // While a banner is on screen: its real size, once GNOME has placed it,
    // and, if asked (banners-hide-near-mouse), out of the way while the
    // pointer is near it. Only hidden, not dismissed: GNOME's timer goes on,
    // it comes back when the pointer leaves, and it stays in the panel's list.
    _watchBanner() {
        if (this._watchId)
            return;
        this._watchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WATCH_INTERVAL_MS, () => {
            const tray = Main.messageTray;
            const banner = tray._banner;
            if (!banner) {
                tray._bannerBin.show();
                this._watchId = 0;
                return GLib.SOURCE_REMOVE;
            }
            // critical banners open already expanded: not a usual size
            if (banner.mapped && !banner.expanded && banner.width > 0)
                this._size = [banner.width, banner.height];
            const hide = this._settings.get_boolean('banners-hide-near-mouse') &&
                !banner.expanded && tray._notification?.urgency !== Urgency.CRITICAL &&
                this._pointerInBannerArea();
            tray._bannerBin.visible = !hide;
            return GLib.SOURCE_CONTINUE;
        });
    }

    _pointerInBannerArea() {
        const bin = Main.messageTray._bannerBin;
        const [width, height] = this._bannerSize();
        // GNOME puts the banner container in the primary monitor's work area
        // and places it with its own alignments: top centre by default, or
        // wherever an extension that moves notifications has set them
        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        let xShift = alignShift(bin.x_align);
        if (bin.get_text_direction() === Clutter.TextDirection.RTL)
            xShift = 1 - xShift;
        // the setting, read at each check: a change applies at once
        const margin = this._settings.get_int('banners-away-margin') / 100;
        const x = area.x + (area.width - width) * xShift - width * margin / 2;
        const y = area.y + (area.height - height) * alignShift(bin.y_align) - height * margin / 2;
        const [px, py] = global.get_pointer();
        return px >= x && px < x + width * (1 + margin) &&
            py >= y && py < y + height * (1 + margin);
    }

    // Size of the last banner GNOME showed; before the first one, the size
    // its stylesheet gives to a banner (.notification-banner: 34em wide,
    // at least 64 px high)
    _bannerSize() {
        if (!this._size) {
            const probe = new St.Widget({style_class: 'notification-banner'});
            Main.messageTray._bannerBin.add_child(probe);
            this._size = [probe.width, probe.height];
            probe.destroy();
        }
        return this._size;
    }
}
