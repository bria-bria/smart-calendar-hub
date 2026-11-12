// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Smart notifications. The notifications GNOME would show as banners, one at
// a time at the top centre, are shown here instead: up to three stacked in a
// zone attached to the top right corner of the work area (right under the top
// bar and against the screen edge, so it follows any dock or panel there).
// The zone is two banners wide and three high.
//  - A new banner comes in at the top of the stack, the others move down;
//    each one stays its own time, shown by a line that shortens.
//  - While the pointer is in the zone every banner stays (its line full) and
//    new ones wait in GNOME's queue (same order, nothing lost) until the
//    pointer leaves; only the banner under the pointer opens (full text and
//    buttons). Critical banners never wait and never go by themselves.
//  - The icon is on the right; banners come in from the top or from the side
//    and leave through the screen edge.
//  - Options: all texts in the accent colour, flat icons in the accent colour.
//  - The notifications in the panel's list are drawn the same way (drawSmart),
//    with the flat icons option but not the accent texts.
// GNOME still decides when a notification may show (Do not disturb, full
// screen, lock screen): it calls _showNotification() and the banner goes to
// the stack instead of GNOME's own place. Switched off, everything is undone.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {NotificationDestroyedReason, Urgency} from 'resource:///org/gnome/shell/ui/messageTray.js';
import {formatTimeSpan} from 'resource:///org/gnome/shell/misc/dateUtils.js';

import {logWarning} from './sch-log.js';

const MAX_SHOWN = 3;
const SHOWN_TIME_MS = 5000;
// times of the mockup: in 0.45 s with a small bounce at the end, out and
// the others moving up or down in 0.3 s
const IN_TIME_MS = 450;
const MOVE_TIME_MS = 300;
// space between two banners (spacing of .sch-smart-banners)
const GAP = 8;
// when they go on again after a stop, the oldest goes after 3 s, the next
// ones 1.5 s apart
const AGAIN_FIRST_MS = 3000;
const AGAIN_STEP_MS = 1500;
const CHECK_INTERVAL_MS = 200;
// GNOME's limit for "the user is using the computer"
const IDLE_TIME_MS = 1000;
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

// One banner of the stack, drawn by us: on the left the app (icon, name,
// time), the title and one line of text; on the right the icon of the
// notification. A line at the bottom shortens with its time. With the
// pointer on it, it opens: full text, its buttons across the bottom and a
// close button in the corner.
class SmartBanner {
    constructor(stack, notification) {
        this.notification = notification;
        this._stack = stack;
        this._timeoutId = 0;
        this.critical = notification.urgency === Urgency.CRITICAL;
        const source = notification.source;

        const card = this.actor = new St.Button({
            style_class: 'sch-smart-card',
            can_focus: false,
            x_expand: true,
        });
        const overlay = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
        card.set_child(overlay);

        const content = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const row = new St.BoxLayout({style_class: 'sch-smart-card-row', x_expand: true});
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const header = new St.BoxLayout({style_class: 'sch-smart-card-header'});
        header.add_child(new St.Icon({
            style_class: 'sch-smart-card-app-icon',
            gicon: source?.icon ?? null,
            visible: !!source?.icon,
        }));
        header.add_child(new St.Label({text: source?.title ?? '', y_align: Clutter.ActorAlign.CENTER}));
        header.add_child(new St.Widget({style_class: 'sch-smart-card-dot', y_align: Clutter.ActorAlign.CENTER}));
        header.add_child(new St.Label({
            text: formatTimeSpan(notification.datetime),
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._title = new St.Label({style_class: 'sch-smart-card-title'});
        this._body = new St.Label({style_class: 'sch-smart-card-body'});
        text.add_child(header);
        text.add_child(this._title);
        text.add_child(this._body);
        row.add_child(text);
        const tile = new St.Bin({style_class: 'sch-smart-card-icon', y_align: Clutter.ActorAlign.START});
        tile.set_child(new St.Icon({gicon: notification.gicon ?? source?.icon ?? null}));
        row.add_child(tile);
        content.add_child(row);

        this._actions = new St.BoxLayout({style_class: 'sch-smart-card-actions', x_expand: true, visible: false});
        for (const action of notification.actions) {
            const button = new St.Button({style_class: 'sch-smart-card-action', label: action.label, x_expand: true});
            button.connect('clicked', () => {
                action.activate();
                stack.remove(this);
            });
            this._actions.add_child(button);
        }
        content.add_child(this._actions);
        overlay.add_child(content);

        this._close = new St.Button({
            style_class: 'sch-smart-card-close',
            icon_name: 'window-close-symbolic',
            // in a bin the alignment counts only for expanded children
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
            visible: false,
        });
        this._close.connect('clicked', () => notification.destroy(NotificationDestroyedReason.DISMISSED));
        overlay.add_child(this._close);

        if (!this.critical) {
            this._bar = new St.Widget({
                style_class: 'sch-smart-time-bar',
                x_expand: true,
                y_expand: true,
                y_align: Clutter.ActorAlign.END,
            });
            const rtl = card.get_text_direction() === Clutter.TextDirection.RTL;
            this._bar.set_pivot_point(rtl ? 1 : 0, 0.5);
            overlay.add_child(this._bar);
        }

        this._sync();
        // a click runs the notification's main action; closed, clicked or
        // withdrawn by its app: out of the stack
        card.connect('clicked', () => notification.activate());
        notification.connectObject(
            'notify::title', () => this._sync(),
            'notify::body', () => this._sync(),
            'activated', () => stack.remove(this),
            'destroy', () => stack.remove(this), this);
        card.connect('notify::hover', () => this._open(card.hover || this.critical));
        this._open(this.critical);
    }

    _sync() {
        this._title.text = this.notification.title ?? '';
        const body = this.notification.body ?? '';
        // the text only: the markup some apps send is not needed on a banner
        this._body.text = this.notification.useBodyMarkup ? body.replace(/<[^>]*>/g, '') : body;
        this._body.visible = this._body.text !== '';
    }

    // Open: full text, buttons and close button
    _open(open) {
        this.actor[open ? 'add_style_pseudo_class' : 'remove_style_pseudo_class']('open');
        this._body.clutter_text.line_wrap = open;
        this._body.clutter_text.ellipsize = open ? Pango.EllipsizeMode.NONE : Pango.EllipsizeMode.END;
        this._actions.visible = open && this._actions.get_n_children() > 0;
        this._close.visible = open;
    }

    get running() {
        return this._timeoutId !== 0;
    }

    // Its time starts from the beginning, line full
    run(duration = SHOWN_TIME_MS) {
        if (this.critical || this.running)
            return;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
            this._timeoutId = 0;
            this._stack.remove(this);
            return GLib.SOURCE_REMOVE;
        });
        this._bar.scale_x = 1;
        this._bar.ease({scale_x: 0, duration, mode: Clutter.AnimationMode.LINEAR});
    }

    hold() {
        if (!this.running)
            return;
        GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        this._bar.remove_all_transitions();
        this._bar.scale_x = 1;
    }

    destroy() {
        this.hold();
        this.notification.disconnectObject(this);
        this._bar = null;
        this.actor.destroy();
    }
}

export class SmartBanners {
    // list: GNOME's notification list shown in the panel (it gets the flat
    // icons too, not the accent texts)
    constructor(settings, list) {
        this._settings = settings;
        this._list = list;
        this._banners = [];
        this._checkId = 0;
        this._activeWatch = 0;
        this._size = null;

        this._box = new St.BoxLayout({
            style_class: 'sch-smart-banners',
            orientation: Clutter.Orientation.VERTICAL,
        });
        this._box.hide();
        Main.layoutManager.addTopChrome(this._box);
        this._box.connectObject('notify::width', () => this._place(), this);
        global.display.connectObject('workareas-changed', () => this._place(), this);
        this._place();

        // GNOME calls _showNotification() from _updateState() when it has a
        // banner to show. An own property on the tray: deleting it brings
        // back GNOME's method.
        const tray = Main.messageTray;
        this._showWrapper = tray._showNotification = () => this._takeNext();

        settings.connectObject(
            ...STYLE_OPTIONS.flatMap(([key]) => [`changed::${key}`, () => this._syncStyle()]),
            this);
        this._syncStyle();
    }

    destroy() {
        this._settings.disconnectObject(this);
        global.display.disconnectObject(this);
        if (this._checkId) {
            GLib.source_remove(this._checkId);
            this._checkId = 0;
        }
        this._stopActiveWatch();
        const tray = Main.messageTray;
        if (tray._showNotification === this._showWrapper)
            delete tray._showNotification;
        else
            logWarning('_showNotification patched by someone else, left as is');
        this._showWrapper = null;
        // the notifications stay in the panel's list
        for (const banner of this._banners)
            banner.destroy();
        this._banners = [];
        for (const [, cls] of STYLE_OPTIONS)
            this._list?.remove_style_class_name(cls);
        Main.layoutManager.removeChrome(this._box);
        this._box.destroy();
        this._box = null;
        // a notification that was waiting shows up now, GNOME's way
        tray._updateState();
    }

    _syncStyle() {
        for (const [key, cls, inList] of STYLE_OPTIONS) {
            const on = this._settings.get_boolean(key);
            for (const actor of inList ? [this._box, this._list] : [this._box]) {
                if (on)
                    actor?.add_style_class_name(cls);
                else
                    actor?.remove_style_class_name(cls);
            }
        }
    }

    // Top right corner of the primary monitor's work area (top left for
    // right-to-left languages)
    _place() {
        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        const rtl = this._box.get_text_direction() === Clutter.TextDirection.RTL;
        this._box.set_position(rtl ? area.x : area.x + area.width - this._box.width, area.y);
    }

    // The next notification of GNOME's queue joins the stack, unless the
    // stack is full or the pointer is in the zone (critical ones always join)
    _takeNext() {
        const tray = Main.messageTray;
        const next = tray._notificationQueue[0];
        if (!next)
            return;
        const critical = next.urgency === Urgency.CRITICAL;
        if (!critical && (this._banners.length >= MAX_SHOWN || this._pointerInZone())) {
            this._startChecks();
            return;
        }
        tray._notificationQueue.shift();
        tray.emit('queue-changed');
        this._add(next);
        this._startChecks();
    }

    _add(notification) {
        // what GNOME does when it shows a banner
        notification.acknowledged = true;
        notification.playSound();

        const banner = new SmartBanner(this, notification);
        this._banners.unshift(banner);
        this._box.insert_child_at_index(banner.actor, 0);
        this._box.show();
        this._measure(banner.actor);

        const actor = banner.actor;
        const height = this._bannerSize()[1];
        actor.opacity = 0;
        if (this._fromSide())
            actor.translation_x = this._sideDistance();
        else
            actor.translation_y = -height;
        actor.ease({
            opacity: 255,
            translation_x: 0,
            translation_y: 0,
            duration: IN_TIME_MS,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
        // the others make room by sliding down
        for (const other of this._banners.slice(1))
            this._slide(other.actor, -(height + GAP));

        if (this._userIdle())
            this._startActiveWatch();
        else if (!this._pointerInZone())
            banner.run();
    }

    // Out of the stack: it slides away, the notification stays in the list
    // (transient ones go, as GNOME does)
    remove(banner) {
        const index = this._banners.indexOf(banner);
        if (index === -1)
            return;
        this._banners.splice(index, 1);
        banner.hold();
        banner.notification.disconnectObject(banner);
        const actor = banner.actor;
        actor.reactive = false;
        // out through the screen edge, fading: going up it would cross the
        // banners above it
        actor.ease({
            opacity: 0,
            translation_x: this._sideDistance(),
            duration: MOVE_TIME_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => {
                const gap = actor.height + GAP;
                const below = this._box?.get_children().slice(this._box.get_children().indexOf(actor) + 1) ?? [];
                banner.destroy();
                // the ones below close the gap by sliding up
                for (const other of below.filter(a => a.reactive))
                    this._slide(other, gap);
                // empty, it is not there at all
                if (this._box)
                    this._box.visible = this._box.get_n_children() > 0;
                const notification = banner.notification;
                if (notification.isTransient && !notification._destroyed)
                    notification.destroy(NotificationDestroyedReason.EXPIRED);
            },
        });
        Main.messageTray._updateState();
    }

    // From a shift back to its place in the stack
    _slide(actor, shift) {
        actor.translation_y += shift;
        actor.ease({
            translation_y: 0,
            duration: MOVE_TIME_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // While the stack is shown or something waits: every 200 ms the times
    // stop or go on with the pointer, and a waiting notification is let in
    _startChecks() {
        if (this._checkId)
            return;
        this._checkId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CHECK_INTERVAL_MS, () => {
            const tray = Main.messageTray;
            const inZone = this._pointerInZone();
            const active = !this._activeWatch;
            // going on again, they leave one after the other, the oldest first
            const count = this._banners.length;
            this._banners.forEach((banner, index) => {
                if (inZone)
                    banner.hold();
                else if (active)
                    banner.run(AGAIN_FIRST_MS + (count - 1 - index) * AGAIN_STEP_MS);
            });
            if (tray.queueCount > 0 && !inZone && this._banners.length < MAX_SHOWN)
                tray._updateState();
            if (this._banners.length > 0 || tray.queueCount > 0)
                return GLib.SOURCE_CONTINUE;
            this._checkId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    // GNOME keeps a banner on screen until someone uses the computer: the
    // times start when someone does
    _userIdle() {
        return Main.messageTray.idleMonitor.get_idletime() > IDLE_TIME_MS;
    }

    _startActiveWatch() {
        if (this._activeWatch)
            return;
        this._activeWatch = Main.messageTray.idleMonitor.add_user_active_watch(() => {
            this._activeWatch = 0;
        });
    }

    _stopActiveWatch() {
        if (this._activeWatch) {
            Main.messageTray.idleMonitor.remove_watch(this._activeWatch);
            this._activeWatch = 0;
        }
    }

    _fromSide() {
        return this._settings.get_string('smart-notifications-entry') === 'side';
    }

    _sideDistance() {
        const distance = this._bannerSize()[0];
        return this._box.get_text_direction() === Clutter.TextDirection.RTL ? -distance : distance;
    }

    // The zone: two banners wide and three high, in the corner of the work
    // area where the stack is
    _pointerInZone() {
        const [bannerWidth, bannerHeight] = this._bannerSize();
        const width = bannerWidth * ZONE_BANNERS_WIDE;
        const height = bannerHeight * ZONE_BANNERS_HIGH;
        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        const rtl = this._box.get_text_direction() === Clutter.TextDirection.RTL;
        const x = rtl ? area.x : area.x + area.width - width;
        const [px, py] = global.get_pointer();
        return px >= x && px < x + width && py >= area.y && py < area.y + height;
    }

    // The size of a closed banner, taken from a real one as soon as it is
    // laid out (and again if its text changes)
    _measure(message) {
        message.connectObject('notify::height', () => {
            if (message.mapped && !message.expanded && message.height > 0)
                this._size = [message.width, message.height];
        }, this);
    }

    // Size of the last banner measured; before the first one, the width the
    // stylesheet gives to a banner and a usual height
    _bannerSize() {
        if (!this._size) {
            const probe = new St.Widget({style_class: 'sch-smart-card'});
            this._box.add_child(probe);
            const width = probe.width;
            probe.destroy();
            this._size = [width, Math.round(width / FALLBACK_RATIO)];
        }
        return this._size;
    }
}
