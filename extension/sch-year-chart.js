// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The year at a glance, for the place Vesperal uses: how long the day lasts
// (from sunrise to sunset, or from dawn to dusk as Vesperal counts it)
// through the year (a curve in the accent colour, from 0 to 24 hours), with
// today, the solstices and the equinoxes marked, and below the hours of
// daylight today and how far each solstice and equinox is. Computed on the
// computer (sch-astro.js).

import 'cairo'; // makes the Cairo context of St.DrawingArea usable
import GLib from 'gi://GLib';
import St from 'gi://St';

import {_} from './sch-i18n.js';
import {pageKit as kit} from './sch-page-kit.js';
import {dayLength, seasons} from './sch-astro.js';
import {logError} from './sch-log.js';

const DAY_MS = 86400000;
const HEIGHT = 110;

// "9 h 42 min"
function hours(length) {
    const minutes = Math.round(length * 60);
    return _('{hours} h {minutes} min', {hours: Math.floor(minutes / 60), minutes: minutes % 60});
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Days from today to `date` (0 = today)
function daysTo(date, today) {
    return Math.round((startOfDay(date) - today) / DAY_MS);
}

function when(days) {
    if (days === 0)
        return _('Today');
    if (days === 1)
        return _('Tomorrow');
    return _('In {days} days', {days});
}

function names() {
    return [_('March equinox'), _('June solstice'), _('September equinox'), _('December solstice')];
}

function draw(area, lengths, year, today) {
    const cr = area.get_context();
    try {
        const [w, h] = area.get_surface_size();
        const fg = area.get_theme_node().get_foreground_color(); // the accent colour (stylesheet)
        const accent = [fg.red / 255, fg.green / 255, fg.blue / 255];
        const total = lengths.length;
        const top = 4;
        const bottom = h - 4;
        const x = day => 2 + (w - 4) * day / (total - 1);
        const y = length => bottom - (bottom - top) * length / 24;
        const dayOf = date => Math.round((startOfDay(date) - new Date(year, 0, 1)) / DAY_MS);

        // 12 hours, and the months
        cr.setSourceRGBA(1, 1, 1, 0.12);
        cr.setLineWidth(1);
        cr.moveTo(2, Math.round(y(12)) + 0.5);
        cr.lineTo(w - 2, Math.round(y(12)) + 0.5);
        cr.stroke();
        for (let month = 1; month < 12; month++) {
            const mx = Math.round(x(dayOf(new Date(year, month, 1)))) + 0.5;
            cr.moveTo(mx, bottom - 3);
            cr.lineTo(mx, bottom);
        }
        cr.stroke();

        // the length of each day
        cr.moveTo(x(0), bottom);
        lengths.forEach((length, day) => cr.lineTo(x(day), y(length)));
        cr.lineTo(x(total - 1), bottom);
        cr.closePath();
        cr.setSourceRGBA(...accent, 0.22);
        cr.fillPreserve();
        cr.newPath();
        lengths.forEach((length, day) => (day ? cr.lineTo(x(day), y(length)) : cr.moveTo(x(day), y(length))));
        cr.setSourceRGBA(...accent, 1);
        cr.setLineWidth(2);
        cr.stroke();

        // solstices and equinoxes: dashed
        cr.setSourceRGBA(1, 1, 1, 0.3);
        cr.setLineWidth(1);
        cr.setDash([2, 3], 0);
        for (const season of seasons(year)) {
            const sx = Math.round(x(dayOf(season))) + 0.5;
            cr.moveTo(sx, top);
            cr.lineTo(sx, bottom);
        }
        cr.stroke();
        cr.setDash([], 0);

        // today
        const tx = x(dayOf(today));
        cr.setSourceRGBA(1, 1, 1, 0.85);
        cr.moveTo(Math.round(tx) + 0.5, top);
        cr.lineTo(Math.round(tx) + 0.5, bottom);
        cr.stroke();
        cr.arc(tx, y(lengths[dayOf(today)]), 4, 0, 2 * Math.PI);
        cr.fill();
    } catch (e) {
        logError(`year chart: ${e}`);
    } finally {
        cr.$dispose();
    }
}

// The pieces of the page; location = {name, latitude, longitude} or null;
// horizon = the sun's altitude where the day begins and ends (dayLength)
export function buildYearChart(location, horizon) {
    const pieces = [kit.section(_('The year at a glance'))];
    if (!location) {
        pieces.push(kit.empty({icon: 'find-location-symbolic', text: _('No location yet: choose one above')}));
        return pieces;
    }
    const today = startOfDay(new Date());
    const year = today.getFullYear();
    const area = new St.DrawingArea({style_class: 'sch-year-chart', height: HEIGHT, x_expand: true});
    // the length of each day of the year, at midday
    const total = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
    const lengths = Array.from({length: total}, (_v, day) => dayLength(new Date(year, 0, day + 1, 12), location.latitude, horizon));
    area.connect('repaint', () => draw(area, lengths, year, today));

    const rows = [kit.row({
        title: _('Today'),
        subtitle: location.name || '',
        trailing: kit.value(hours(dayLength(new Date(year, today.getMonth(), today.getDate(), 12), location.latitude, horizon))),
    })];
    // the next solstice and equinox of each kind, the nearest first
    const next = names().map((name, i) => {
        const date = [year, year + 1].map(y => seasons(y)[i]).find(d => daysTo(d, today) >= 0);
        return {name, date};
    }).sort((a, b) => a.date - b.date);
    for (const {name, date} of next) {
        const local = GLib.DateTime.new_from_unix_local(Math.floor(date.getTime() / 1000));
        const midday = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
        rows.push(kit.row({
            title: name,
            subtitle: `${local.format('%-d %B')} · ${hours(dayLength(midday, location.latitude, horizon))}`,
            trailing: kit.value(when(daysTo(date, today))),
        }));
    }
    pieces.push(kit.card(area, ...rows));
    return pieces;
}
