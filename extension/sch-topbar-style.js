// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The look of the top bar, kept on every screen: in the session, on the
// lock screen and on the login screen. Only styling, nothing personal:
//  - texts and icons in GNOME's accent colour (light tint or full colour)
//  - space between the icons (sch-spacing.js)
//  - on the login screen only, the clock where it is in the session (in the
//    session the full extension places it; the lock screen shows no clock)

import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {PanelSpacing} from './sch-spacing.js';

// The clock goes right before GNOME's system menu: second from the right.
// Every icon left in the top bar (clipboard, emoji, usage meters…) stays on
// its left.
export const MENU_TAIL_ROLES = ['quickSettings'];

// Where the clock goes in the top bar for the chosen position:
// {box, index} (index among the other children of the box)
export function clockSlot(mode, container) {
    if (mode === 'right-between-tray-and-menu') {
        const box = Main.panel._rightBox;
        const tails = MENU_TAIL_ROLES
            .map(r => Main.panel.statusArea[r]?.container)
            .filter(Boolean);
        const children = box.get_children().filter(c => c !== container);
        const index = children.findIndex(c => tails.includes(c));
        return {box, index: index === -1 ? children.length : index};
    }
    if (mode === 'right-before-tray')
        return {box: Main.panel._rightBox, index: 0};
    if (mode === 'left-after-menu') {
        const box = Main.panel._leftBox;
        return {box, index: box.get_children().filter(c => c !== container).length};
    }
    return {box: Main.panel._centerBox, index: 0};
}

export class TopBarStyle {
    constructor(settings) {
        this._settings = settings;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._ids = [
            [settings, settings.connect('changed::accent-top-bar', () => this._syncAccent())],
            [settings, settings.connect('changed::accent-top-bar-tone', () => this._syncAccent())],
            [this._interface, this._interface.connect('changed::accent-color', () => this._syncAccent())],
            [settings, settings.connect('changed::top-bar-position', () => this._placeClock())],
        ];
        this._spacing = new PanelSpacing(settings);
        this._clockOrigin = null;
        this._placingClock = false;
        this._loginScreen = false;
        this._syncAccent();
    }

    destroy() {
        for (const [obj, id] of this._ids)
            obj.disconnect(id);
        this._ids = [];
        this._spacing?.destroy();
        this._spacing = null;
        this._removeAccent();
        this.setLoginScreen(false);
        this._interface = null;
    }

    _removeAccent() {
        for (const name of Main.panel.get_style_class_name()?.split(/\s+/) ?? []) {
            if (name.startsWith('sch-accent'))
                Main.panel.remove_style_class_name(name);
        }
    }

    // Tone "light": the light tint of the accent colour from the GNOME
    // palette (sch-accent-light-<colour> in the stylesheet), bright on the
    // dark bar; "full": the accent colour itself (-st-accent-color), the one
    // GNOME uses behind white text, duller as a text colour.
    _syncAccent() {
        this._removeAccent();
        if (!this._settings.get_boolean('accent-top-bar'))
            return;
        if (this._settings.get_string('accent-top-bar-tone') === 'full') {
            Main.panel.add_style_class_name('sch-accent-items');
            return;
        }
        const accent = this._interface.get_string('accent-color') || 'blue';
        Main.panel.add_style_class_name(`sch-accent-light-${accent}`);
    }

    // Login screen: the clock where it is in the session. Elsewhere the
    // clock goes back where GNOME had it (in the session the full extension
    // places it itself).
    setLoginScreen(on) {
        if (on === this._loginScreen)
            return;
        this._loginScreen = on;
        if (on) {
            this._placeClock();
            this._watchBoxes();
        } else {
            this._unwatchBoxes();
            this._restoreClock();
        }
    }

    _placeClock() {
        const container = Main.panel.statusArea.dateMenu?.container;
        if (!this._loginScreen || !container || this._placingClock)
            return;
        this._placingClock = true;
        try {
            const parent = container.get_parent();
            this._clockOrigin ??= parent
                ? {parent, index: parent.get_children().indexOf(container)} : null;
            const {box, index} = clockSlot(this._settings.get_string('top-bar-position'), container);
            if (parent !== box) {
                parent?.remove_child(container);
                box.insert_child_at_index(container, index);
            } else if (box.get_children().indexOf(container) !== index) {
                box.set_child_at_index(container, index);
            }
        } catch (e) {
            console.error(`Smart Calendar Hub: cannot move the clock: ${e}`);
        } finally {
            this._placingClock = false;
        }
    }

    _restoreClock() {
        const container = Main.panel.statusArea.dateMenu?.container;
        const origin = this._clockOrigin;
        this._clockOrigin = null;
        if (!container || !origin || container.get_parent() === origin.parent)
            return;
        container.get_parent()?.remove_child(container);
        origin.parent.insert_child_at_index(container, Math.min(origin.index, origin.parent.get_n_children()));
    }

    // icons added later (e.g. the keyboard layout) may land after the clock
    _watchBoxes() {
        if (this._boxIds)
            return;
        this._boxIds = [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox]
            .map(box => [box, box.connect('child-added', () => this._placeClock())]);
    }

    _unwatchBoxes() {
        for (const [box, id] of this._boxIds ?? [])
            box.disconnect(id);
        this._boxIds = null;
    }
}
