// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// GNOME's "Today" card (the events of the day), above the notifications.
// GNOME keeps it on today every time the panel opens; here it can be
// switched off, its click opens the calendar beside the panel instead of
// GNOME Calendar, and "All Day" moves next to the title.

import Gettext from 'gettext';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {_} from './sch-i18n.js';
import {Connections} from './sch-signals.js';

export class TodayCard {
    constructor(panel) {
        this._panel = panel;
        this._dateMenu = panel.dateMenu;
        this._settings = panel.settings;
        this._signals = new Connections();
        const dm = this._dateMenu;
        this.actor = new St.Bin({style_class: 'sch-today-events', x_expand: true});
        panel.adopt(dm._eventsItem, this.actor);
        // Its click opens the calendar beside the panel instead of an app:
        // the handler runs before GNOME's own (vfunc_clicked) and stops it.
        if (dm._eventsItem) {
            this._signals.connect(dm._eventsItem, 'clicked', () => {
                GObject.signal_stop_emission_by_name(dm._eventsItem, 'clicked');
                // our settings in the card: the calendar takes their place
                const side = panel.side;
                if (side.hubSettingsOpen) {
                    side.closeHubSettings();
                    side.setCalendarSide(true);
                    return;
                }
                side.setCalendarSide(!side.calendarSide);
            });
        }
        // Under an event that lasts the whole day GNOME writes "All Day" on a
        // line of its own: moved next to the title (see syncAllDay). GNOME
        // builds the list again on every change: each new row is checked as
        // it arrives.
        const eventsList = dm._eventsItem?._eventsList;
        if (eventsList) {
            this._allDayText = Gettext.domain('gnome-shell').pgettext('event list time', 'All Day');
            this._signals.connect(eventsList, 'child-added', () => this.syncAllDay());
            this.syncAllDay();
        }
        this._signals.connect(this._settings, 'changed::show-today-events', () => this.sync());
        this.sync();
    }

    destroy() {
        this._signals.disconnectAll();
        this.syncAllDay(false);
    }

    // GNOME's "Today" card: not while the calendar is open in the panel
    // (the calendar has its own list of the day's events)
    sync() {
        this.actor.visible = !!this._dateMenu._eventsItem &&
            this._settings.get_boolean('show-today-events') &&
            !this._panel.calendarExpanded;
    }

    // "All Day" of the Today card moved up: next to "Today" ("Today · All
    // Day") when every event of the day lasts the whole day, otherwise next
    // to the name of those events; their own "All Day" line goes. With
    // on = false everything goes back as GNOME wrote it.
    syncAllDay(on = true) {
        const item = this._dateMenu._eventsItem;
        const list = item?._eventsList;
        const title = item?._title;
        if (!list || !title || !this._allDayText)
            return;
        // ours, longer than GNOME's short "All Day": there is room on this line
        const suffix = ` · ${_('The whole day')}`;
        const rows = [];
        for (const box of list.get_children()) {
            // with no events the list holds GNOME's "No Events" label, whose
            // child is a plain Clutter.Text (no style classes)
            const labels = box.get_children();
            const time = labels.find(l => l.has_style_class_name?.('event-time'));
            const summary = labels.find(l => l.has_style_class_name?.('event-summary'));
            if (time && summary)
                rows.push({time, summary, allDay: time.text === this._allDayText});
        }
        const every = on && rows.length > 0 && rows.every(r => r.allDay);
        const base = title.text.endsWith(suffix) ? title.text.slice(0, -suffix.length) : title.text;
        title.text = every ? base + suffix : base;
        for (const {time, summary, allDay} of rows) {
            const name = summary.text.endsWith(suffix) ? summary.text.slice(0, -suffix.length) : summary.text;
            summary.text = on && allDay && !every ? name + suffix : name;
            time.visible = !(on && allDay);
        }
    }
}
