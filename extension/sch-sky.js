// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// A small sky next to the date: the sun moves along an arc from sunrise to
// sunset, the moon from sunset to the next sunrise, drawn in its real phase.
// When the panel opens the sun or the moon travels along the arc from the
// rising point to its place (short animation), then it moves on every minute while the panel is
// open. Two settings: show-sun-moon (arc with sun and moon) and
// show-moon-phase (moon drawn in its phase; alone, it shows only the moon).

import 'cairo'; // makes the Cairo context of St.DrawingArea usable
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

const WIDTH = 120;
const HEIGHT = 62;
const SYNODIC_MONTH = 29.530588853; // days
// A known new moon: 6 January 2000, 18:14 UTC
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14);
const RISE_MS = 900; // opening animation

// Moon phase: 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter
export function moonPhase(date) {
    const days = (date.getTime() - NEW_MOON_EPOCH) / 86400000;
    const phase = (days / SYNODIC_MONTH) % 1;
    return phase < 0 ? phase + 1 : phase;
}

// Sunrise and sunset of a day (NOAA simplified formula), as Date objects,
// or null in polar day/night.
function sunTimes(date, lat, lon) {
    const rad = Math.PI / 180;
    const start = Date.UTC(date.getFullYear(), 0, 0);
    const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const n = (today - start) / 86400000;
    const gamma = 2 * Math.PI / 365 * (n - 1);
    const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) -
        0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
    const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) -
        0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) -
        0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
    const cosHa = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) -
        Math.tan(lat * rad) * Math.tan(decl);
    if (cosHa < -1 || cosHa > 1)
        return null;
    const ha = Math.acos(cosHa) / rad;
    const minutes = sign => 720 - 4 * (lon + sign * ha) - eqTime; // UTC minutes
    return {
        rise: new Date(today + minutes(1) * 60000),
        set: new Date(today + minutes(-1) * 60000),
    };
}

export class SkyView {
    constructor(weatherClient, settings) {
        this._client = weatherClient;
        this._settings = settings;
        this._timerId = 0;
        this._animId = 0;
        this._progress = 1; // opening animation, 0..1

        this.actor = new St.DrawingArea({
            style_class: 'sch-sky',
            width: WIDTH,
            height: HEIGHT,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.connect('repaint', area => this._repaint(area));
        this._settingsIds = ['show-date', 'show-sun-moon', 'show-moon-phase'].map(key =>
            settings.connect(`changed::${key}`, () => this._sync()));
        this._sync();
    }

    destroy() {
        this.stop();
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        this.actor.destroy();
    }

    _sync() {
        this._showArc = this._settings.get_boolean('show-sun-moon');
        this._showPhase = this._settings.get_boolean('show-moon-phase');
        // with the date switched off, the sky goes too (and start() runs
        // no animation or timer while hidden)
        this.actor.visible = this._settings.get_boolean('show-date') &&
            (this._showArc || this._showPhase);
        if (!this.actor.visible)
            this.stop();
        // Only the moon phase: a smaller, square area
        this.actor.width = this._showArc ? WIDTH : HEIGHT;
        this.actor.queue_repaint();
    }

    // Panel opened: the sun or the moon rises to its place, then moves every minute
    start() {
        this.stop();
        if (!this.actor.visible)
            return;
        this._progress = 0;
        const begin = GLib.get_monotonic_time();
        this._animId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const t = Math.min(1, (GLib.get_monotonic_time() - begin) / 1000 / RISE_MS);
            this._progress = 1 - (1 - t) ** 3; // ease out
            this.actor.queue_repaint();
            if (t < 1)
                return GLib.SOURCE_CONTINUE;
            this._animId = 0;
            return GLib.SOURCE_REMOVE;
        });
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this.actor.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // Panel closed: no timers while hidden
    stop() {
        if (this._animId)
            GLib.source_remove(this._animId);
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._animId = 0;
        this._timerId = 0;
        this._progress = 1;
    }

    // Sunrise/sunset of today: from GNOME Weather, else computed from its
    // coordinates, else 6:30 / 18:30.
    _todaySun(now) {
        const info = this._client?.info;
        if (info?.is_valid()) {
            try {
                const [okRise, rise] = info.get_value_sunrise();
                const [okSet, set] = info.get_value_sunset();
                if (okRise && okSet) {
                    const r = new Date(rise * 1000);
                    const s = new Date(set * 1000);
                    if (r.toDateString() === now.toDateString() && s > r)
                        return {rise: r, set: s};
                }
                const coords = info.get_location()?.get_coords?.();
                if (coords) {
                    const times = sunTimes(now, coords[0], coords[1]);
                    if (times)
                        return times;
                }
            } catch (_e) {
                // fall back to fixed times
            }
        }
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        return {rise: new Date(day + 6.5 * 3600000), set: new Date(day + 18.5 * 3600000)};
    }

    _repaint(area) {
        const cr = area.get_context();
        try {
            const [w, h] = area.get_surface_size();
            const now = new Date();
            if (this._showArc)
                this._drawArc(cr, w, h, now);
            else
                this._drawMoon(cr, w / 2, h / 2, Math.min(w, h) * 0.32, moonPhase(now));
        } catch (e) {
            console.error(`Smart Calendar Hub: sky: ${e}`);
        } finally {
            cr.$dispose();
        }
    }

    _drawArc(cr, w, h, now) {
        const base = h - 6;
        // room for the sun's halo (radius 12) at both ends and at the top
        const r = Math.min(w / 2 - 13, base - 13);
        const cx = w / 2;

        // horizon
        cr.setSourceRGBA(1, 1, 1, 0.25);
        cr.setLineWidth(1);
        cr.moveTo(4, base + 0.5);
        cr.lineTo(w - 4, base + 0.5);
        cr.stroke();

        // day or night, and how far along the arc (0 = rising, 1 = setting)
        const {rise, set} = this._todaySun(now);
        let isDay, along;
        if (now >= rise && now < set) {
            isDay = true;
            along = (now - rise) / (set - rise);
        } else {
            isDay = false;
            const lastSet = now >= set ? set : new Date(set.getTime() - 86400000);
            const nextRise = now >= set ? new Date(rise.getTime() + 86400000) : rise;
            along = (now - lastSet) / (nextRise - lastSet);
        }

        // dashed path of the day
        cr.setSourceRGBA(1, 1, 1, 0.2);
        cr.setDash([3, 4], 0);
        cr.arc(cx, base, r, Math.PI, 2 * Math.PI);
        cr.stroke();
        cr.setDash([], 0);

        // opening animation: from the rising point along the arc to its place
        const angle = Math.PI * (1 + along * this._progress);
        const x = cx + r * Math.cos(angle);
        const y = base + r * Math.sin(angle);

        if (isDay)
            this._drawSun(cr, x, y, 8);
        else
            this._drawMoon(cr, x, y, 8, this._showPhase ? moonPhase(now) : 0.5);
    }

    _drawSun(cr, x, y, r) {
        cr.setSourceRGBA(0.965, 0.827, 0.176, 0.35); // halo
        cr.arc(x, y, r + 4, 0, 2 * Math.PI);
        cr.fill();
        cr.setSourceRGBA(0.965, 0.827, 0.176, 1);
        cr.arc(x, y, r, 0, 2 * Math.PI);
        cr.fill();
    }

    // Disc of the moon, lit part according to the phase: between the limb
    // and the terminator (an ellipse whose width follows cos of the phase).
    _drawMoon(cr, x, y, r, phase) {
        cr.setSourceRGBA(1, 1, 1, 0.12);
        cr.arc(x, y, r, 0, 2 * Math.PI);
        cr.fill();

        const side = phase < 0.5 ? 1 : -1; // waxing: lit on the right
        const k = Math.cos(2 * Math.PI * phase);
        const steps = 24;
        cr.setSourceRGBA(0.87, 0.87, 0.85, 1);
        for (let i = 0; i <= steps; i++) {
            const th = -Math.PI / 2 + Math.PI * i / steps;
            const px = x + side * r * Math.cos(th);
            const py = y + r * Math.sin(th);
            if (i === 0)
                cr.moveTo(px, py);
            else
                cr.lineTo(px, py);
        }
        for (let i = steps; i >= 0; i--) {
            const th = -Math.PI / 2 + Math.PI * i / steps;
            cr.lineTo(x + side * k * r * Math.cos(th), y + r * Math.sin(th));
        }
        cr.closePath();
        cr.fill();
    }
}
