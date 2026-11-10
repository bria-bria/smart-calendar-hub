// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The bottom row of the panel: the three buttons of the profile in use
// (sch-profiles.js), of the same shape and width; by default world clocks ·
// New event · Clear. With the calendar open only "New event" (the world
// clocks too when there is no Calendar app). World clocks and Clear are
// GNOME's own buttons, given back as they were; the other actions have
// buttons of ours. Each of the three may be in the row once.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {_} from './sch-i18n.js';
import {Connections} from './sch-signals.js';
import {actionKind, actionLabel, readProfile} from './sch-profiles.js';
import {UPDATES_SECTION} from './sch-updates.js';

// Buttons side by side show only their icon, and their text appears above
// it on hover; the icon follows the width of its button (the panel can be
// made wider), in steps that keep it sharp. A button alone in the row (the
// calendar open) shows a small icon and its text.
// Sizes the themes draw (also the coloured icons of apps stay sharp)
const ICON_STEPS = [[150, 48], [125, 40], [100, 32], [0, 24]];
const TEXT_ICON_SIZE = 16;
const TEXT_FROM = 200; // px of a button alone: narrower, its icon only

function iconSizeFor(width) {
    return ICON_STEPS.find(([min]) => width >= min)[1];
}

// A thin room above and below the icon, in proportion to it: the icon fills
// about 70% of the height of its button
function buttonStyle(size) {
    const room = Math.round(size * 0.2);
    return `padding-top: ${room}px; padding-bottom: ${room}px; min-height: ${size}px;`;
}

const ACTION_ICONS = {
    'hub-settings': 'emblem-system-symbolic',
    'hub-updates': 'software-update-available-symbolic',
    'hub-profiles': 'view-list-symbolic',
};

export class BottomRow {
    constructor(panel) {
        this._panel = panel;
        this._dateMenu = panel.dateMenu;
        this._signals = new Connections();
        this._calendarOpen = false;
        this._compact = false;
        this._iconSize = iconSizeFor(0);
        // the text of a button shown as an icon only, above it on hover
        this._tip = new St.Label({style_class: 'sch-alert-tip', visible: false, reactive: false});
        Main.uiGroup.add_child(this._tip);
        this._slots = []; // the actors of the row, in the order of the profile
        this._own = []; // our buttons for the other actions
        const dm = this._dateMenu;
        this.actor = new St.BoxLayout({style_class: 'sch-bottom-row', x_expand: true});
        if (dm._clocksItem) {
            this._clocksOrig = {x_expand: dm._clocksItem.x_expand, visible: dm._clocksItem.visible, width: -1};
            dm._clocksItem.x_expand = true;
            dm._clocksItem.add_style_class_name('sch-bottom-btn');
            // in a box of ours: GNOME drives the button's own visibility
            // (only with world clocks), we hide the box when the profile
            // does not show it or the calendar is open
            this._clocksBox = new St.Bin({x_expand: true});
            this.actor.add_child(this._clocksBox);
            panel.adopt(dm._clocksItem, this._clocksBox);
            this._signals.connect(dm._clocksItem, 'notify::visible', () => this.layout());
            this._watchTip(dm._clocksItem, () => _('World clocks'));
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
        this._newEventIcon = new St.Icon({icon_name: 'list-add-symbolic', icon_size: TEXT_ICON_SIZE});
        newEventLine.add_child(this._newEventIcon);
        this._newEventLabel = new St.Label({text: _('New event'), y_align: Clutter.ActorAlign.CENTER});
        newEventLine.add_child(this._newEventLabel);
        this._newEventButton.set_child(newEventLine);
        this._newEventButton.connect('clicked', () => {
            dm.menu.close();
            panel.calendarView.openNewEvent();
        });
        this._watchTip(this._newEventButton, () => _('New event'));
        this._signals.connect(dm.menu, 'open-state-changed', () => this._tip?.hide());
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
            this._watchTip(clear, () => _('Clear notifications'));
        }
        this._notifications = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._signals.connect(this._notifications, 'changed::show-banners', () => this._syncDnd());
        for (const key of ['profiles', 'active-profile'])
            this._signals.connect(panel.settings, `changed::${key}`, () => this.sync());
        this.sync();
    }

    // The buttons of the profile in use, in its order
    sync() {
        this._own.forEach(button => button.destroy());
        this._own = [];
        this._dndButton = null;
        const used = new Set();
        this._slots = [];
        for (const action of readProfile(this._panel.settings).buttons) {
            const kind = actionKind(action);
            // GNOME's buttons and "New event" exist once
            if (['clocks', 'new-event', 'clear'].includes(kind) && used.has(kind))
                continue;
            used.add(kind);
            const actor = this._actorFor(action);
            if (actor)
                this._slots.push({kind, actor});
        }
        // the row in that order; what the profile leaves out stays hidden
        this._slots.forEach(({actor}, index) => this.actor.set_child_at_index(actor, index));
        this._syncDnd();
        this.setCalendarOpen(this._calendarOpen);
    }

    _actorFor(action) {
        switch (actionKind(action)) {
        case 'clocks': return this._clocksBox ?? null;
        case 'new-event': return this._newEventButton;
        case 'clear': return this._clearBox ?? null;
        case 'app': {
            const app = Shell.AppSystem.get_default().lookup_app(action.slice('app:'.length));
            return app ? this._ownButton(app.get_name(), app.get_icon(), () => {
                this._dateMenu.menu.close();
                app.activate();
            }) : null;
        }
        case 'hub-settings':
            return this._ownButton(actionLabel(action), ACTION_ICONS[action],
                () => this._panel.side.toggleHubSettings());
        case 'hub-updates':
            return this._panel.updates?.settingsEntry ? this._ownButton(actionLabel(action), ACTION_ICONS[action],
                () => this._panel.side.toggleHubPage(UPDATES_SECTION)) : null;
        case 'hub-profiles':
            return this._ownButton(actionLabel(action), ACTION_ICONS[action],
                () => this._panel.side.toggleHubPage('profiles'));
        case 'dnd': {
            this._dndButton = this._ownButton(actionLabel(action), 'notifications-disabled-symbolic', () => {
                const banners = this._notifications.get_boolean('show-banners');
                this._notifications.set_boolean('show-banners', !banners);
            });
            return this._dndButton;
        }
        default:
            return null;
        }
    }

    // A button of ours: icon and text (only the icon when the row is narrow)
    _ownButton(text, icon, onClick) {
        const line = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, style_class: 'sch-bottom-line'});
        const image = new St.Icon({
            gicon: typeof icon === 'string' ? new Gio.ThemedIcon({name: icon}) : icon,
            icon_size: this._compact ? this._iconSize : TEXT_ICON_SIZE,
        });
        line.add_child(image);
        const label = new St.Label({text, y_align: Clutter.ActorAlign.CENTER, visible: !this._compact});
        line.add_child(label);
        const button = new St.Button({
            style_class: 'sch-bottom-btn',
            x_expand: true,
            can_focus: true,
            accessible_name: text,
            child: line,
        });
        button.schLabel = label;
        button.schIcon = image;
        button.connect('clicked', onClick);
        // ours go with the button, rebuilt at each change of profile
        button.connect('notify::hover', () => this._showTip(button, text));
        this.actor.add_child(button);
        this._own.push(button);
        return button;
    }

    // GNOME's buttons and "New event" (disconnected in destroy())
    _watchTip(button, text) {
        this._signals.connect(button, 'notify::hover', () => this._showTip(button, text()));
    }

    // The text of a button above it, while the pointer is on it and the row
    // shows only icons
    _showTip(button, text) {
        if (!this._tip)
            return;
        if (!button.hover || !this._compact) {
            this._tip.hide();
            return;
        }
        this._tip.text = text;
        Main.uiGroup.set_child_above_sibling(this._tip, null);
        this._tip.show();
        const [x, y] = button.get_transformed_position();
        const [w] = button.get_transformed_size();
        const [, tipWidth] = this._tip.get_preferred_width(-1);
        const [, tipHeight] = this._tip.get_preferred_height(-1);
        const monitor = Main.layoutManager.findMonitorForActor(button) ?? Main.layoutManager.primaryMonitor;
        const left = Math.min(Math.max(x + (w - tipWidth) / 2, monitor.x + 4), monitor.x + monitor.width - tipWidth - 4);
        this._tip.set_position(Math.floor(left), Math.floor(y - tipHeight - 6));
    }

    // Do not disturb: lit up while the banners are off
    _syncDnd() {
        if (!this._dndButton || !this._own.includes(this._dndButton))
            return;
        if (this._notifications.get_boolean('show-banners'))
            this._dndButton.remove_style_class_name('sch-bottom-btn-on');
        else
            this._dndButton.add_style_class_name('sch-bottom-btn-on');
    }

    // GNOME's buttons as they were; called once they are back in their
    // places (the panel puts the widgets it took back first)
    destroy() {
        this._signals.disconnectAll();
        this._own.forEach(button => button.destroy());
        this._own = [];
        this._dndButton = null;
        this._notifications = null;
        this._setCompact(false); // texts back on GNOME's buttons
        if (this._clearButton) {
            this._clearButton.remove_style_class_name('sch-clear-button');
            this._clearButton.remove_style_class_name('sch-bottom-btn');
            Object.assign(this._clearButton, this._clearOrig);
            this._clearButton.set_style(null);
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
            clocks.set_style(null);
        }
        this._tip.destroy();
        this._tip = null;
    }

    retranslate() {
        this._newEventLabel.text = _('New event');
        this.sync();
    }

    // Calendar open: only "New event" (also when the profile does not show
    // it); "Clear" is about the notifications
    setCalendarOpen(open) {
        this._calendarOpen = open;
        const hasApp = this._panel.calendarView.hasCalendarApp;
        const shows = kind => this._slots.some(slot => slot.kind === kind);
        const calendar = open && hasApp;
        this._newEventButton.visible = hasApp && (shows('new-event') || calendar);
        if (this._clocksBox)
            this._clocksBox.visible = shows('clocks') && !calendar;
        if (this._clearBox)
            this._clearBox.visible = shows('clear') && !open;
        for (const button of this._own)
            button.visible = !calendar;
        this.layout();
    }

    // The visible buttons of the bottom row share its width equally
    layout() {
        const items = [];
        for (const child of this.actor.get_children()) {
            if (!child.visible)
                continue;
            if (child === this._clearBox) {
                if (this._clearButton?.visible)
                    items.push(this._clearButton);
            } else if (child === this._clocksBox) {
                if (this._dateMenu._clocksItem.visible)
                    items.push(this._dateMenu._clocksItem);
            } else {
                items.push(child);
            }
        }
        if (!items.length)
            return;
        // panel padding (4) + row margins (8), 6 px between buttons
        const inner = this._panel.geometry.sidebarWidth() - 12;
        const width = Math.floor((inner - 6 * (items.length - 1)) / items.length);
        // icons only, side by side or too narrow for the text (the text stays
        // as accessible name and on hover); a button alone with its text is as
        // tall as one with a 32 px icon
        const compact = items.length > 1 || width < TEXT_FROM;
        const size = iconSizeFor(width);
        for (const item of items) {
            item.width = width;
            item.set_style(buttonStyle(compact ? size : 32));
        }
        this._setCompact(compact, size);
    }

    // size: of an icon alone in a button
    _setCompact(compact, size = this._iconSize) {
        this._compact = compact;
        this._iconSize = size;
        const withText = compact ? size : TEXT_ICON_SIZE;
        for (const button of this._own) {
            button.schLabel.visible = !compact;
            button.schIcon.icon_size = withText;
        }
        this._newEventLabel.visible = !compact;
        this._newEventIcon.icon_size = withText;
        this._newEventButton.accessible_name = _('New event');
        if (!compact)
            this._tip?.hide();
        const clear = this._clearButton;
        if (clear) {
            if (compact && !this._clearLabel) {
                this._clearLabel = clear.label;
                clear.child = new St.Icon({icon_name: 'edit-clear-all-symbolic', icon_size: size});
            } else if (compact) {
                clear.child.icon_size = size;
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
            clocks.child = new St.Icon({icon_name: 'network-workgroup-symbolic', icon_size: size});
            clocks.accessible_name = _('World clocks');
        } else if (clocks) {
            clocks.child.icon_size = size;
        }
    }
}
