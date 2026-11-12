// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Smart notifications. GNOME's own notification banners, redrawn compact and
// placed in a zone attached to the top right corner of the work area: right
// under the top bar and against the screen edge, so it follows any dock or
// panel that takes that edge (GNOME keeps the banner container inside the
// work area). The zone is two banners wide and three banners high.
//  - While the pointer is in the zone, a new banner waits in GNOME's queue
//    (same order, nothing lost) and comes in as soon as the pointer leaves.
//    Critical notifications never wait.
//  - Once on screen GNOME keeps it while the pointer is on it and opens it
//    (full text and action buttons) only when the pointer is on that banner.
//  - The icon of the notification goes on the right; it comes in from the top
//    (GNOME's own movement) or from the side (setting smart-notifications-entry).
//  - Options: all texts in the accent colour, flat icons in the accent colour.
//  - The notifications in the panel's list are drawn the same way (drawSmart),
//    with the flat icons option but not the accent texts.
// Everything is undone when switched off: GNOME's methods come back as they were.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Urgency} from 'resource:///org/gnome/shell/ui/messageTray.js';

import {logWarning} from './sch-log.js';

const CHECK_INTERVAL_MS = 200;
const SIDE_TIME_MS = 350;
const ZONE_BANNERS_WIDE = 2;
const ZONE_BANNERS_HIGH = 3;
// a closed banner is about four times as wide as it is high
const FALLBACK_RATIO = 4;

// [setting, style class, also on the panel's list]
const STYLE_OPTIONS = [
    ['smart-notifications-accent-text', 'sch-smart-accent-text', false],
    ['smart-notifications-flat-icons', 'sch-smart-flat-icons', true],
];

// A notification drawn the smart way (banner or row of the panel's list):
// the icon on the right of the text and the compact style; off: back as
// GNOME draws it. When the notification has no icon of its own, the icon of
// its app or source.
export function drawSmart(message, on) {
    const icon = message?._icon;
    const row = icon?.get_parent();
    if (!row)
        return;
    if (on) {
        message.add_style_class_name('sch-smart-message');
        row.set_child_above_sibling(icon, null);
        const sourceIcon = message.notification?.source?.icon;
        if (!icon.gicon && sourceIcon) {
            icon.gicon = sourceIcon;
            icon.visible = true;
        }
    } else {
        message.remove_style_class_name('sch-smart-message');
        row.set_child_below_sibling(icon, null);
        // the icon of the source was ours: GNOME shows none
        if (!message.notification?.gicon) {
            icon.gicon = null;
            icon.visible = false;
        }
    }
}

export class SmartBanners {
    // list: GNOME's notification list shown in the panel (it gets the flat
    // icons too, not the accent texts)
    constructor(settings, list) {
        this._settings = settings;
        this._list = list;
        this._checkId = 0;
        this._size = null;
        const tray = Main.messageTray;
        const bin = tray._bannerBin;
        this._oldAlign = bin.x_align;
        bin.x_align = Clutter.ActorAlign.END;
        bin.add_style_class_name('sch-smart-banners');

        // GNOME calls _showNotification() from _updateState() when the queue
        // has a notification to show, and _hideNotification() when it goes.
        // Own properties on the tray: deleting them brings back GNOME's methods.
        const show = tray._showNotification;
        const hide = tray._hideNotification;
        this._showWrapper = tray._showNotification = () => {
            if (this._mustWait()) {
                this._waitForPointer();
                return;
            }
            bin.translation_x = 0;
            show.call(tray);
            drawSmart(tray._banner, true);
            this._measure(tray._banner);
            if (this._fromSide())
                this._slideIn();
        };
        this._hideWrapper = tray._hideNotification = animate => {
            hide.call(tray, animate);
            if (animate && this._fromSide())
                this._slideOut();
        };

        settings.connectObject(
            ...STYLE_OPTIONS.flatMap(([key]) => [`changed::${key}`, () => this._syncStyle()]),
            this);
        this._syncStyle();
    }

    destroy() {
        this._settings.disconnectObject(this);
        if (this._checkId) {
            GLib.source_remove(this._checkId);
            this._checkId = 0;
        }
        const tray = Main.messageTray;
        const bin = tray._bannerBin;
        tray._banner?.disconnectObject(this);
        for (const [name, wrapper] of [['_showNotification', this._showWrapper],
            ['_hideNotification', this._hideWrapper]]) {
            if (tray[name] === wrapper)
                delete tray[name];
            else
                logWarning(`${name} patched by someone else, left as is`);
        }
        this._showWrapper = this._hideWrapper = null;
        bin.remove_style_class_name('sch-smart-banners');
        for (const [, cls] of STYLE_OPTIONS) {
            bin.remove_style_class_name(cls);
            this._list?.remove_style_class_name(cls);
        }
        bin.x_align = this._oldAlign;
        bin.translation_x = 0;
        // a notification that was waiting shows up now
        tray._updateState();
    }

    _syncStyle() {
        const bin = Main.messageTray._bannerBin;
        for (const [key, cls, inList] of STYLE_OPTIONS) {
            const on = this._settings.get_boolean(key);
            for (const actor of inList ? [bin, this._list] : [bin]) {
                if (on)
                    actor?.add_style_class_name(cls);
                else
                    actor?.remove_style_class_name(cls);
            }
        }
    }

    _fromSide() {
        return this._settings.get_string('smart-notifications-entry') === 'side';
    }

    _sideDistance() {
        const bin = Main.messageTray._bannerBin;
        const distance = bin.width || this._bannerSize()[0];
        return bin.get_text_direction() === Clutter.TextDirection.RTL ? -distance : distance;
    }

    // GNOME has just started its movement from above: it starts from the
    // final height instead, and the banner slides in from the screen edge
    _slideIn() {
        const bin = Main.messageTray._bannerBin;
        bin.get_transition('y')?.set_from(0);
        bin.translation_x = this._sideDistance();
        bin.ease({
            translation_x: 0,
            duration: SIDE_TIME_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // Going away: back towards the edge instead of up (GNOME's own end of
    // the movement still closes the banner)
    _slideOut() {
        const bin = Main.messageTray._bannerBin;
        bin.get_transition('y')?.set_to(bin.y);
        bin.ease({
            translation_x: this._sideDistance(),
            duration: SIDE_TIME_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }

    _mustWait() {
        const next = Main.messageTray._notificationQueue[0];
        return next?.urgency !== Urgency.CRITICAL && this._pointerInZone();
    }

    // One check every 200 ms, only while a notification is waiting
    _waitForPointer() {
        if (this._checkId)
            return;
        this._checkId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CHECK_INTERVAL_MS, () => {
            const tray = Main.messageTray;
            if (tray.queueCount > 0 && this._pointerInZone())
                return GLib.SOURCE_CONTINUE;
            this._checkId = 0;
            tray._updateState();
            return GLib.SOURCE_REMOVE;
        });
    }

    // The zone: in the corner of the primary monitor's work area where the
    // banners appear (top right; top left for right-to-left languages)
    _pointerInZone() {
        const [bannerWidth, bannerHeight] = this._bannerSize();
        const width = bannerWidth * ZONE_BANNERS_WIDE;
        const height = bannerHeight * ZONE_BANNERS_HIGH;
        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        const rtl = Main.messageTray._bannerBin.get_text_direction() === Clutter.TextDirection.RTL;
        const x = rtl ? area.x : area.x + area.width - width;
        const [px, py] = global.get_pointer();
        return px >= x && px < x + width && py >= area.y && py < area.y + height;
    }

    // The size of a closed banner, taken from the real one as soon as GNOME
    // has laid it out (and again if its text changes)
    _measure(banner) {
        banner?.connectObject('notify::height', () => {
            if (banner.mapped && !banner.expanded && banner.height > 0)
                this._size = [banner.width, banner.height];
        }, this);
    }

    // Size of the last banner measured; before the first one, the width the
    // stylesheet gives to a banner in the zone and a usual height
    _bannerSize() {
        if (!this._size) {
            const probe = new St.Widget({style_class: 'notification-banner sch-smart-message'});
            Main.messageTray._bannerBin.add_child(probe);
            const width = probe.width;
            probe.destroy();
            this._size = [width, Math.round(width / FALLBACK_RATIO)];
        }
        return this._size;
    }
}
