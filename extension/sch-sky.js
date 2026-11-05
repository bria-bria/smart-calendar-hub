// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// A small sky next to the date: the sun and the moon move along an arc,
// each from its own real rising (left) to its real setting (right), both
// drawn when both are above the horizon; the moon in its real phase.
// Computed for the city shown in the weather (sch-astro.js, no network);
// without coordinates, the sun from sunrise to sunset and the moon at night.
// When the panel opens the sun or the moon travels along the arc from the
// rising point to its place (short animation), then it moves on every minute while the panel is
// open. Two settings: show-sun-moon (arc with sun and moon) and
// show-moon-phase (moon drawn in its phase; alone, it shows only the moon).

import 'cairo'; // makes the Cairo context of St.DrawingArea usable
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {MOON_HORIZON, SUN_HORIZON, moonAltitude, moonPhase, skyPass, sunAltitude} from './sch-astro.js';
import {logError} from './sch-log.js';

const WIDTH = 120;
const HEIGHT = 62;
const RISE_MS = 900; // opening animation

export class SkyView {
    // getCoords(): [latitude, longitude] in degrees of the city shown in the
    // weather, or null
    constructor(weatherClient, settings, getCoords = null) {
        this._client = weatherClient;
        this._getCoords = getCoords;
        this._skyCache = null;
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

    // Another city shown in the weather: drawn again (the cache is keyed on
    // the coordinates, so the passes are computed again only if they changed)
    refresh() {
        this.actor.queue_repaint();
    }

    // [latitude, longitude] of the city, or null
    _coords() {
        try {
            const location = this._client?.info?.get_location();
            // a location without coordinates would give 0, 0
            const coords = this._getCoords?.() ??
                (location?.has_coords?.() ? location.get_coords() : null);
            if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1]))
                return coords;
        } catch (_e) {
            // no coordinates
        }
        return null;
    }

    // Sun and moon passes for the city, computed once a minute
    _sky(now, coords) {
        const key = `${Math.floor(now.getTime() / 60000)}|${coords[0]}|${coords[1]}`;
        if (this._skyCache?.key !== key) {
            this._skyCache = {
                key,
                sun: skyPass(sunAltitude, SUN_HORIZON, now, coords[0], coords[1]),
                moon: skyPass(moonAltitude, MOON_HORIZON, now, coords[0], coords[1]),
            };
        }
        return this._skyCache;
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

    // Without coordinates: sunrise/sunset of today from GNOME Weather, else
    // 6:30 / 18:30.
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
            logError(`sky: ${e}`);
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

        // dashed path of the day
        cr.setSourceRGBA(1, 1, 1, 0.2);
        cr.setDash([3, 4], 0);
        cr.arc(cx, base, r, Math.PI, 2 * Math.PI);
        cr.stroke();
        cr.setDash([], 0);

        // a body `along` its pass (0 = rising, 1 = setting); the opening
        // animation brings it from the rising point to its place
        const place = along => {
            const angle = Math.PI * (1 + along * this._progress);
            return [cx + r * Math.cos(angle), base + r * Math.sin(angle)];
        };
        const phase = this._showPhase ? moonPhase(now) : 0.5;

        const coords = this._coords();
        if (!coords) {
            // no city: the sun from sunrise to sunset, the moon at night
            const {rise, set} = this._todaySun(now);
            if (now >= rise && now < set) {
                this._drawSun(cr, ...place((now - rise) / (set - rise)), 8);
            } else {
                const lastSet = now >= set ? set : new Date(set.getTime() - 86400000);
                const nextRise = now >= set ? new Date(rise.getTime() + 86400000) : rise;
                this._drawMoon(cr, ...place((now - lastSet) / (nextRise - lastSet)), 8, phase);
            }
            return;
        }

        // real passes: each body between its own rising and setting; both
        // when both are up (the sun drawn last, on top)
        const {sun, moon} = this._sky(now, coords);
        const along = pass => pass.rise && pass.set
            ? Math.min(1, Math.max(0, (now - pass.rise) / (pass.set - pass.rise)))
            : 0.5; // up all day (polar summer): at the top
        if (moon.up)
            this._drawMoon(cr, ...place(along(moon)), 8, phase);
        if (sun.up)
            this._drawSun(cr, ...place(along(sun)), 8);
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
