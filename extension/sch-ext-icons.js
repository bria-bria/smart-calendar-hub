// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The top bar icons of two extensions we work with, changed on request and
// given back as they were: Vesperal's icon hidden (its menu opens from our
// sun and moon), Freon's button with one thermometer.

import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Vesperal (extensions.gnome.org/extension/11329): with it installed, a click
// on our sun and moon opens its menu (dawn, sunset, day length) in the panel
export const VESPERAL_ROLE = 'vesperal@kornifex.github.io';

// Freon (extensions.gnome.org/extension/841): its button shows an icon and a
// temperature for each chosen sensor; on request, one thermometer instead
export const FREON_ROLE = 'freonMenu';
const FREON_UUID = 'freon@UshakovVasilii_Github.yahoo.com';

export class ExtIcons {
    constructor(settings) {
        this._settings = settings;
        this._hiddenVesperal = null;
        this._freonIcon = null;
        this._freonHidden = null;
        this.sync();
    }

    // Also when other extensions add their icons to the top bar
    sync() {
        this._syncVesperal();
        this._syncFreon();
    }

    destroy() {
        this._showVesperal();
        this._unsetFreon();
    }

    // Vesperal's own icon next to the clock, hidden on request: its menu
    // still opens from our sun and moon. Followed when Vesperal is turned on
    // later (its icon arrives in the top bar).
    _syncVesperal() {
        const container = Main.panel.statusArea[VESPERAL_ROLE]?.container ?? null;
        if (!this._settings.get_boolean('vesperal-hide-icon') || container !== this._hiddenVesperal)
            this._showVesperal();
        if (container && this._settings.get_boolean('vesperal-hide-icon')) {
            container.hide();
            this._hiddenVesperal = container;
        }
    }

    _showVesperal() {
        // shown again only if it is still Vesperal's (not destroyed with it)
        if (this._hiddenVesperal && Main.panel.statusArea[VESPERAL_ROLE]?.container === this._hiddenVesperal)
            this._hiddenVesperal.show();
        this._hiddenVesperal = null;
    }

    // Freon's button with one thermometer (its own icon) instead of an icon
    // and a temperature per sensor, which crowd a tray cell. Its pieces are
    // only hidden: they come back when switched off.
    _syncFreon() {
        const indicator = Main.panel.statusArea[FREON_ROLE] ?? null;
        const want = !!indicator && this._settings.get_boolean('freon-single-icon');
        if (this._freonIcon && (!want || this._freonIcon.get_parent() !== indicator))
            this._unsetFreon();
        if (!want || this._freonIcon)
            return;
        const icon = new St.Icon({style_class: 'system-status-icon', icon_name: 'temperature-symbolic'});
        const path = Main.extensionManager.lookup(FREON_UUID)?.path;
        if (path)
            icon.gicon = Gio.icon_new_for_string(`${path}/icons/freon-temperature-symbolic.svg`);
        this._freonHidden = indicator.get_children();
        for (const child of this._freonHidden)
            child.hide();
        // first: a top bar button lays out only its first child (ButtonBox)
        indicator.insert_child_at_index(icon, 0);
        this._freonIcon = icon;
        // Freon switched off: its button goes, and our icon with it
        icon.connect('destroy', () => {
            this._freonIcon = null;
            this._freonHidden = null;
        });
    }

    _unsetFreon() {
        const icon = this._freonIcon;
        if (!icon)
            return;
        for (const child of this._freonHidden ?? [])
            child.show();
        icon.destroy();
        this._freonIcon = null;
        this._freonHidden = null;
    }
}
