// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The bottom row of the panel, three buttons of the same shape and width:
// world clocks · New event · Clear. With the calendar open only "New event"
// (the world clocks too when there is no Calendar app). Two of them are
// GNOME's own buttons, given back as they were.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {_} from './sch-i18n.js';
import {Connections} from './sch-signals.js';

export class BottomRow {
    constructor(panel) {
        this._panel = panel;
        this._dateMenu = panel.dateMenu;
        this._signals = new Connections();
        const dm = this._dateMenu;
        this.actor = new St.BoxLayout({style_class: 'sch-bottom-row', x_expand: true});
        if (dm._clocksItem) {
            this._clocksOrig = {x_expand: dm._clocksItem.x_expand, visible: dm._clocksItem.visible, width: -1};
            dm._clocksItem.x_expand = true;
            dm._clocksItem.add_style_class_name('sch-bottom-btn');
            panel.adopt(dm._clocksItem, this.actor);
        }
        // "New event" (GNOME Calendar), in the middle; alone when the
        // calendar is open. Hidden when GNOME Calendar is not installed.
        this._newEventButton = new St.Button({
            style_class: 'sch-new-event sch-bottom-btn',
            x_expand: true,
            can_focus: true,
            visible: panel.calendarView.hasCalendarApp,
        });
        const newEventLine = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
        newEventLine.add_child(new St.Icon({icon_name: 'list-add-symbolic', icon_size: 16}));
        this._newEventLabel = new St.Label({text: _('New event'), y_align: Clutter.ActorAlign.CENTER});
        newEventLine.add_child(this._newEventLabel);
        this._newEventButton.set_child(newEventLine);
        this._newEventButton.connect('clicked', () => {
            dm.menu.close();
            panel.calendarView.openNewEvent();
        });
        this.actor.add_child(this._newEventButton);
        const clear = dm._messageList?._clearButton;
        if (clear) {
            this._clearButton = clear;
            // width -1 = back to its natural width
            this._clearOrig = {x_expand: clear.x_expand, x_align: clear.x_align, width: -1};
            clear.x_expand = false;
            clear.x_align = Clutter.ActorAlign.FILL;
            clear.add_style_class_name('sch-clear-button');
            clear.add_style_class_name('sch-bottom-btn');
            // In a box of ours: GNOME drives the button's own visibility (only
            // with notifications), we hide the box while the calendar is open.
            this._clearBox = new St.Bin({style_class: 'sch-clear-box'});
            this.actor.add_child(this._clearBox);
            panel.adopt(clear, this._clearBox);
            // GNOME shows "Clear" only with notifications: share the row again
            this._signals.connect(clear, 'notify::visible', () => this.layout());
        }
    }

    // GNOME's buttons as they were; called once they are back in their
    // places (the panel puts the widgets it took back first)
    destroy() {
        this._signals.disconnectAll();
        this._setCompact(false); // texts back on GNOME's buttons
        if (this._clearButton) {
            this._clearButton.remove_style_class_name('sch-clear-button');
            this._clearButton.remove_style_class_name('sch-bottom-btn');
            Object.assign(this._clearButton, this._clearOrig);
        }
        if (this._clocksOrig) {
            const clocks = this._dateMenu._clocksItem;
            // GNOME's own content back (it was an icon in our row)
            if (this._clocksGrid) {
                clocks.child = this._clocksGrid;
                clocks.accessible_name = this._clocksAccessible;
            }
            clocks.remove_style_class_name('sch-bottom-btn');
            Object.assign(clocks, this._clocksOrig);
        }
    }

    retranslate() {
        this._newEventLabel.text = _('New event');
    }

    // Calendar open: only "New event"; "Clear" is about the notifications
    setCalendarOpen(open) {
        const hasApp = this._panel.calendarView.hasCalendarApp;
        this._newEventButton.visible = hasApp;
        if (this._clocksOrig)
            this._dateMenu._clocksItem.visible = !(open && hasApp);
        if (this._clearBox)
            this._clearBox.visible = !open;
        this.layout();
    }

    // The visible buttons of the bottom row share its width equally
    layout() {
        const items = [];
        if (this._clocksOrig && this._dateMenu._clocksItem.visible)
            items.push(this._dateMenu._clocksItem);
        if (this._newEventButton.visible)
            items.push(this._newEventButton);
        if (this._clearBox?.visible && this._clearButton?.visible)
            items.push(this._clearButton);
        if (!items.length)
            return;
        // panel padding (4) + row margins (8), 6 px between buttons
        const inner = this._panel.geometry.sidebarWidth() - 12;
        const width = Math.floor((inner - 6 * (items.length - 1)) / items.length);
        for (const item of items)
            item.width = width;
        // Too narrow for the text: icons instead (the text stays as accessible name)
        this._setCompact(width < 130);
    }

    _setCompact(compact) {
        const clear = this._clearButton;
        if (clear) {
            if (compact && !this._clearLabel) {
                this._clearLabel = clear.label;
                clear.child = new St.Icon({icon_name: 'edit-clear-all-symbolic', icon_size: 16});
            } else if (!compact && this._clearLabel) {
                clear.label = this._clearLabel;
                this._clearLabel = null;
            }
        }
        // GNOME's world clocks button: always an icon (the clocks themselves
        // are in their own card above); a click opens GNOME Clocks
        const clocks = this._clocksOrig ? this._dateMenu._clocksItem : null;
        if (clocks && !this._clocksGrid) {
            this._clocksGrid = clocks.child;
            this._clocksAccessible = clocks.accessible_name;
            clocks.child = new St.Icon({icon_name: 'network-workgroup-symbolic', icon_size: 16});
            clocks.accessible_name = _('World clocks');
        }
    }
}
