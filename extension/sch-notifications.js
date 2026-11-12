// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Silencing apps: no banner and no red dot, notifications kept in the list.
// A bell next to the X of every notification in the panel chooses for how
// long. muted-apps: "key TAB name TAB until TAB choice" (sch-settings-model.js).
// Also the Smart notifications (sch-smart-banners.js) and, as their option,
// tray icons that ask for attention (sch-tray-attention.js).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';

import {_} from './sch-i18n.js';
import {Connections} from './sch-signals.js';
import {SmartBanners, drawSmart} from './sch-smart-banners.js';
import {TrayAttention} from './sch-tray-attention.js';
import {logError, logWarning} from './sch-log.js';
import {oneLine, parseMuted, stillMuted} from './sch-settings-model.js';

// Stable identifier of the app behind a notification source
export function sourceKey(source) {
    return source.app?.get_id() || source.title || '';
}

export class Notifications {
    constructor(dateMenu, settings) {
        this._dateMenu = dateMenu;
        this._settings = settings;
        this._mutedCache = null;
        this._sources = new Set();
        this._bannerPolicies = new Map();
        this._smartBanners = null;
        this._trayAttention = null;
        this._signals = new Connections();
        // connected before the red dot: it reads isMuted() on the same change
        this._signals.connect(settings,
            'changed::muted-apps', () => {
                this._mutedCache = null;
            },
            'changed::smart-notifications', () => this._syncSmart(),
            'changed::smart-notifications-tray', () => this._syncSmart());
        this._signals.connect(Main.messageTray,
            'source-added', (_t, source) => this._watchSource(source),
            'source-removed', (_t, source) => {
                source.disconnectObject(this);
                this._sources.delete(source);
                this._releaseBanners(source);
            });
        for (const source of Main.messageTray.getSources())
            this._watchSource(source);
        this._patchNotificationMessages();
        this._syncSmart();
    }

    destroy() {
        this._signals.disconnectAll();
        for (const source of this._sources)
            source.disconnectObject(this);
        this._sources.clear();
        for (const source of [...this._bannerPolicies.keys()])
            this._releaseBanners(source);
        this._unpatchNotificationMessages();
        if (this._smartBanners) {
            for (const message of this._listMessages())
                drawSmart(message, false);
        }
        this._smartBanners?.destroy();
        this._smartBanners = null;
        this._trayAttention?.destroy();
        this._trayAttention = null;
    }

    _watchSource(source) {
        if (this._sources.has(source))
            return;
        this._sources.add(source);
        // the policy can be replaced: silence the new one too
        source.connectObject('notify::policy', () => this._holdBanners(source), this);
        this._holdBanners(source);
    }

    // Parsed once per change of the setting
    _mutedEntries() {
        this._mutedCache ??= parseMuted(this._settings.get_strv('muted-apps'));
        return this._mutedCache.filter(stillMuted);
    }

    isMuted(key) {
        return this._mutedEntries().some(e => e.key === key);
    }

    // until: Unix seconds when the silence ends, 0 = always
    // choice: index of the duration button (shown highlighted); until null = unmute
    _mute(source, until, choice = -1) {
        const key = sourceKey(source);
        if (!key)
            return;
        const label = oneLine(source.title || key);
        const list = this._mutedEntries().filter(e => e.key !== key)
            .map(e => `${e.key}\t${e.label}\t${e.until}\t${e.choice}`);
        if (until !== null)
            list.push(`${key}\t${label}\t${Math.round(until)}\t${choice}`);
        this._settings.set_strv('muted-apps', list);
        this._mutedCache = null;
    }

    _mutedEntry(key) {
        return this._mutedEntries().find(e => e.key === key) ?? null;
    }

    // No banner for a silenced app. GNOME shows a banner only if
    // source.policy.showBanners is true (or the notification is critical): the
    // policy of the source answers false while the app is silenced. The
    // urgency of the notifications is NOT changed: GNOME's message group
    // counts urgent messages on every urgency change and, lowered from normal
    // to low, it moved the message to a wrong place and the message vanished.
    _holdBanners(source) {
        const policy = source.policy;
        if (this._bannerPolicies.get(source) !== policy)
            this._releaseBanners(source); // the source got a new policy
        if (!policy || Object.prototype.hasOwnProperty.call(policy, 'showBanners'))
            return;
        let proto = Object.getPrototypeOf(policy);
        while (proto && !Object.getOwnPropertyDescriptor(proto, 'showBanners'))
            proto = Object.getPrototypeOf(proto);
        const original = proto && Object.getOwnPropertyDescriptor(proto, 'showBanners').get;
        if (!original)
            return;
        Object.defineProperty(policy, 'showBanners', {
            configurable: true,
            get: () => !this.isMuted(sourceKey(source)) && original.call(policy),
        });
        this._bannerPolicies.set(source, policy);
    }

    // The policy goes back to the getter of its class
    _releaseBanners(source) {
        const policy = this._bannerPolicies.get(source);
        if (policy)
            delete policy.showBanners;
        this._bannerPolicies.delete(source);
    }

    // A bell next to the X of every notification in the panel: it opens a
    // row with the durations. Hooked into GNOME's message group, undone on
    // disable.
    _patchNotificationMessages() {
        const proto = MessageList.NotificationMessageGroup?.prototype;
        if (!proto?._addNotification || this._origAddNotification)
            return;
        const notifications = this;
        const orig = this._origAddNotification = proto._addNotification;
        this._addNotificationWrapper = proto._addNotification = function (notification) {
            const result = orig.call(this, notification);
            try {
                const message = this._notificationToMessage?.get(notification);
                if (message) {
                    notifications._addMuteButton(message, notification, this.source);
                    drawSmart(message, notifications._smartBanners !== null);
                }
            } catch (e) {
                logError(`cannot add the silence button: ${e}`);
            }
            return result;
        };

        // Notifications already in the list (login, screen unlock)
        const groups = this._dateMenu._messageList?._messageView?._notificationSourceToGroup;
        for (const group of groups?.values() ?? []) {
            for (const [notification, message] of group._notificationToMessage ?? []) {
                this._addMuteButton(message, notification, group.source);
                drawSmart(message, this._smartBanners !== null);
            }
        }
    }

    _unpatchNotificationMessages() {
        const proto = MessageList.NotificationMessageGroup?.prototype;
        // Put back the original only if nobody patched it after us
        if (this._origAddNotification && proto?._addNotification === this._addNotificationWrapper)
            proto._addNotification = this._origAddNotification;
        else if (this._origAddNotification)
            logWarning('_addNotification patched by someone else, left as is');
        this._origAddNotification = null;
        this._addNotificationWrapper = null;
        // A message stays in its group's map until it is destroyed, so this
        // reaches every bell we added
        const groups = this._dateMenu._messageList?._messageView?._notificationSourceToGroup;
        for (const group of groups?.values() ?? []) {
            for (const message of group._notificationToMessage?.values() ?? [])
                message._schMuteActors?.forEach(actor => actor.destroy());
        }
    }

    // groupSource: the source of GNOME's message group, which always knows
    // the app (notification.source can be missing, e.g. with GSConnect)
    _addMuteButton(message, notification, groupSource = null) {
        const sourceOf = () => notification.source ?? groupSource;
        const header = message._header;
        const vbox = message.get_child();
        if (!header?.closeButton || !vbox || message._schMuteActors)
            return;

        const bell = new St.Button({
            style_class: 'message-close-button sch-mute-button',
            icon_name: 'notifications-disabled-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: _('Silence notifications from this app'),
        });
        header.insert_child_below(bell, header.closeButton);
        bell.connect('destroy', () => {
            delete message._schMuteActors;
        });

        // The notification itself is a button: a click in the gaps of the row
        // must not open the app. The row must NOT swallow press/release events:
        // on GNOME 51 St.Button recognizes clicks with a Clutter.ClickGesture,
        // and stopping those events kept the duration buttons from working.
        // The message's own "clicked" is stopped instead when the pointer is
        // on the row (it runs before GNOME's default handler, vfunc_clicked).
        const row = new St.BoxLayout({style_class: 'sch-mute-row', visible: false, x_expand: true});
        const stopClick = () => {
            if (!row.visible || !row.mapped)
                return;
            const [x, y] = global.get_pointer();
            const box = row.get_transformed_extents();
            if (x >= box.get_x() && x < box.get_x() + box.get_width() &&
                y >= box.get_y() && y < box.get_y() + box.get_height())
                GObject.signal_stop_emission_by_name(message, 'clicked');
        };
        const hour = 3600;
        const choices = [
            [_('1 hour'), () => Date.now() / 1000 + hour],
            [_('8 hours'), () => Date.now() / 1000 + 8 * hour],
            // until 8:00 the next morning (the same day if it is still night)
            [_('Until tomorrow'), () => {
                const d = new Date();
                const day = d.getHours() < 5 ? d.getDate() : d.getDate() + 1;
                return new Date(d.getFullYear(), d.getMonth(), day, 8).getTime() / 1000;
            }],
            [_('Always'), () => 0],
        ];
        const buttons = [];
        // "Silenced until 12:40", under the durations
        const note = new St.Label({style_class: 'sch-mute-note', visible: false});
        // the panel is narrow: the note goes on two lines instead of being cut
        note.clutter_text.line_wrap = true;
        note.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        // Shows the current state: chosen duration in colour, note, bell in colour
        const sync = () => {
            const source = sourceOf();
            const entry = source ? this._mutedEntry(sourceKey(source)) : null;
            buttons.forEach((b, i) => {
                if (entry && entry.choice === i)
                    b.add_style_class_name('sch-mute-choice-on');
                else
                    b.remove_style_class_name('sch-mute-choice-on');
            });
            if (entry)
                bell.add_style_class_name('sch-mute-on');
            else
                bell.remove_style_class_name('sch-mute-on');
            note.visible = !!entry && row.visible;
            if (entry) {
                if (entry.until === 0) {
                    note.text = _('Always silenced · press the coloured button again to turn it back on');
                } else {
                    const end = GLib.DateTime.new_from_unix_local(entry.until);
                    const sameDay = end.format('%F') === GLib.DateTime.new_now_local().format('%F');
                    note.text = _('Silenced until {time} · press the coloured button again to turn it back on', {time: end.format(sameDay ? '%H:%M' : '%a %H:%M')});
                }
            }
        };
        choices.forEach(([label, until], i) => {
            const btn = new St.Button({label, style_class: 'sch-mute-choice', x_expand: true, can_focus: true});
            btn.connect('clicked', () => {
                const source = sourceOf();
                if (!source)
                    return;
                // clicking the chosen duration again turns the silence off
                const entry = this._mutedEntry(sourceKey(source));
                this._mute(source, entry?.choice === i ? null : until(), i);
                sync();
            });
            buttons.push(btn);
            row.add_child(btn);
        });
        vbox.add_child(row);
        vbox.add_child(note);
        bell.connect('clicked', () => {
            row.visible = !row.visible;
            sync();
        });
        // Handlers on GNOME's message and on our settings go away with the
        // bell: the message outlives the extension (disabled on screen lock,
        // enabled again on unlock). Other notifications of the same app, and
        // expired silences, follow the setting; the bell is also checked
        // again when the panel opens.
        message.connectObject(
            'clicked', stopClick,
            'notify::mapped', () => {
                if (message.mapped)
                    sync();
            },
            bell);
        this._settings.connectObject('changed::muted-apps', sync, bell);
        sync();

        message._schMuteActors = [bell, row, note];
    }

    _listMessages() {
        const groups = this._dateMenu._messageList?._messageView?._notificationSourceToGroup;
        return [...groups?.values() ?? []].flatMap(group =>
            [...group._notificationToMessage?.values() ?? []]);
    }

    _syncSmart() {
        const on = this._settings.get_boolean('smart-notifications');
        if (on !== (this._smartBanners !== null)) {
            if (on) {
                this._smartBanners = new SmartBanners(this._settings, this._dateMenu._messageList);
            } else {
                this._smartBanners.destroy();
                this._smartBanners = null;
            }
            // the notifications already in the panel's list
            for (const message of this._listMessages())
                drawSmart(message, on);
        }
        const tray = on && this._settings.get_boolean('smart-notifications-tray');
        if (tray && !this._trayAttention) {
            this._trayAttention = new TrayAttention();
        } else if (!tray && this._trayAttention) {
            this._trayAttention.destroy();
            this._trayAttention = null;
        }
    }
}
