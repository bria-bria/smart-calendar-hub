// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// One alarm ringing (sch-alarm-watch.js decides when): the sound chosen for
// it in GNOME Clocks, over and over, until Stop, Snooze, the end of its ring
// minutes, or GNOME Clocks taking over. In the session the panel shows it
// in the card beside it (sch-alarm-screen.js); only while the screen is
// locked a notification of GNOME offers Snooze and Stop instead. As with the alarms of a phone, Do not disturb
// does not silence it, and a muted or low sound goes up to the alarm volume
// of our settings while it rings, then back exactly as it was.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gst from 'gi://Gst';

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

export class AlarmRinger {
    // actions: {stop(alarm), snooze(alarm, ring), upcoming()} of the watch
    constructor(settings, actions) {
        this._settings = settings;
        this._actions = actions;
        this.current = null; // {alarm, ring (GLib.DateTime)} while ringing
        this._waiting = []; // alarms due while another rings: next, in order
        this.onChange = null; // the panel, while it is there
        this._endId = 0;
        this._themeId = 0;
    }

    destroy() {
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
        this.current = {alarm, ring};
        this._raiseVolume();
        this._play(alarm.sound_uri);
        // locked or unlocked while it rings: the notification follows
        Main.sessionMode.connectObject('updated', () => this._syncNotification(), this);
        this._syncNotification();
        const minutes = alarm.ring_minutes ?? DEFAULT_RING_MINUTES;
        this._endId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, minutes * 60, () => {
            this._endId = 0;
            this.stop();
            return GLib.SOURCE_REMOVE;
        });
        this.onChange?.();
    }

    stop() {
        const current = this.current;
        if (!current)
            return;
        this._end();
        this._actions.stop(current.alarm);
    }

    snooze() {
        const current = this.current;
        if (!current)
            return;
        this._end();
        this._actions.snooze(current.alarm, current.ring);
    }

    // GNOME Clocks opened: it rings the alarm itself from now on
    handOver() {
        this._end();
    }

    get snoozeMinutes() {
        return this.current?.alarm.snooze_minutes ?? DEFAULT_SNOOZE_MINUTES;
    }

    upcoming() {
        return this._actions.upcoming();
    }

    _end() {
        if (!this.current)
            return;
        this.current = null;
        if (this._endId)
            GLib.source_remove(this._endId);
        this._endId = 0;
        this._stopSound();
        this._restoreVolume();
        Main.sessionMode.disconnectObject(this);
        this._notification?.destroy();
        this._notification = null;
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
