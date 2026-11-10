// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The page of an alarm ringing, in the card beside the panel (the look
// approved by Michele, privato/mockup/sveglia.html): the alarm icon and the
// time on one line, the name, Snooze (its minutes under the word) and Stop,
// the next alarms, a button that opens GNOME Clocks. Esc stops it too.

import 'cairo'; // makes the Cairo context of St.DrawingArea usable
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {_} from './sch-i18n.js';
import {formatTime} from './sch-alarm-ringer.js';
import {logError} from './sch-log.js';

const ICON_SIZE = 60; // px before the screen scale, as tall as the digits look

// The alarm clock, drawn in the colour of the text: dial with its hands, two
// bells on top, two feet (the shapes of a 24 px symbolic icon, scaled)
function alarmIcon() {
    const area = new St.DrawingArea({style_class: 'sch-alarm-icon', y_align: Clutter.ActorAlign.CENTER});
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    area.set_size(ICON_SIZE * scale, ICON_SIZE * scale);
    area.connect('repaint', () => {
        const cr = area.get_context();
        try {
            const [w] = area.get_surface_size();
            const u = w / 24;
            const color = area.get_theme_node().get_foreground_color();
            cr.setSourceRGBA(color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255);
            cr.setLineWidth(1.8 * u);
            cr.setLineCap(1); // round
            cr.setLineJoin(1);
            cr.arc(12 * u, 13 * u, 7 * u, 0, 2 * Math.PI);
            cr.stroke();
            cr.moveTo(12 * u, 9.5 * u);
            cr.lineTo(12 * u, 13 * u);
            cr.lineTo(14.6 * u, 14.6 * u);
            cr.stroke();
            cr.arc(7.2 * u, 7.2 * u, 4 * u, Math.PI, 1.5 * Math.PI);
            cr.stroke();
            cr.arc(16.8 * u, 7.2 * u, 4 * u, 1.5 * Math.PI, 2 * Math.PI);
            cr.stroke();
            cr.moveTo(7.6 * u, 19.2 * u);
            cr.lineTo(6.2 * u, 21 * u);
            cr.moveTo(16.4 * u, 19.2 * u);
            cr.lineTo(17.8 * u, 21 * u);
            cr.stroke();
        } catch (e) {
            logError(`alarm icon: ${e}`);
        } finally {
            cr.$dispose();
        }
    });
    return area;
}

// "today 18:00", "tomorrow 17:40", "Thu 07:00"
function whenText(when) {
    const now = GLib.DateTime.new_now_local();
    const time = formatTime(when);
    const day = d => d.format('%F');
    if (day(when) === day(now))
        return _('today {time}', {time});
    if (day(when) === day(now.add_days(1)))
        return _('tomorrow {time}', {time});
    return _('{day} {time}', {day: when.format('%a'), time});
}

function label(text, styleClass, props = {}) {
    return new St.Label({text, style_class: styleClass, ...props});
}

// ringer: sch-alarm-ringer.js, ringing; openClocks(): opens GNOME Clocks
export function buildAlarmPage(ringer, openClocks) {
    const {alarm, ring} = ringer.current;
    const page = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'sch-alarm',
        x_expand: true,
        reactive: true,
    });

    // icon and time on one line, never broken
    const timeline = new St.BoxLayout({style_class: 'sch-alarm-timeline', x_align: Clutter.ActorAlign.CENTER});
    timeline.add_child(alarmIcon());
    timeline.add_child(label(formatTime(ring), 'sch-alarm-time', {y_align: Clutter.ActorAlign.CENTER}));
    page.add_child(timeline);
    if (alarm.name)
        page.add_child(label(alarm.name, 'sch-alarm-name', {x_align: Clutter.ActorAlign.CENTER}));

    const actions = new St.BoxLayout({style_class: 'sch-alarm-actions', x_expand: true});
    // "Snooze" with its minutes under it: number and "min" never apart
    const snoozeBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_align: Clutter.ActorAlign.CENTER});
    snoozeBox.add_child(label(_('Snooze'), 'sch-alarm-word', {x_align: Clutter.ActorAlign.CENTER}));
    snoozeBox.add_child(label(_('{minutes} min', {minutes: ringer.snoozeMinutes}), 'sch-alarm-minutes',
        {x_align: Clutter.ActorAlign.CENTER}));
    const snooze = new St.Button({style_class: 'sch-alarm-button', x_expand: true, can_focus: true, child: snoozeBox,
        accessible_name: _('Snooze {minutes} min', {minutes: ringer.snoozeMinutes})});
    snooze.connect('clicked', () => ringer.snooze());
    const stop = new St.Button({style_class: 'sch-alarm-button sch-alarm-stop', x_expand: true, can_focus: true,
        child: label(_('Stop'), 'sch-alarm-word', {x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER})});
    stop.connect('clicked', () => ringer.stop());
    actions.add_child(snooze);
    actions.add_child(stop);
    page.add_child(actions);

    const upcoming = ringer.upcoming();
    if (upcoming.length) {
        page.add_child(label(_('Next alarms').toLocaleUpperCase(), 'sch-alarm-section'));
        for (const {name, when} of upcoming) {
            const row = new St.BoxLayout({style_class: 'sch-alarm-next', x_expand: true});
            row.add_child(label(name || _('Alarm'), 'sch-alarm-next-name', {x_expand: true}));
            row.add_child(label(whenText(when), 'sch-alarm-next-when'));
            page.add_child(row);
        }
    }

    const openLine = new St.BoxLayout({style_class: 'sch-alarm-open-line', x_align: Clutter.ActorAlign.CENTER});
    openLine.add_child(new St.Icon({icon_name: 'preferences-system-time-symbolic', fallback_icon_name: 'alarm-symbolic',
        icon_size: 16, y_align: Clutter.ActorAlign.CENTER}));
    openLine.add_child(label(_('Open GNOME Clocks'), null, {y_align: Clutter.ActorAlign.CENTER}));
    const open = new St.Button({style_class: 'sch-alarm-open', x_expand: true, can_focus: true, child: openLine});
    open.connect('clicked', () => openClocks());
    page.add_child(open);

    page.connect('key-press-event', (_page, event) => {
        if (event.get_key_symbol() !== Clutter.KEY_Escape)
            return Clutter.EVENT_PROPAGATE;
        ringer.stop();
        return Clutter.EVENT_STOP;
    });
    page.stopButton = stop;
    return page;
}
