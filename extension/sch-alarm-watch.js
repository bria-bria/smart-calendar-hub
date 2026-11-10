// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The alarms of GNOME Clocks, rung by the hub. GNOME Clocks rings its alarms
// only while it runs with them loaded; otherwise the hub rings them
// (sch-alarm-ringer.js finds out which, never both). GNOME
// Clocks stays where the alarms are kept: Stop and Snooze write the next
// ring back as it does. While the session is on (also with the screen
// locked) the hub checks at the time of each alarm; an alarm that fell while
// the computer was asleep is rung on waking if still within its ring
// minutes, otherwise it is a missed alarm, saved in GSettings until it is
// clicked away in the world clocks card. Nothing is known of the time the
// computer was off or at the login screen.

import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {AlarmRinger, DEFAULT_RING_MINUTES, DEFAULT_SNOOZE_MINUTES} from './sch-alarm-ringer.js';
import {CLOCKS_DESKTOP, ClocksSource} from './sch-clocks-source.js';

export const MISSED_KEY = 'missed-alarms';
const MAX_MISSED = 10;
const CHECK_MS = 60000; // at least once a minute: the wait stops during a suspend
const MAX_GAP_US = 90 * 1e6; // longer between two checks: we were asleep

// The next ring by the days of the week after a moment, null for an alarm
// without days (it rings once)
export function nextByDays(alarm, after) {
    const days = alarm.days ?? [];
    if (!days.length)
        return null;
    for (let i = 0; i <= 7; i++) {
        const day = after.add_days(i);
        const ring = GLib.DateTime.new_local(day.get_year(), day.get_month(),
            day.get_day_of_month(), alarm.hour ?? 0, alarm.minute ?? 0, 0);
        if (ring.compare(after) > 0 && days.includes(ring.get_day_of_week()))
            return ring;
    }
    return null;
}

// The next ring of an alarm after a moment (GLib.DateTime), null if none.
// GNOME Clocks saves the next ring only while its window is open, so the one
// saved can be long past: an alarm with days of the week still rings on them
export function nextRing(alarm, after) {
    if (!alarm.ring_time)
        return null; // switched off
    const saved = GLib.DateTime.new_from_iso8601(alarm.ring_time, null)?.to_local();
    if (saved && saved.compare(after) > 0)
        return saved;
    return nextByDays(alarm, after);
}

// Takes one missed alarm off the list
export function forgetMissed(settings, when, name) {
    const left = settings.get_value(MISSED_KEY).deepUnpack().filter(([w, n]) => w !== when || n !== name);
    settings.set_value(MISSED_KEY, new GLib.Variant('a(xs)', left));
}

export class AlarmWatch {
    constructor(settings) {
        this._settings = settings;
        this._timeoutId = 0;
        this._lastCheck = GLib.DateTime.new_now_local();
        this._appSystem = Shell.AppSystem.get_default();
        // the next rings decided by the hub where they cannot be written to
        // GNOME Clocks (Flatpak): alarm id → ISO time, or null for off
        this._overrides = new Map();
        this.ringer = new AlarmRinger(settings, {
            stop: alarm => this._setNext(alarm, nextByDays(alarm, GLib.DateTime.new_now_local())),
            snooze: (alarm, ring) => {
                const minutes = alarm.snooze_minutes ?? DEFAULT_SNOOZE_MINUTES;
                const now = GLib.DateTime.new_now_local();
                const later = ring.add_minutes(minutes);
                this._setNext(alarm, later.compare(now) > 0 ? later : now.add_minutes(minutes));
            },
            upcoming: () => this.upcoming(),
        });
        this._source = new ClocksSource(() => this._check());
        // GNOME Clocks opened or closed: it rings, or the hub does
        this._appSystem.connectObject('app-state-changed', (_s, app) => {
            if (app.get_id() === CLOCKS_DESKTOP)
                this._check();
        }, this);
        this._check();
    }

    destroy() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        this._appSystem.disconnectObject(this);
        this.ringer.destroy();
        this._source.destroy();
        this._source = null;
    }

    // The alarms of GNOME Clocks, with the next rings the hub decided
    _alarms() {
        return this._source.read('alarms').map(alarm => {
            if (!this._overrides.has(alarm.id))
                return alarm;
            const ring = this._overrides.get(alarm.id);
            const copy = {...alarm};
            if (ring)
                copy.ring_time = ring;
            else
                delete copy.ring_time;
            return copy;
        });
    }

    // The alarms that will ring next, in order: [{name, when}]
    upcoming(count = 3) {
        const now = GLib.DateTime.new_now_local();
        return this._alarms()
            .map(alarm => ({name: alarm.name ?? '', when: nextRing(alarm, now)}))
            .filter(a => a.when)
            .sort((a, b) => a.when.compare(b.when))
            .slice(0, count);
    }

    _setNext(alarm, ring) {
        const iso = ring?.format_iso8601() ?? null;
        if (this._source.writeRingTime(alarm.id, iso))
            this._overrides.delete(alarm.id);
        else
            this._overrides.set(alarm.id, iso);
        this._check();
    }

    _clocksHasWindow() {
        return (this._appSystem.lookup_app(CLOCKS_DESKTOP)?.get_windows().length ?? 0) > 0;
    }

    _check() {
        const now = GLib.DateTime.new_now_local();
        const awake = now.difference(this._lastCheck) <= MAX_GAP_US;
        const alarms = this._alarms();
        // GNOME Clocks opened while the hub rings: it rings it itself (it
        // loads it still within its ring minutes)
        if (this._clocksHasWindow())
            this.ringer.handOver();
        // the ringer finds out whether GNOME Clocks rings it too
        for (const alarm of alarms) {
            const ring = nextRing(alarm, this._lastCheck);
            if (!ring || ring.compare(now) > 0)
                continue;
            const minutes = alarm.ring_minutes ?? DEFAULT_RING_MINUTES;
            if (awake || now.difference(ring) < minutes * 60 * 1e6)
                this.ringer.ring(alarm, ring);
            else
                this._report(alarm, ring);
        }
        this._lastCheck = now;
        this._schedule(alarms.map(a => nextRing(a, now)).filter(Boolean), now);
    }

    _report(alarm, ring) {
        const when = ring.to_unix();
        const name = alarm.name ?? '';
        const list = this._settings.get_value(MISSED_KEY).deepUnpack();
        if (!list.some(([w, n]) => w === when && n === name)) {
            list.push([when, name]);
            this._settings.set_value(MISSED_KEY, new GLib.Variant('a(xs)', list.slice(-MAX_MISSED)));
        }
    }

    // Wakes up at the next ring, or within a minute
    _schedule(rings, now) {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        if (!rings.length)
            return;
        const waits = rings.map(r => Math.ceil(r.difference(now) / 1000)).filter(ms => ms > 0);
        const ms = Math.max(1, Math.min(CHECK_MS, ...waits));
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeoutId = 0;
            this._check();
            return GLib.SOURCE_REMOVE;
        });
    }
}
