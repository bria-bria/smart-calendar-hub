// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// World clocks at the bottom of the side panel: one analogue clock per city
// of GNOME Clocks (the same list GNOME shows), hands on the time of that
// city, the minute hand in GNOME's accent colour, a darker dial where it is
// night. Hovering a clock shows "city · time"; a click opens GNOME Clocks.
// With more clocks than room, an arrow on each side moves the view (as the
// tray). Before the clocks, the alarms and timers of GNOME Clocks: the next
// ring of each alarm, and each timer with its duration (GNOME Clocks keeps
// the countdown of a running timer to itself, it saves only the duration).
// Hidden when there is nothing to show.

import 'cairo'; // makes the Cairo context of St.DrawingArea usable
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {_} from './sch-i18n.js';

const DIAL = 34; // px, before the screen scale
const TICK_SECONDS = 30;

// "1 h", "5 min", "1 h 30", "45 s"
function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h && m)
        return `${h} h ${String(m).padStart(2, '0')}`;
    if (h)
        return `${h} h`;
    if (m)
        return `${m} min`;
    return `${seconds} s`;
}

export class WorldClocksCard {
    // onOpen(): called before GNOME Clocks is opened (closes the panel)
    constructor(onOpen) {
        this._onOpen = onOpen;
        this._clocks = []; // {name, tz, area}
        this._timerId = 0;
        this._arrowsId = 0;

        this.actor = new St.BoxLayout({style_class: 'sch-clocks-card', x_expand: true, visible: false});
        const arrow = (icon, delta, name) => {
            const btn = new St.Button({
                style_class: 'sch-tray-arrow',
                can_focus: true,
                accessible_name: name,
                y_align: Clutter.ActorAlign.CENTER,
                visible: false,
                child: new St.Icon({icon_name: icon, icon_size: 12}),
            });
            btn.connect('clicked', () => this._scrollBy(delta));
            return btn;
        };
        this._left = arrow('pan-start-symbolic', -1, _('Previous clocks'));
        this._right = arrow('pan-end-symbolic', 1, _('Next clocks'));
        this._box = new St.BoxLayout({style_class: 'sch-clocks-box', x_expand: true});
        // a spacer on each side: the clocks stay in the centre
        this._box.add_child(new St.Widget({x_expand: true}));
        this._endSpacer = new St.Widget({x_expand: true});
        this._box.add_child(this._endSpacer);
        // EXTERNAL: scrolls without a scrollbar and does not ask for the width
        // of all the clocks (NEVER would push the card wider than the panel)
        this._scroll = new St.ScrollView({
            x_expand: true,
            hscrollbar_policy: St.PolicyType.EXTERNAL,
            vscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: false,
            child: this._box,
        });
        this._scroll.connect('notify::width', () => this._syncArrows());
        for (const prop of ['value', 'upper', 'page-size'])
            this._box.hadjustment.connect(`notify::${prop}`, () => this._syncArrowEnds());
        this.actor.add_child(this._left);
        this.actor.add_child(this._scroll);
        this.actor.add_child(this._right);

        // the label "city · time", above the clock the pointer is on
        this._tip = new St.Label({style_class: 'sch-alert-tip', visible: false});
        Main.uiGroup.add_child(this._tip);

        // the dials follow the screen scale
        this._theme = St.ThemeContext.get_for_stage(global.stage);
        this._scaleId = this._theme.connect('notify::scale-factor', () => this._resize());

        this._settings = new Gio.Settings({schema_id: 'org.gnome.shell.world-clocks'});
        this._settingsId = this._settings.connect('changed::locations', () => this._load());
        // 12 or 24 hours, as GNOME's clock: AM/PM on the dials with 12 hours
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._formatId = this._interface.connect('changed::clock-format', () => {
            this._loadChips();
            this._repaintAll();
        });
        // alarms and timers: only if GNOME Clocks is installed (its schema)
        this._chips = [];
        const schema = Gio.SettingsSchemaSource.get_default()?.lookup('org.gnome.clocks', true);
        if (schema) {
            this._clocksApp = new Gio.Settings({settings_schema: schema});
            this._clocksAppIds = ['alarms', 'timers'].map(key =>
                this._clocksApp.connect(`changed::${key}`, () => this._loadChips()));
        }
        this.actor.connect('destroy', () => this._cleanup());
        this._load();
    }

    destroy() {
        this.actor.destroy();
    }

    _cleanup() {
        this.stop();
        if (this._arrowsId)
            GLib.source_remove(this._arrowsId);
        this._arrowsId = 0;
        if (this._settingsId)
            this._settings?.disconnect(this._settingsId);
        this._settingsId = 0;
        this._settings = null;
        if (this._formatId)
            this._interface?.disconnect(this._formatId);
        this._formatId = 0;
        this._interface = null;
        for (const id of this._clocksAppIds ?? [])
            this._clocksApp?.disconnect(id);
        this._clocksAppIds = [];
        this._clocksApp = null;
        if (this._scaleId)
            this._theme?.disconnect(this._scaleId);
        this._scaleId = 0;
        this._tip?.destroy();
        this._tip = null;
        this._box = null;
    }

    // Panel open: the hands follow the time; closed: no timer
    start() {
        this.stop();
        this._loadChips(); // alarms that already rang go away
        this._repaintAll();
        if (!this._clocks.length)
            return;
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TICK_SECONDS, () => {
            this._repaintAll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        this._tip?.hide();
    }

    // The cities of GNOME Clocks, from west to east
    _load() {
        for (const {button} of this._clocks)
            button.destroy();
        this._clocks = [];
        const world = GWeather.Location.get_world();
        let list = [];
        try {
            for (const serialized of this._settings.get_value('locations').deepUnpack()) {
                const loc = world.deserialize(serialized);
                const tz = loc?.get_timezone();
                if (loc && tz)
                    list.push({name: loc.get_city_name() || loc.get_name(), tz});
            }
        } catch (e) {
            console.error(`Smart Calendar Hub: world clocks: ${e}`);
        }
        const now = GLib.DateTime.new_now_utc();
        const offset = c => now.to_timezone(c.tz).get_utc_offset();
        list = list.sort((a, b) => offset(a) - offset(b));

        for (const clock of list) {
            const area = new St.DrawingArea({
                style_class: 'sch-clock-dial',
                y_align: Clutter.ActorAlign.CENTER,
            });
            area.connect('repaint', a => this._repaint(a, clock));
            // in a button: reachable with the keyboard, Enter opens GNOME Clocks
            const button = new St.Button({
                style_class: 'sch-clock-button',
                can_focus: true,
                child: area,
                accessible_name: clock.name,
            });
            button.connect('notify::hover', () => this._showTip(button, clock, button.hover));
            button.connect('key-focus-in', () => this._showTip(button, clock, true));
            button.connect('key-focus-out', () => this._showTip(button, clock, false));
            button.connect('clicked', () => this._openClocks());
            this._box.insert_child_below(button, this._endSpacer);
            this._clocks.push({...clock, area, button});
        }
        this._resize();
        this._loadChips();
    }

    // Alarms (next ring) and timers (duration) of GNOME Clocks, before the
    // clocks
    _loadChips() {
        if (!this._box)
            return;
        for (const chip of this._chips)
            chip.destroy();
        this._chips = [];
        const first = this._clocks[0]?.button ?? this._endSpacer;
        const add = (icon, text, tip) => {
            const line = new St.BoxLayout({style_class: 'sch-clock-chip-line'});
            line.add_child(new St.Icon({icon_name: icon, icon_size: 14, y_align: Clutter.ActorAlign.CENTER}));
            // never shortened ("…"): when they do not fit, the row scrolls
            // with the arrows instead
            const label = new St.Label({text, y_align: Clutter.ActorAlign.CENTER});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            line.add_child(label);
            const chip = new St.Button({
                style_class: 'sch-clock-chip',
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                child: line,
                accessible_name: tip,
            });
            const item = {name: tip};
            chip.connect('notify::hover', () => this._showTip(chip, item, chip.hover, tip));
            chip.connect('key-focus-in', () => this._showTip(chip, item, true, tip));
            chip.connect('key-focus-out', () => this._showTip(chip, item, false, tip));
            chip.connect('clicked', () => this._openClocks());
            this._box.insert_child_below(chip, first);
            this._chips.push(chip);
        };
        const now = GLib.DateTime.new_now_local();
        try {
            const alarms = this._clocksApp?.get_value('alarms').recursiveUnpack() ?? [];
            const next = alarms
                .map(a => ({name: a.name ?? '', when: a.ring_time
                    ? GLib.DateTime.new_from_iso8601(a.ring_time, null)?.to_local() : null}))
                .filter(a => a.when && a.when.compare(now) > 0)
                .sort((a, b) => a.when.compare(b.when));
            for (const alarm of next) {
                const today = alarm.when.format('%F') === now.format('%F');
                const time = this._format(alarm.when, !today);
                const tip = alarm.name
                    ? _('Alarm · {name} · {time}', {name: alarm.name, time})
                    : _('Alarm · {time}', {time});
                add('alarm-symbolic', time, tip);
            }
            const timers = this._clocksApp?.get_value('timers').recursiveUnpack() ?? [];
            for (const timer of timers) {
                const duration = formatDuration(timer.duration ?? 0);
                const tip = timer.name
                    ? _('Timer · {name} · {duration}', {name: timer.name, duration})
                    : _('Timer · {duration}', {duration});
                add('appointment-soon-symbolic', duration, tip);
            }
        } catch (e) {
            console.error(`Smart Calendar Hub: alarms and timers: ${e}`);
        }
        this.actor.visible = this._clocks.length > 0 || this._chips.length > 0;
        this._syncArrows();
    }

    _resize() {
        const size = DIAL * this._theme.scale_factor;
        for (const {area} of this._clocks)
            area.set_size(size, size);
        this._syncArrows();
    }

    _repaintAll() {
        for (const {area} of this._clocks)
            area.queue_repaint();
    }

    // GNOME Clocks, if installed (else a click does nothing)
    _openClocks() {
        const app = Shell.AppSystem.get_default().lookup_app('org.gnome.clocks.desktop');
        if (!app)
            return;
        this._onOpen?.();
        Main.overview.hide();
        app.activate();
    }

    _twelveHours() {
        return this._interface?.get_string('clock-format') === '12h';
    }

    // "17:30" or "5:30 PM", as GNOME's clock
    _format(time, withDay = false) {
        const day = withDay ? '%a ' : '';
        return time.format(this._twelveHours() ? `${day}%l:%M %p` : `${day}%H:%M`).replace(/\s+/g, ' ').trim();
    }

    _time(clock) {
        return GLib.DateTime.new_now_utc().to_timezone(clock.tz);
    }

    // text: given for alarms and timers; for a clock "city · time"
    _showTip(actor, clock, show, text = null) {
        if (!this._tip)
            return;
        if (!show) {
            this._tip.hide();
            return;
        }
        text ??= `${clock.name} · ${this._format(this._time(clock))}`;
        this._tip.text = text;
        actor.accessible_name = text;
        this._tip.show();
        const [x, y] = actor.get_transformed_position();
        const [w] = actor.get_transformed_size();
        const [, tipW] = this._tip.get_preferred_width(-1);
        const [, tipH] = this._tip.get_preferred_height(-1);
        // centred on the clock, but inside the monitor
        const monitor = Main.layoutManager.findMonitorForActor(actor) ?? Main.layoutManager.primaryMonitor;
        const left = Math.max(monitor.x + 4,
            Math.min(monitor.x + monitor.width - tipW - 4, x + w / 2 - tipW / 2));
        this._tip.set_position(Math.round(left), Math.round(y - tipH - 6));
        Main.uiGroup.set_child_above_sibling(this._tip, null);
    }

    _repaint(area, clock) {
        const cr = area.get_context();
        try {
            const [w, h] = area.get_surface_size();
            const t = this._time(clock);
            const hour = t.get_hour();
            const night = hour < 6 || hour >= 20;
            const accent = area.get_theme_node().get_foreground_color();
            const r = Math.min(w, h) / 2 - 1;
            const cx = w / 2;
            const cy = h / 2;
            // dial: lighter by day, darker at night
            if (night)
                cr.setSourceRGBA(0.16, 0.16, 0.18, 1);
            else
                cr.setSourceRGBA(1, 1, 1, 0.14);
            cr.arc(cx, cy, r, 0, 2 * Math.PI);
            cr.fillPreserve();
            cr.setSourceRGBA(1, 1, 1, 0.35);
            cr.setLineWidth(1);
            cr.stroke();
            // the four hour marks
            cr.setSourceRGBA(1, 1, 1, 0.6);
            cr.setLineWidth(1.5);
            for (let i = 0; i < 4; i++) {
                const a = i * Math.PI / 2;
                cr.moveTo(cx + Math.sin(a) * r * 0.78, cy - Math.cos(a) * r * 0.78);
                cr.lineTo(cx + Math.sin(a) * r * 0.92, cy - Math.cos(a) * r * 0.92);
            }
            cr.stroke();
            // 12 hours: AM or PM in the lower half, under the hands
            if (this._twelveHours()) {
                const layout = PangoCairo.create_layout(cr);
                const font = Pango.FontDescription.from_string('Sans Bold');
                font.set_absolute_size(r * 0.42 * Pango.SCALE);
                layout.set_font_description(font);
                layout.set_text(hour < 12 ? 'AM' : 'PM', -1);
                const [, ext] = layout.get_pixel_extents();
                cr.setSourceRGBA(1, 1, 1, 0.55);
                cr.moveTo(cx - ext.width / 2 - ext.x, cy + r * 0.32 - ext.y);
                PangoCairo.show_layout(cr, layout);
            }
            cr.setLineCap(1); // round
            // hour hand
            const hourAngle = ((hour % 12) + t.get_minute() / 60) * Math.PI / 6;
            cr.setSourceRGBA(1, 1, 1, 1);
            cr.setLineWidth(Math.max(2, r * 0.14));
            cr.moveTo(cx, cy);
            cr.lineTo(cx + Math.sin(hourAngle) * r * 0.5, cy - Math.cos(hourAngle) * r * 0.5);
            cr.stroke();
            // minute hand, in the accent colour (.sch-clock-dial colour)
            const minuteAngle = t.get_minute() * Math.PI / 30;
            cr.setSourceRGBA(accent.red / 255, accent.green / 255, accent.blue / 255, 1);
            cr.setLineWidth(Math.max(1.5, r * 0.09));
            cr.moveTo(cx, cy);
            cr.lineTo(cx + Math.sin(minuteAngle) * r * 0.78, cy - Math.cos(minuteAngle) * r * 0.78);
            cr.stroke();
            cr.setSourceRGBA(1, 1, 1, 1);
            cr.arc(cx, cy, Math.max(1.5, r * 0.08), 0, 2 * Math.PI);
            cr.fill();
        } catch (e) {
            console.error(`Smart Calendar Hub: world clock: ${e}`);
        } finally {
            cr.$dispose();
        }
    }

    // Arrows only when the clocks do not fit (checked once the layout is done)
    _syncArrows() {
        if (this._arrowsId || !this._box)
            return;
        this._arrowsId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._arrowsId = 0;
            if (!this._box || !this._scroll.get_stage())
                return GLib.SOURCE_REMOVE;
            const [, natural] = this._box.get_preferred_width(-1);
            const arrows = this._left.visible ? this._left.width + this._right.width + 8 : 0;
            const overflow = natural > this._scroll.width + arrows + 1;
            this._left.visible = overflow;
            this._right.visible = overflow;
            if (!overflow)
                this._box.hadjustment.value = 0;
            this._syncArrowEnds();
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncArrowEnds() {
        const adj = this._box?.hadjustment;
        if (!adj)
            return;
        this._left.opacity = adj.value > adj.lower + 1 ? 255 : 90;
        this._right.opacity = adj.value < adj.upper - adj.page_size - 1 ? 255 : 90;
    }

    _scrollBy(delta) {
        const adj = this._box.hadjustment;
        const first = this._clocks[0]?.button;
        const step = first?.width > 0
            ? first.width + this._box.get_theme_node().get_length('spacing') : 40;
        const target = Math.max(adj.lower, Math.min(adj.upper - adj.page_size, adj.value + delta * step));
        adj.ease(target, {duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }
}
