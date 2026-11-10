// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The panel as a list of widgets, without pieces of the screen (those are in
// sch-panel-widgets.js). The hub's own parts (tray, IP addresses, weather,
// date, calendar, "Today", notifications, world clocks) and the widgets
// other extensions add with addWidget() each have an id; the active profile
// in GSettings says in which order they stand and which are switched off.
// The bottom row is not a widget: it always closes the panel.
//
// A profile (sch-profiles.js) keeps the widgets in order and those switched
// off. A hub widget the profile does not name keeps its default place after
// the others and is on; a widget of another extension is on only once the
// user switched it on (it is then in `widgets` and not in `off`).

import GLib from 'gi://GLib';

import {_} from './sch-i18n.js';
import {activeProfileId, readProfile, updateProfile} from './sch-profiles.js';

// The widgets of the hub, in their default order
export const HUB_WIDGETS = ['tray', 'ip', 'weather', 'date', 'calendar', 'today', 'notifications', 'clocks'];
// Always on: the tray holds the settings button
export const FIXED_WIDGETS = ['tray'];
export const WIDGET_SIZES = ['compact', 'card', 'fill'];
const TITLES_KEY = 'widget-titles';

export function hubWidgetTitle(id) {
    switch (id) {
    case 'tray': return _('Tray icons');
    case 'ip': return _('IP addresses');
    case 'weather': return _('Weather');
    case 'date': return _('Date, sun and moon');
    case 'calendar': return _('Calendar and events');
    case 'today': return _('Today');
    case 'notifications': return _('Notifications');
    case 'clocks': return _('World clocks and alarms');
    default: return id;
    }
}

// Every widget of a profile (the one in use by default), in order:
// [{id, on}]. external: the ids other extensions added (theirs not yet in
// the profile come last, off)
export function widgetOrder(settings, external = [], profileId = null) {
    const {widgets, off} = readProfile(settings, profileId);
    const ids = [...new Set([...widgets, ...HUB_WIDGETS, ...external])];
    const offSet = new Set(off);
    return ids.map(id => ({
        id,
        on: FIXED_WIDGETS.includes(id) ||
            (!offSet.has(id) && (HUB_WIDGETS.includes(id) || widgets.includes(id))),
    }));
}

function writeOrder(settings, profileId, order) {
    updateProfile(settings, profileId ?? activeProfileId(settings), {
        widgets: order.map(w => w.id),
        off: order.filter(w => !w.on).map(w => w.id),
    });
}

export function setWidgetOn(settings, external, id, on, profileId = null) {
    if (FIXED_WIDGETS.includes(id))
        return;
    writeOrder(settings, profileId,
        widgetOrder(settings, external, profileId).map(w => (w.id === id ? {id, on} : w)));
}

// One place up (delta -1) or down (+1)
export function moveWidget(settings, external, id, delta, profileId = null) {
    const order = widgetOrder(settings, external, profileId);
    const from = order.findIndex(w => w.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length)
        return;
    [order[from], order[to]] = [order[to], order[from]];
    writeOrder(settings, profileId, order);
}

// The widgets other extensions add (addWidget), kept while the hub is on,
// also while the panel is down on the lock screen. Their titles are
// remembered, for the empty card of a widget whose extension is gone.
export class WidgetRegistry {
    constructor(settings) {
        this._settings = settings;
        this._specs = new Map();
        this.onChanged = null; // the panel, while it is there
    }

    destroy() {
        this._specs.clear();
        this.onChanged = null;
        this._settings = null;
    }

    // false when the description is not valid (see the README)
    add({id, title, build, size = 'card'} = {}) {
        if (typeof id !== 'string' || !id || HUB_WIDGETS.includes(id) || typeof build !== 'function' ||
            !WIDGET_SIZES.includes(size))
            return false;
        const name = typeof title === 'string' && title ? title : id;
        this._specs.set(id, {id, title: name, build, size});
        const titles = this._settings.get_value(TITLES_KEY).deepUnpack();
        if (titles[id] !== name)
            this._settings.set_value(TITLES_KEY, new GLib.Variant('a{ss}', {...titles, [id]: name}));
        this.onChanged?.();
        return true;
    }

    remove(id) {
        if (!this._specs.delete(id))
            return false;
        this.onChanged?.();
        return true;
    }

    get(id) {
        return this._specs.get(id) ?? null;
    }

    get ids() {
        return [...this._specs.keys()];
    }

    // The title to show for a widget, also one whose extension is gone
    title(id) {
        if (HUB_WIDGETS.includes(id))
            return hubWidgetTitle(id);
        return this._specs.get(id)?.title ?? this._settings.get_value(TITLES_KEY).deepUnpack()[id] ?? id;
    }
}
