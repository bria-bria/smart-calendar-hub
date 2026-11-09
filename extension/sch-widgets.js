// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The panel as a list of widgets. Each part of the panel (tray, IP
// addresses, weather, date, calendar, "Today", notifications, world clocks)
// is a widget with an id; a profile in GSettings says in which order they
// stand. The bottom row is not a widget: it always closes the panel.

// The widgets of the hub, in their default order
export const HUB_WIDGETS = ['tray', 'ip', 'weather', 'date', 'calendar', 'today', 'notifications', 'clocks'];

// The order of the active profile (the first one if it is not found). A
// widget the profile does not name keeps its default place after the others
export function widgetOrder(settings) {
    const profiles = settings.get_value('profiles').recursiveUnpack();
    const active = settings.get_string('active-profile');
    const profile = profiles.find(p => p.id === active) ?? profiles[0];
    const named = Array.isArray(profile?.widgets) ? profile.widgets : [];
    const order = [...new Set(named)].filter(id => HUB_WIDGETS.includes(id));
    return [...order, ...HUB_WIDGETS.filter(id => !order.includes(id))];
}

// Puts the actors of each widget (id → [actors]) at the top of the box, in
// that order; whatever else the box holds comes after them
export function placeWidgets(box, widgets, order) {
    let index = 0;
    for (const id of order) {
        for (const actor of widgets.get(id) ?? []) {
            if (actor.get_parent() === box)
                box.set_child_at_index(actor, index++);
        }
    }
}
