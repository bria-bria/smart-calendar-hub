// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Where the sun and the moon are, computed on the computer (no network):
// altitude above the horizon for a place and a time, rising and setting
// around now, and the moon phase from the real angle between moon and sun.
// Low-precision formulas (mean orbits plus the main terms): rise and set
// times within a few minutes, enough for the small sky next to the date.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J2000 = Date.UTC(2000, 0, 1, 12); // 1 January 2000, 12:00 UTC
const OBLIQUITY = 23.4397 * RAD;

// Altitude of the centre at rising/setting, in degrees: the sun's upper
// limb with refraction; the moon with refraction, semidiameter and parallax
export const SUN_HORIZON = -0.833;
export const MOON_HORIZON = 0.125;

const days = date => (date.getTime() - J2000) / DAY_MS;

function equatorial(lon, lat) {
    return {
        ra: Math.atan2(Math.sin(lon) * Math.cos(OBLIQUITY) - Math.tan(lat) * Math.sin(OBLIQUITY),
            Math.cos(lon)),
        dec: Math.asin(Math.sin(lat) * Math.cos(OBLIQUITY) +
            Math.cos(lat) * Math.sin(OBLIQUITY) * Math.sin(lon)),
    };
}

// ecliptic longitude of the sun (radians)
function sunLongitude(d) {
    const m = (357.5291 + 0.98560028 * d) * RAD; // mean anomaly
    const centre = (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)) * RAD;
    // the perihelion moves on 1.72° a century (0.45° from 2000 to 2026)
    return m + centre + (102.9372 + 0.0000471 * d) * RAD + Math.PI;
}

// ecliptic longitude and latitude of the moon (radians), main terms
function moonEcliptic(d) {
    const l = (218.316 + 13.176396 * d) * RAD; // mean longitude
    const m = (134.963 + 13.064993 * d) * RAD; // mean anomaly
    const f = (93.272 + 13.22935 * d) * RAD; // mean distance from the node
    const ms = (357.5291 + 0.98560028 * d) * RAD; // sun's mean anomaly
    const dd = (297.8502 + 12.19074912 * d) * RAD; // mean elongation
    const lon = l + (6.289 * Math.sin(m) + 1.274 * Math.sin(2 * dd - m) +
        0.658 * Math.sin(2 * dd) + 0.214 * Math.sin(2 * m) - 0.186 * Math.sin(ms)) * RAD;
    const lat = 5.128 * RAD * Math.sin(f);
    return {lon, lat};
}

function altitude(ra, dec, d, latitude, longitude) {
    const sidereal = (280.16 + 360.9856235 * d) * RAD + longitude * RAD;
    const hour = sidereal - ra;
    const phi = latitude * RAD;
    return Math.asin(Math.sin(phi) * Math.sin(dec) +
        Math.cos(phi) * Math.cos(dec) * Math.cos(hour)) / RAD;
}

// Altitude in degrees of the centre of the body at a date and place
export function sunAltitude(date, latitude, longitude) {
    const d = days(date);
    const {ra, dec} = equatorial(sunLongitude(d), 0);
    return altitude(ra, dec, d, latitude, longitude);
}

export function moonAltitude(date, latitude, longitude) {
    const d = days(date);
    const {lon, lat} = moonEcliptic(d);
    const {ra, dec} = equatorial(lon, lat);
    return altitude(ra, dec, d, latitude, longitude);
}

// Moon phase: 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter,
// from the angle between the moon and the sun along the ecliptic
export function moonPhase(date) {
    const d = days(date);
    const angle = (moonEcliptic(d).lon - sunLongitude(d)) / (2 * Math.PI);
    return ((angle % 1) + 1) % 1;
}

// Hours of daylight (sunrise to sunset; from dawn to dusk with the depth
// of the twilight as `horizon`, e.g. -6) on the day of `date` at
// `latitude`, from the sun's declination at that moment: 0 in the polar
// night, 24 in the polar day
export function dayLength(date, latitude, horizon = SUN_HORIZON) {
    const dec = equatorial(sunLongitude(days(date)), 0).dec;
    const phi = latitude * RAD;
    const cosHour = (Math.sin(horizon * RAD) - Math.sin(phi) * Math.sin(dec)) /
        (Math.cos(phi) * Math.cos(dec));
    if (cosHour >= 1)
        return 0;
    if (cosHour <= -1)
        return 24;
    return 2 * Math.acos(cosHour) / RAD / 15;
}

// The March equinox, June solstice, September equinox and December
// solstice of `year` (Dates): when the sun reaches ecliptic longitude 0°,
// 90°, 180° and 270°, found by halving a window of days around each
export function seasons(year) {
    const starts = [[2, 20], [5, 21], [8, 22], [11, 21]]; // month (0-11), usual day
    return starts.map(([month, day], i) => {
        const target = i * Math.PI / 2;
        // the angle from the target, between -π and π: it goes from < 0 to > 0
        const offset = t => {
            const a = (sunLongitude(days(new Date(t))) - target) % (2 * Math.PI);
            return ((a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        };
        let a = Date.UTC(year, month, day) - 4 * DAY_MS;
        let b = a + 8 * DAY_MS;
        for (let k = 0; k < 30; k++) {
            const m = (a + b) / 2;
            if (offset(m) < 0)
                a = m;
            else
                b = m;
        }
        return new Date((a + b) / 2);
    });
}

// The pass of the body across the sky around `now`:
// {up, rise, set} — up: above the horizon now; rise/set: the last rising
// and the next setting when up, the next rising and its setting when down
// (Date, or null when not found within a day and a half: polar day/night).
// Found by stepping every 10 minutes and refining the crossing.
export function skyPass(altitudeOf, horizon, now, latitude, longitude) {
    const STEP = 10 * 60000;
    const SPAN = 36 * 3600000;
    const above = t => altitudeOf(new Date(t), latitude, longitude) - horizon;
    const refine = (a, b) => {
        let fa = above(a);
        for (let i = 0; i < 12; i++) {
            const m = (a + b) / 2;
            const fm = above(m);
            if ((fa > 0) === (fm > 0)) {
                a = m;
                fa = fm;
            } else {
                b = m;
            }
        }
        return new Date((a + b) / 2);
    };
    // first crossing from `from` going forward (dir 1) or backward (dir -1)
    const crossing = (from, dir, rising) => {
        let t = from;
        let f = above(t);
        for (let s = 0; s < SPAN / STEP; s++) {
            const next = t + dir * STEP;
            const fn = above(next);
            const goesUp = dir > 0 ? f <= 0 && fn > 0 : fn <= 0 && f > 0;
            const goesDown = dir > 0 ? f > 0 && fn <= 0 : fn > 0 && f <= 0;
            if (rising ? goesUp : goesDown)
                return dir > 0 ? refine(t, next) : refine(next, t);
            t = next;
            f = fn;
        }
        return null;
    };
    const t = now.getTime();
    const up = above(t) > 0;
    if (up)
        return {up, rise: crossing(t, -1, true), set: crossing(t, 1, false)};
    const rise = crossing(t, 1, true);
    return {up, rise, set: rise ? crossing(rise.getTime(), 1, false) : null};
}
