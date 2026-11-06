// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The menu of an app shown inside the panel, made to look like part of it:
// the same sizes for every app. Everything changed is noted in the visit
// (sch-panel-pages.js) and put back by untidy() when the visit ends; a piece
// the app destroys meanwhile leaves those notes on its 'destroy'.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {logError} from './sch-log.js';

// What a card of an app loses inside our panel (see clearCards)
const CARD_CLEAR = 'background-color: transparent; border-color: transparent; box-shadow: none;';

// Called again while the visit lasts: the apps rebuild parts of their menu
export function tidy(shown) {
    prefillSubmenus(shown);
    passSubmenuScroll(shown);
    // the extension styles itself inside the hub
    if (shown.hub?.keepStyle)
        return;
    clearCards(shown);
    alignItems(shown);
    leftAlignLabels(shown);
}

export function untidy(shown) {
    for (const [widget, {style, id}] of shown.cleared) {
        widget.disconnect(id);
        widget.set_style(style);
    }
    for (const [view, {wheel, id}] of shown.wheel ?? []) {
        view.disconnect(id);
        view.enable_mouse_scrolling = wheel;
    }
    for (const [label, id] of shown.centred ?? []) {
        label.disconnect(id);
        label.x_align = Clutter.ActorAlign.CENTER;
    }
    for (const [ornament, id] of shown.ornaments) {
        ornament.disconnect(id);
        ornament.show();
    }
}

// Some apps centre the name of their items (Freon: the sensors, between
// the icon and the value): in the panel it starts at the left, like the
// items of every other app. Put back at the end of the visit.
function leftAlignLabels(shown) {
    if (!shown.box)
        return;
    shown.centred ??= new Map();
    const visit = actor => {
        for (const child of actor.get_children()) {
            if (actor instanceof PopupMenu.PopupBaseMenuItem && child instanceof St.Label &&
                child.x_expand && child.x_align === Clutter.ActorAlign.CENTER && !shown.centred.has(child)) {
                shown.centred.set(child, child.connect('destroy', () => shown.centred.delete(child)));
                child.x_align = Clutter.ActorAlign.START;
            }
            visit(child);
        }
    };
    visit(shown.box);
}

// Some apps (Qt ones, e.g. KTailctl) leave a sub-menu empty until they
// are told it is about to open; AppIndicator tells them only once the
// sub-menu is open, and GNOME never opens an empty sub-menu: so it never
// opens. Inside the panel we tell them first, once per visit, so the
// sub-menu is filled before the click. Only through the item's own
// AppIndicator object, when it has one; nothing else is touched.
function prefillSubmenus(shown) {
    if (!shown.box)
        return;
    shown.prefilled ??= new Set();
    const visit = menu => {
        for (const item of menu?._getMenuItems?.() ?? []) {
            if (item instanceof PopupMenu.PopupMenuSection) {
                visit(item);
                continue;
            }
            const sub = item.menu;
            if (!sub)
                continue;
            const dbus = item._dbusItem;
            if (sub.isEmpty?.() && typeof dbus?.sendAboutToShow === 'function' &&
                !shown.prefilled.has(dbus)) {
                shown.prefilled.add(dbus);
                try {
                    dbus.sendAboutToShow()?.catch?.(() => {});
                } catch (e) {
                    logError(`tray sub-menu: ${e}`);
                }
            }
            visit(sub);
        }
    };
    visit(shown.menu);
}

// GNOME keeps room before every item for a check mark or a dot, even in
// a menu that has none: then that room goes, so every app starts at the
// same edge. With one mark anywhere in the menu, it stays for all (the
// items stay aligned with each other).
function alignItems(shown) {
    const roots = [shown.box ?? shown.page, shown.side?.page].filter(Boolean);
    if (!roots.length)
        return;
    const ornaments = [];
    const visit = actor => {
        for (const child of actor.get_children()) {
            if (child instanceof St.Icon && child.has_style_class_name('popup-menu-ornament'))
                ornaments.push(child);
            else
                visit(child);
        }
    };
    roots.forEach(visit);
    const marked = ornaments.some(o => o.icon_name && (o.visible || shown.ornaments.has(o)));
    for (const ornament of ornaments) {
        if (marked && shown.ornaments.has(ornament)) {
            ornament.disconnect(shown.ornaments.get(ornament));
            shown.ornaments.delete(ornament);
            ornament.show();
        } else if (!marked && ornament.visible) {
            ornament.hide();
            // hidden by us: shown again at the end, unless destroyed
            shown.ornaments.set(ornament, ornament.connect('destroy', () => shown.ornaments.delete(ornament)));
        }
    }
}

// The backgrounds the app draws inside its menu become transparent, so
// the menu looks like part of ours: every container that is not clickable
// (cards, the tracks of the bars) and any larger empty area. What shows a
// value keeps its colour: the filled part of a bar, small tags ("WPA2"),
// buttons and the items of the menu. Backgrounds painted by the app's own
// drawing code (e.g. a graph) cannot be reached from outside.
function clearCards(shown) {
    const roots = [shown.box ?? shown.page, shown.side?.page].filter(Boolean);
    if (!roots.length)
        return;
    const visit = actor => {
        for (const child of actor.get_children()) {
            if (child instanceof St.Widget && !shown.cleared.has(child) && isCard(child)) {
                // a piece the app destroys meanwhile leaves the list
                const id = child.connect('destroy', () => shown.cleared.delete(child));
                shown.cleared.set(child, {style: child.get_style(), id});
                child.set_style(`${child.get_style() ?? ''}; ${CARD_CLEAR}`.replace(/^; /, ''));
            }
            visit(child);
        }
    };
    roots.forEach(visit);
}

// A sub-menu is a scroll view of its own, sized for a floating menu: in
// our card it gets all its height and our card scrolls, so its mouse
// wheel is passed on (otherwise a long list, e.g. the temperatures of
// Freon, takes the wheel and moves nothing)
function passSubmenuScroll(shown) {
    const root = shown.box ?? shown.page;
    if (!root)
        return;
    shown.wheel ??= new Map();
    const visit = actor => {
        for (const child of actor.get_children()) {
            if (child instanceof St.ScrollView && child.has_style_class_name('popup-sub-menu') &&
                !shown.wheel.has(child)) {
                const id = child.connect('destroy', () => shown.wheel.delete(child));
                shown.wheel.set(child, {wheel: child.enable_mouse_scrolling, id});
                child.enable_mouse_scrolling = false;
            }
            visit(child);
        }
    };
    visit(root);
}

function isCard(widget) {
    if (widget.reactive || widget instanceof St.Button)
        return false;
    const container = widget.get_children().some(c => c instanceof St.Widget);
    if (!container && (widget.height < 24 || widget instanceof St.Label || widget instanceof St.Icon))
        return false;
    const classes = widget.get_style_class_name() ?? '';
    // the pieces of our page kit already have the panel's look
    if (/popup-menu-item|popup-sub-menu|button|toggle|slider|switch|sch-kit-/.test(classes))
        return false;
    // the knob of a switch (GNOME's Switch: a plain 'handle' inside a
    // 'toggle-switch'): clearing it would leave a switch without knob
    if (widget.get_parent()?.has_style_class_name?.('toggle-switch'))
        return false;
    const node = widget.get_theme_node();
    return node.get_background_color().alpha > 0 ||
        node.get_border_width(St.Side.TOP) > 0 || node.get_box_shadow() !== null;
}
