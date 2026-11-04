// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Calendar of the side panel: a month grid that fits the panel width, with
// coloured dots for the events of each day, and the agenda of the selected
// day below it (plus tomorrow when today is selected).
//
// Events come from GNOME's own event source (the one of the date menu, fed by
// evolution-data-server). The hidden GNOME calendar keeps asking for the month
// shown here, so both always request the same range and the source is not
// reloaded twice. Colours and names of the calendars are read once from
// evolution-data-server (org.gnome.evolution.dataserver.Sources5).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {formatDateWithCFormatString, formatTime} from 'resource:///org/gnome/shell/misc/dateUtils.js';

import {_} from './sch-i18n.js';
import {FALLBACK_COLOR, loadCalendars} from './sch-eds.js';

const MAX_DOTS = 3;
const CALENDAR_APP = 'org.gnome.Calendar.desktop';

// Command line of GNOME Calendar (package or Flatpak) without the
// placeholders of the desktop file (%U, Flatpak's @@u ... @@).
function calendarCommand() {
    const app = GioUnix.DesktopAppInfo.new(CALENDAR_APP);
    const line = app?.get_commandline();
    if (!line)
        return null;
    try {
        const [, argv] = GLib.shell_parse_argv(line);
        return argv.filter(a => !/^%[a-zA-Z]$/.test(a) && a !== '@@' && a !== '@@u');
    } catch (_e) {
        return null;
    }
}

// GNOME Calendar names events "source:uid[:recurrence]"; the calendar
// server of GNOME Shell uses "source\nuid\nrecurrence".
function calendarUuid(event) {
    return event.id.split('\n').filter(Boolean).join(':');
}

function dayBegin(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}

function capitalize(text) {
    return text ? text[0].toLocaleUpperCase() + text.slice(1) : text;
}

// The event id of GNOME's calendar server starts with the calendar's source UID
function sourceUid(event) {
    return event.id.split('\n')[0];
}

// Starts at midnight and lasts whole days
function isAllDay(event) {
    const start = event.date;
    const end = event.end;
    return start.getHours() === 0 && start.getMinutes() === 0 &&
        end.getHours() === 0 && end.getMinutes() === 0 && end > start;
}

export class CalendarView {
    constructor(dateMenu, settings) {
        this._dateMenu = dateMenu;
        this._settings = settings;
        this._selected = dayBegin(new Date());
        this._calendars = new Map(); // source UID -> {name, color}
        this._signals = [];
        this._sourceSignal = null;
        this._refreshId = 0;
        this._cancellable = new Gio.Cancellable();
        // GNOME Calendar, to open the events clicked in the agenda (null = none)
        this._calendarCmd = calendarCommand();
        // Calendars switched off (here or in GNOME Calendar): source UIDs
        this._hidden = new Set();

        this.actor = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-cal',
            x_expand: true,
        });
        this._buildMonthCard();
        this._buildAgendaCard();

        // GNOME's calendar sets today when the menu opens, and its date drives
        // the range of events requested: follow it.
        const gnomeCal = dateMenu._calendar;
        if (gnomeCal) {
            this._connect(gnomeCal, 'selected-date-changed', (_c, datetime) => {
                this._selected = dayBegin(new Date(datetime.to_unix() * 1000));
                this._queueRefresh();
            });
            this._selected = dayBegin(gnomeCal._selectedDate ?? new Date());
        }
        this.reloadCalendars();
        this.setWidth(settings.get_int('sidebar-width'));
    }

    destroy() {
        this._cancellable.cancel();
        if (this._refreshId) {
            GLib.source_remove(this._refreshId);
            this._refreshId = 0;
        }
        if (this._waitId) {
            GLib.source_remove(this._waitId);
            this._waitId = 0;
        }
        for (const [obj, id] of this._signals) {
            try {
                obj.disconnect(id);
            } catch (_e) {
                // already gone
            }
        }
        this._signals = [];
        this._sourceSignal = null;
        this._grid = null;
        this.actor.destroy();
    }

    _connect(obj, signal, callback) {
        const entry = [obj, obj.connect(signal, callback)];
        this._signals.push(entry);
        return entry;
    }

    // The date menu may replace its event source (session changes)
    _watchEventSource() {
        const source = this._dateMenu._eventSource;
        if (this._sourceSignal?.[0] === source)
            return;
        if (this._sourceSignal) {
            const [obj, id] = this._sourceSignal;
            try {
                obj.disconnect(id);
            } catch (_e) {
                // old source already destroyed
            }
            this._signals = this._signals.filter(entry => entry !== this._sourceSignal);
            this._sourceSignal = null;
        }
        if (source && typeof source.connect === 'function')
            this._sourceSignal = this._connect(source, 'changed', () => this._queueRefresh());
    }

    // Events in [begin, end) of the calendars not switched off
    _getEvents(begin, end) {
        let events;
        try {
            events = this._dateMenu._eventSource?.getEvents(begin, end) ?? [];
        } catch (_e) {
            return [];
        }
        // Skip switched-off calendars, and show only once the same event that
        // arrives from two copies of a calendar shared between accounts.
        const seen = new Set();
        return events.filter(ev => {
            if (this._hidden.has(sourceUid(ev)))
                return false;
            const key = `${ev.summary}\n${ev.date.getTime()}\n${ev.end.getTime()}`;
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
    }

    _calendarOf(event) {
        return this._calendars.get(sourceUid(event)) ?? {name: '', color: FALLBACK_COLOR};
    }

    // Names, colours and on/off of the calendars, from evolution-data-server.
    // Called again every time the panel opens, so changes made in GNOME
    // Calendar (colour, calendar switched off) show up.
    reloadCalendars() {
        this._loadCalendars().catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.error(`Smart Calendar Hub: cannot read the calendars: ${e}`);
        });
    }

    async _loadCalendars() {
        const calendars = await loadCalendars(this._cancellable);
        this._calendars = new Map(calendars.map(c => [c.uid, {name: c.name, color: c.color}]));
        this._hidden = new Set(calendars.filter(c => !c.selected).map(c => c.uid));
        this._queueRefresh();
    }

    // ------------------------------------------------------------------
    // Month card
    // ------------------------------------------------------------------

    _buildMonthCard() {
        const card = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-cal-card',
            x_expand: true,
        });
        this.actor.add_child(card);

        const header = new St.BoxLayout({style_class: 'sch-cal-header', x_expand: true});
        this._monthLabel = new St.Label({
            style_class: 'sch-cal-month',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._yearLabel = new St.Label({
            style_class: 'sch-cal-year',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._monthLabel);
        header.add_child(this._yearLabel);

        this._todayButton = new St.Button({
            style_class: 'sch-cal-today-btn',
            label: _('Today'),
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._todayButton.connect('clicked', () => this._select(new Date()));
        header.add_child(this._todayButton);

        const arrow = (icon, name, delta) => {
            const btn = new St.Button({
                style_class: 'sch-cal-arrow',
                can_focus: true,
                accessible_name: name,
                y_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({icon_name: icon, icon_size: 16}),
            });
            btn.connect('clicked', () => this._moveMonth(delta));
            header.add_child(btn);
        };
        arrow('go-previous-symbolic', _('Previous month'), -1);
        arrow('go-next-symbolic', _('Next month'), 1);
        card.add_child(header);

        // Rows of fixed-size cells (sized by setWidth): no layout manager that
        // could squeeze them, the same lesson as the tray rows.
        this._grid = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-cal-grid',
            x_align: Clutter.ActorAlign.CENTER,
        });
        card.add_child(this._grid);
    }

    _weekStart() {
        const ws = this._dateMenu._calendar?._weekStart;
        return Number.isInteger(ws) ? ws : 1;
    }

    // Same first day as GNOME's calendar (so the same range is requested)
    _gridBegin() {
        const first = new Date(this._selected.getFullYear(), this._selected.getMonth(), 1);
        const toWeekStart = (7 + first.getDay() - this._weekStart()) % 7;
        return addDays(first, -(toWeekStart === 0 ? 7 : toWeekStart));
    }

    _moveMonth(delta) {
        const y = this._selected.getFullYear();
        const m = this._selected.getMonth() + delta;
        const lastDay = new Date(y, m + 1, 0).getDate();
        this._select(new Date(y, m, Math.min(this._selected.getDate(), lastDay)));
    }

    // Selecting goes through GNOME's calendar, which requests the events of
    // the month and emits selected-date-changed back to us.
    _select(date) {
        const gnomeCal = this._dateMenu._calendar;
        if (gnomeCal)
            gnomeCal.setDate(dayBegin(date));
        this._selected = dayBegin(date);
        this._queueRefresh();
    }

    // Cell size from the panel width; week numbers when there is room
    setWidth(panelWidth) {
        // popup padding + panel box + card padding and margins
        const inner = panelWidth - 64;
        this._showWeeks = panelWidth >= 460;
        const cols = this._showWeeks ? 7.7 : 7;
        this._cell = Math.max(30, Math.floor(inner / cols));
        this._weekCell = Math.round(this._cell * 0.7);
        this._fontPx = Math.max(12, Math.min(16, Math.round(this._cell / 3.2)));
        this._queueRefresh();
    }

    // One render per main-loop iteration: the event source sends many
    // batches while loading, a day click would otherwise destroy the clicked
    // button from inside its own handler, and selecting a day emits a signal
    // that asks for a render too.
    _queueRefresh() {
        if (this._refreshId || !this._grid)
            return;
        this._refreshId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._refreshId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refresh() {
        if (!this._grid)
            return;
        this._watchEventSource();
        this._renderGrid();
        this._renderAgenda();
    }

    _renderGrid() {
        const today = new Date();
        const selected = this._selected;
        this._monthLabel.text = capitalize(formatDateWithCFormatString(selected, '%B'));
        this._yearLabel.text = formatDateWithCFormatString(selected, '%Y');
        this._todayButton.visible = !sameDay(selected, today);

        this._grid.destroy_all_children();
        const cellStyle = `width: ${this._cell}px; height: ${this._cell}px;`;
        const begin = this._gridBegin();

        // Weekday initials
        const head = new St.BoxLayout({style_class: 'sch-cal-row'});
        if (this._showWeeks)
            head.add_child(new St.Label({style_class: 'sch-cal-weekday', style: `width: ${this._weekCell}px;`}));
        for (let i = 0; i < 7; i++) {
            const name = formatDateWithCFormatString(addDays(begin, i), '%a');
            head.add_child(new St.Label({
                text: capitalize(name).slice(0, 1),
                style_class: 'sch-cal-weekday',
                style: `width: ${this._cell}px;`,
            }));
        }
        this._grid.add_child(head);

        for (let w = 0; w < 6; w++) {
            const row = new St.BoxLayout({style_class: 'sch-cal-row'});
            if (this._showWeeks) {
                row.add_child(new St.Label({
                    // ISO week of the row's Thursday, like GNOME's calendar
                    text: formatDateWithCFormatString(
                        addDays(begin, w * 7 + (4 - this._weekStart() + 7) % 7), '%V'),
                    style_class: 'sch-cal-weeknum',
                    style: `width: ${this._weekCell}px; height: ${this._cell}px;`,
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }
            for (let d = 0; d < 7; d++)
                row.add_child(this._dayCell(addDays(begin, w * 7 + d), today, cellStyle));
            this._grid.add_child(row);
        }
    }

    _dayCell(date, today, cellStyle) {
        const classes = ['sch-cal-day'];
        const isToday = sameDay(date, today);
        if (date.getMonth() !== this._selected.getMonth())
            classes.push('sch-cal-other');
        if (date.getDay() === 0 || date.getDay() === 6)
            classes.push('sch-cal-weekend');
        if (isToday)
            classes.push('sch-cal-today');
        else if (sameDay(date, this._selected))
            classes.push('sch-cal-selected');

        const btn = new St.Button({
            style_class: classes.join(' '),
            style: cellStyle,
            can_focus: true,
            accessible_name: formatDateWithCFormatString(date, '%A %-d %B %Y'),
        });
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(new St.Label({
            text: String(date.getDate()),
            style_class: 'sch-cal-daynum',
            style: `font-size: ${this._fontPx}px;`,
            x_align: Clutter.ActorAlign.CENTER,
        }));

        // One dot per calendar with events that day (at most MAX_DOTS)
        const colors = [];
        for (const ev of this._getEvents(date, addDays(date, 1))) {
            const color = this._calendarOf(ev).color;
            if (!colors.includes(color))
                colors.push(color);
            if (colors.length === MAX_DOTS)
                break;
        }
        const dots = new St.BoxLayout({style_class: 'sch-cal-dots', x_align: Clutter.ActorAlign.CENTER});
        for (const color of colors) {
            dots.add_child(new St.Widget({
                style_class: 'sch-cal-dot',
                style: isToday ? '' : `background-color: ${color};`,
            }));
        }
        box.add_child(dots);
        btn.set_child(box);
        btn.connect('clicked', () => this._select(date));
        return btn;
    }

    // ------------------------------------------------------------------
    // Agenda card
    // ------------------------------------------------------------------

    _buildAgendaCard() {
        this._agenda = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-cal-card sch-cal-agenda',
            x_expand: true,
        });
        this.actor.add_child(this._agenda);
    }

    _renderAgenda() {
        this._agenda.destroy_all_children();
        const day = this._selected;
        const events = this._getEvents(day, addDays(day, 1));

        const title = new St.BoxLayout({style_class: 'sch-cal-agenda-title'});
        title.add_child(new St.Label({
            text: capitalize(formatDateWithCFormatString(day, '%A %-d %B')),
            style_class: 'sch-cal-agenda-day',
            y_align: Clutter.ActorAlign.END,
        }));
        title.add_child(new St.Label({
            text: events.length === 1
                ? _('1 event')
                : _('{count} events', {count: events.length}),
            style_class: 'sch-cal-agenda-count',
            y_align: Clutter.ActorAlign.END,
        }));
        this._agenda.add_child(title);

        if (events.length === 0) {
            this._agenda.add_child(new St.Label({
                text: _('No events'),
                style_class: 'sch-cal-empty',
            }));
        }
        for (const ev of events)
            this._agenda.add_child(this._eventRow(ev, day));

        // Tomorrow too, when looking at today
        if (sameDay(day, new Date())) {
            const tomorrow = addDays(day, 1);
            const next = this._getEvents(tomorrow, addDays(tomorrow, 1));
            if (next.length > 0) {
                this._agenda.add_child(new St.Label({
                    text: _('Tomorrow'),
                    style_class: 'sch-cal-agenda-sub',
                }));
                for (const ev of next)
                    this._agenda.add_child(this._eventRow(ev, tomorrow));
            }
        }
    }

    // One line per event: colour bar, time column, title (cut with "…"),
    // calendar name only if there is room left.
    _eventRow(ev, day) {
        const cal = this._calendarOf(ev);
        const row = new St.BoxLayout({x_expand: true, style_class: 'sch-cal-event-line'});
        row.add_child(new St.Widget({
            style_class: 'sch-cal-event-bar',
            style: `background-color: ${cal.color};`,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        let when;
        if (isAllDay(ev)) {
            when = _('All day');
        } else {
            // Start of the part of the event that falls on this day
            when = ev.date < day ? '…' : formatTime(ev.date, {timeOnly: true});
        }
        row.add_child(new St.Label({
            text: when,
            style_class: isAllDay(ev) ? 'sch-cal-event-allday' : 'sch-cal-event-time',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const title = new St.Label({
            text: ev.summary || _('(no title)'),
            style_class: 'sch-cal-event-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.add_child(title);

        if (cal.name && this._showWeeks) {
            row.add_child(new St.Label({
                text: cal.name,
                style_class: 'sch-cal-event-source',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        // The whole line opens the event in GNOME Calendar, when installed
        const button = new St.Button({
            style_class: 'sch-cal-event',
            x_expand: true,
            can_focus: true,
            reactive: this._calendarCmd !== null,
            child: row,
        });
        button.connect('clicked', () => this._openInCalendar(ev));
        return button;
    }

    get hasCalendarApp() {
        return this._calendarCmd !== null;
    }

    // Opens GNOME Calendar and its "new event" window. The action belongs to
    // the Calendar window, so wait for the window to exist on
    // D-Bus (up to 10 s: a Flatpak cold start is slow), then activate
    // win.new-event on the newest one.
    async openNewEvent() {
        if (!this._calendarCmd)
            return;
        try {
            Gio.Subprocess.new(this._calendarCmd, Gio.SubprocessFlags.NONE);
            for (let i = 0; i < 40; i++) {
                await this._wait(250);
                const win = await this._calendarWindow();
                if (win) {
                    await Gio.DBus.session.call('org.gnome.Calendar', win, 'org.gtk.Actions',
                        'Activate', new GLib.Variant('(sava{sv})', ['new-event', [], {}]),
                        null, Gio.DBusCallFlags.NONE, -1, this._cancellable);
                    return;
                }
            }
            console.error('Smart Calendar Hub: GNOME Calendar window not found');
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.error(`Smart Calendar Hub: cannot open a new event: ${e}`);
        }
    }

    _wait(ms) {
        return new Promise(resolve => {
            this._waitId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._waitId = 0;
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    // D-Bus path of the newest GNOME Calendar window, or null
    async _calendarWindow() {
        try {
            const reply = await Gio.DBus.session.call('org.gnome.Calendar',
                '/org/gnome/Calendar/window', 'org.freedesktop.DBus.Introspectable',
                'Introspect', null, new GLib.VariantType('(s)'), Gio.DBusCallFlags.NONE,
                1000, this._cancellable);
            const [xml] = reply.deepUnpack();
            const ids = [...xml.matchAll(/<node name="(\d+)"/g)].map(m => Number(m[1]));
            return ids.length ? `/org/gnome/Calendar/window/${Math.max(...ids)}` : null;
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            return null; // Calendar still starting
        }
    }

    _openInCalendar(ev) {
        if (!this._calendarCmd)
            return;
        try {
            Gio.Subprocess.new([...this._calendarCmd, `--uuid=${calendarUuid(ev)}`],
                Gio.SubprocessFlags.NONE);
            this._dateMenu.menu.close();
        } catch (e) {
            console.error(`Smart Calendar Hub: cannot open GNOME Calendar: ${e}`);
        }
    }

}
