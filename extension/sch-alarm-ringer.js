// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// One alarm ringing (sch-alarm-watch.js decides when), never by two at
// once. GNOME Clocks rings an alarm itself while it runs with its alarms
// loaded, also after its window was closed: so while it runs, the hub first
// waits a few seconds for its "Alarm" notification. If it comes, GNOME Clocks
// is ringing: the hub shows the alarm and its Stop and Snooze are the actions
// of GNOME Clocks. Otherwise the hub rings it: the sound chosen for it in
// GNOME Clocks, over and over, until Stop, Snooze, the end of its ring
// minutes, or GNOME Clocks taking over. In the session the panel shows the
// alarm in the card beside it (sch-alarm-screen.js); only while the screen
// is locked a notification of ours offers Snooze and Stop. As with the alarms
// of a phone, Do not disturb does not silence it, and a muted or low sound
// goes up to the alarm volume of our settings while it rings, then back as
// it was.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gst from 'gi://Gst';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {getMixerControl} from 'resource:///org/gnome/shell/ui/status/volume.js';

import {_} from './sch-i18n.js';
import {logError} from './sch-log.js';

export const DEFAULT_RING_MINUTES = 5;
export const DEFAULT_SNOOZE_MINUTES = 10;
const VOLUME_KEY = 'alarm-volume';
const THEME_SOUND = 'alarm-clock-elapsed';
const THEME_REPEAT_S = 3; // the sound of the theme when the file cannot be played

// "17:40" or "5:40 PM", like GNOME's clock
export function formatTime(time) {
    const twelve = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).get_string('clock-format') === '12h';
    return time.format(twelve ? '%l:%M %p' : '%H:%M').replace(/\s+/g, ' ').trim();
}

const CLOCKS_ID = 'org.gnome.clocks';
const CLOCKS_WAIT_S = 6; // GNOME Clocks running: the wait for its notification
const CLOCKS_RECENT_US = 90 * 1e6; // a notification of GNOME Clocks this new: its alarm
const CLOCKS_PATH = '/org/gnome/clocks';
const CLOCKS_CHECK_MS = 1500; // after Stop or Snooze sent to GNOME Clocks

export class AlarmRinger {
    // actions: {stop(alarm), snooze(alarm, ring), upcoming(), savedRing(id)}
    // of the watch
    constructor(settings, actions) {
        this._settings = settings;
        this._actions = actions;
        // while ringing: {alarm, ring (GLib.DateTime), by: 'waiting' |
        // 'hub' | 'clocks'}
        this.current = null;
        this._waiting = []; // alarms due while another rings: next, in order
        this.onChange = null; // the panel, while it is there
        this._endId = 0;
        this._waitId = 0;
        this._themeId = 0;
        this._afterId = 0; // after Stop or Snooze sent to GNOME Clocks
    }

    destroy() {
        if (this._afterId)
            GLib.source_remove(this._afterId);
        this._afterId = 0;
        this._waiting = [];
        this._end();
        this.onChange = null;
    }

    ring(alarm, ring) {
        if (this.current) {
            if (this.current.alarm.id !== alarm.id && !this._waiting.some(w => w.alarm.id === alarm.id))
                this._waiting.push({alarm, ring});
            return;
        }
        const current = this.current = {alarm, ring, by: 'waiting'};
        this._watchClocks();
        // GNOME Clocks checks on the minute too: its notification may be
        // there already
        const now = GLib.DateTime.new_now_local();
        const recent = Main.messageTray.getSources()
            .filter(source => source.policy?.id === CLOCKS_ID)
            .flatMap(source => source.notifications)
            .find(n => n.datetime && now.difference(n.datetime) < CLOCKS_RECENT_US);
        if (recent)
            this._onClocksNotification(recent);
        const minutes = alarm.ring_minutes ?? DEFAULT_RING_MINUTES;
        // the end of its ring minutes: GNOME Clocks stops its own by itself
        this._endId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, minutes * 60, () => {
            this._endId = 0;
            if (current.by === 'clocks')
                this._end();
            else
                this.stop();
            return GLib.SOURCE_REMOVE;
        });
        this.onChange?.();
        this._clocksRunning().then(running => {
            if (this.current !== current || current.by !== 'waiting')
                return;
            if (!running) {
                this._ringOwn();
                return;
            }
            this._waitId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CLOCKS_WAIT_S, () => {
                this._waitId = 0;
                if (this.current === current && current.by === 'waiting')
                    this._ringOwn();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    stop() {
        this._finish('stop-alarm', alarm => this._actions.stop(alarm));
    }

    snooze() {
        this._finish('snooze-alarm', (alarm, ring) => this._actions.snooze(alarm, ring));
    }

    // GNOME Clocks opened while the hub rings: it rings the alarm itself
    // (it loads it still within its ring minutes); its notification follows
    handOver() {
        const current = this.current;
        if (current?.by !== 'hub')
            return;
        this._silence();
        current.by = 'waiting';
        // no notification of GNOME Clocks after all: the hub rings again
        this._waitId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CLOCKS_WAIT_S, () => {
            this._waitId = 0;
            if (this.current === current && current.by === 'waiting')
                this._ringOwn();
            return GLib.SOURCE_REMOVE;
        });
    }

    get snoozeMinutes() {
        return this.current?.alarm.snooze_minutes ?? DEFAULT_SNOOZE_MINUTES;
    }

    upcoming() {
        return this._actions.upcoming();
    }

    // Stop or Snooze: of GNOME Clocks when it rings (it writes the next ring
    // itself), else ours
    _finish(action, ours) {
        const current = this.current;
        if (!current)
            return;
        const clocksNote = this._clocksNote;
        this._end();
        if (current.by !== 'clocks') {
            ours(current.alarm, current.ring);
            // a GNOME Clocks running keeps its alarms in memory: told too, so
            // it does not ring this one later
            this._clocksRunning().then(running => {
                if (running)
                    this._clocksAction(action, current.alarm.id);
            });
            return;
        }
        this._clocksAction(action, current.alarm.id);
        clocksNote?.destroy();
        // GNOME Clocks moves the alarm on when it obeys: if the saved ring is
        // still the same a moment later, its window opens, with its own Stop
        const saved = this._actions.savedRing(current.alarm.id);
        if (this._afterId)
            GLib.source_remove(this._afterId);
        this._afterId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CLOCKS_CHECK_MS, () => {
            this._afterId = 0;
            if (this._actions.savedRing(current.alarm.id) === saved)
                Shell.AppSystem.get_default().lookup_app(`${CLOCKS_ID}.desktop`)?.activate();
            return GLib.SOURCE_REMOVE;
        });
    }

    // An action of GNOME Clocks (org.gtk.Actions of its D-Bus name) with the
    // id of an alarm, as the buttons of its notification
    _clocksAction(action, id) {
        Gio.DBus.session.call(CLOCKS_ID, CLOCKS_PATH, 'org.gtk.Actions', 'Activate',
            new GLib.Variant('(sava{sv})', [action, [new GLib.Variant('s', id ?? '')], {}]),
            null, Gio.DBusCallFlags.NONE, -1, null)
            .catch(e => logError(`GNOME Clocks ${action}: ${e}`));
    }

    // The bus name of GNOME Clocks has an owner: it runs, maybe with its
    // alarms loaded (asked without blocking GNOME Shell)
    async _clocksRunning() {
        try {
            const reply = await Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
                'org.freedesktop.DBus', 'NameHasOwner', new GLib.Variant('(s)', [CLOCKS_ID]),
                new GLib.VariantType('(b)'), Gio.DBusCallFlags.NONE, -1, null);
            return reply.deepUnpack()[0];
        } catch (e) {
            logError(`GNOME Clocks running: ${e}`);
            return false;
        }
    }

    // The notifications of GNOME Clocks (its alarm notification means it
    // rings), also those of a source added later
    _watchClocks() {
        const watch = source => {
            if (source.policy?.id === CLOCKS_ID)
                source.connectObject('notification-added', (_s, notification) => this._onClocksNotification(notification), this);
        };
        Main.messageTray.getSources().forEach(watch);
        Main.messageTray.connectObject('source-added', (_tray, source) => watch(source), this);
    }

    _onClocksNotification(notification) {
        const current = this.current;
        if (!current || current.by === 'clocks')
            return;
        this._silence();
        current.by = 'clocks';
        this._clocksNote = notification;
        // stopped in GNOME Clocks, its notification or a phone: done (a new
        // notification of the same alarm replaces it: not an end)
        notification.connectObject('destroy', (_n, reason) => {
            if (reason !== MessageTray.NotificationDestroyedReason.REPLACED && this.current === current)
                this._end();
        }, this);
        this.onChange?.();
    }

    // The hub rings it: sound, volume, the notification on the lock screen
    _ringOwn() {
        this.current.by = 'hub';
        this._raiseVolume();
        this._play(this.current.alarm.sound_uri);
        // locked or unlocked while it rings: the notification follows
        Main.sessionMode.connectObject('updated', () => this._syncNotification(), this);
        this._syncNotification();
    }

    // Our sound, volume and notification off
    _silence() {
        this._stopSound();
        this._restoreVolume();
        Main.sessionMode.disconnectObject(this);
        this._notification?.destroy();
        this._notification = null;
    }

    _end() {
        if (!this.current)
            return;
        this.current = null;
        if (this._endId)
            GLib.source_remove(this._endId);
        this._endId = 0;
        if (this._waitId)
            GLib.source_remove(this._waitId);
        this._waitId = 0;
        this._silence();
        Main.messageTray.disconnectObject(this);
        Main.messageTray.getSources().forEach(source => source.disconnectObject(this));
        this._clocksNote?.disconnectObject(this);
        this._clocksNote = null;
        this.onChange?.();
        // the next one due meanwhile, if still within its ring minutes
        const now = GLib.DateTime.new_now_local();
        while (this._waiting.length && !this.current) {
            const {alarm, ring} = this._waiting.shift();
            if (now.difference(ring) < (alarm.ring_minutes ?? DEFAULT_RING_MINUTES) * 60 * 1e6)
                this.ring(alarm, ring);
        }
    }

    // The file of the alarm, looped; GStreamer plays it without blocking
    // GNOME Shell. A file it cannot play (none chosen, or inside the sandbox
    // of a Flatpak GNOME Clocks): the alarm sound of the theme
    _play(uri) {
        if (!uri) {
            this._playTheme();
            return;
        }
        if (!Gst.is_initialized())
            Gst.init(null);
        const player = Gst.ElementFactory.make('playbin', null);
        if (!player) {
            this._playTheme();
            return;
        }
        player.uri = uri;
        const bus = player.get_bus();
        bus.add_signal_watch();
        bus.connectObject(
            'message::eos', () => player.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH, 0),
            'message::error', (_bus, message) => {
                const [error] = message.parse_error();
                logError(`alarm sound ${uri}: ${error.message}`);
                this._stopSound();
                this._playTheme();
            }, this);
        this._player = player;
        this._bus = bus;
        player.set_state(Gst.State.PLAYING);
    }

    _playTheme() {
        const play = () => global.display.get_sound_player().play_from_theme(THEME_SOUND, _('Alarm'), null);
        play();
        this._themeId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, THEME_REPEAT_S, () => {
            play();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopSound() {
        if (this._themeId)
            GLib.source_remove(this._themeId);
        this._themeId = 0;
        this._bus?.disconnectObject(this);
        this._bus?.remove_signal_watch();
        this._bus = null;
        this._player?.set_state(Gst.State.NULL);
        this._player = null;
    }

    // The default output up to the alarm volume while it rings (only if
    // muted or lower), as the volume slider of GNOME does it
    _raiseVolume() {
        const control = getMixerControl();
        const sink = control?.get_default_sink();
        if (!sink)
            return;
        const target = this._settings.get_int(VOLUME_KEY) / 100 * control.get_vol_max_norm();
        if (!sink.is_muted && sink.volume >= target)
            return;
        this._saved = {sink, volume: sink.volume, muted: sink.is_muted, raised: Math.max(sink.volume, target)};
        if (sink.volume < target) {
            sink.volume = target;
            sink.push_volume();
        }
        if (sink.is_muted)
            sink.change_is_muted(false);
    }

    // Back as it was, unless the user changed it while the alarm rang
    _restoreVolume() {
        const saved = this._saved;
        this._saved = null;
        if (!saved || saved.sink.is_muted || Math.abs(saved.sink.volume - saved.raised) > 1)
            return;
        saved.sink.volume = saved.volume;
        saved.sink.push_volume();
        if (saved.muted)
            saved.sink.change_is_muted(true);
    }

    // The notification only on the lock screen; in the session, the card
    _syncNotification() {
        if (Main.sessionMode.isLocked && !this._notification) {
            this._notify();
        } else if (!Main.sessionMode.isLocked) {
            this._notification?.destroy();
            this._notification = null;
        }
    }

    // Critical: shown also with Do not disturb; it plays no sound of its own
    _notify() {
        const {alarm, ring} = this.current;
        const source = MessageTray.getSystemSource();
        const notification = new MessageTray.Notification({
            source,
            title: _('Alarm · {time}', {time: formatTime(ring)}),
            body: alarm.name ?? '',
            gicon: new Gio.ThemedIcon({name: 'alarm-symbolic'}),
            urgency: MessageTray.Urgency.CRITICAL,
        });
        notification.addAction(_('Snooze'), () => this.snooze());
        notification.addAction(_('Stop'), () => this.stop());
        notification.connect('destroy', () => {
            if (this._notification === notification)
                this._notification = null;
        });
        this._notification = notification;
        source.addNotification(notification);
    }
}
