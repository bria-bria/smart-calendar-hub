// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Notes the alarms of GNOME Clocks that could not ring. GNOME Clocks checks
// its alarms from its window: with no window open, an alarm passes in
// silence, and the next time it starts it only moves the alarm on. So, while
// the session is on (also with the screen locked), at the time of each alarm
// that is on: no window of GNOME Clocks means a missed alarm, saved in
// GSettings until it is clicked away in the world clocks card. Nothing is
// known of the time the computer was off, asleep or at the login screen, and
// nothing is reported for it.

import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {CLOCKS_DESKTOP, ClocksSource} from './sch-clocks-source.js';

export const MISSED_KEY = 'missed-alarms';
const MAX_MISSED = 10;
const CHECK_MS = 60000; // at least once a minute: the wait stops during a suspend
const MAX_GAP_US = 90 * 1e6; // longer between two checks: we were asleep
const DEFAULT_RING_MINUTES = 5;

// The next ring of an alarm after a moment (GLib.DateTime), null if none.
// GNOME Clocks saves the next ring only while its window is open, so the one
// saved can be long past: an alarm with days of the week still rings on them
export function nextRing(alarm, after) {
    if (!alarm.ring_time)
        return null; // switched off
    const saved = GLib.DateTime.new_from_iso8601(alarm.ring_time, null)?.to_local();
    if (saved && saved.compare(after) > 0)
        return saved;
    const days = alarm.days ?? [];
    if (!days.length)
        return null; // rings once: that was it
    for (let i = 0; i <= 7; i++) {
        const day = after.add_days(i);
        const ring = GLib.DateTime.new_local(day.get_year(), day.get_month(),
            day.get_day_of_month(), alarm.hour ?? 0, alarm.minute ?? 0, 0);
        if (ring.compare(after) > 0 && days.includes(ring.get_day_of_week()))
            return ring;
    }
    return null;
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
        // missed but still able to ring, if GNOME Clocks is opened in time:
        // {when (s), name, until (s)}
        this._lateChance = [];
        this._source = new ClocksSource(() => this._check());
        this._check();
    }

    destroy() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        this._source.destroy();
        this._source = null;
    }

    _clocksHasWindow() {
        return (this._appSystem.lookup_app(CLOCKS_DESKTOP)?.get_windows().length ?? 0) > 0;
    }

    _check() {
        const now = GLib.DateTime.new_now_local();
        const awake = now.difference(this._lastCheck) <= MAX_GAP_US;
        const alarms = this._source.read('alarms');
        const hasWindow = this._clocksHasWindow();

        if (awake && !hasWindow) {
            for (const alarm of alarms) {
                const ring = nextRing(alarm, this._lastCheck);
                if (ring && ring.compare(now) <= 0)
                    this._report(alarm, ring);
            }
        }

        // opened within the minutes an alarm rings for, GNOME Clocks still
        // rings it: not missed after all
        const seconds = now.to_unix();
        this._lateChance = this._lateChance.filter(l => l.until > seconds);
        if (hasWindow) {
            this._lateChance.forEach(l => forgetMissed(this._settings, l.when, l.name));
            this._lateChance = [];
        }

        this._lastCheck = now;
        this._schedule(alarms, now);
    }

    _report(alarm, ring) {
        const when = ring.to_unix();
        const name = alarm.name ?? '';
        const list = this._settings.get_value(MISSED_KEY).deepUnpack();
        if (!list.some(([w, n]) => w === when && n === name)) {
            list.push([when, name]);
            this._settings.set_value(MISSED_KEY, new GLib.Variant('a(xs)', list.slice(-MAX_MISSED)));
        }
        // an older ring_time cannot ring: GNOME Clocks only skips it
        const saved = GLib.DateTime.new_from_iso8601(alarm.ring_time, null)?.to_unix();
        if (saved === when) {
            const minutes = alarm.ring_minutes ?? DEFAULT_RING_MINUTES;
            this._lateChance.push({when, name, until: when + minutes * 60});
        }
    }

    // Wakes up at the next ring, or within a minute
    _schedule(alarms, now) {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        const rings = alarms.map(a => nextRing(a, now)).filter(Boolean);
        if (!rings.length && !this._lateChance.length)
            return;
        const waits = rings.map(r => Math.ceil(r.difference(now) / 1000));
        const ms = Math.max(1, Math.min(CHECK_MS, ...waits));
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeoutId = 0;
            this._check();
            return GLib.SOURCE_REMOVE;
        });
    }
}
