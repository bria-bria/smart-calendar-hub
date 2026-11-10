// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The profiles on the settings button, nothing else in the panel: its label
// names the profile in use (and whether it is locked), its colour is the
// profile's, and a right click opens the short list of the profiles, with
// "Lock on this profile". A left click still opens the settings.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {_} from './sch-i18n.js';
import {Connections} from './sch-signals.js';
import {colorValue, profileList, readProfile, setActiveProfile} from './sch-profiles.js';

export class ProfileSwitch {
    constructor(panel, gear, menuManager) {
        this._settings = panel.settings;
        this._gear = gear;
        this._menuManager = menuManager;
        this._signals = new Connections();
        gear.button_mask = St.ButtonMask.ONE | St.ButtonMask.THREE;

        this._tip = new St.Label({style_class: 'sch-alert-tip', visible: false, reactive: false});
        Main.uiGroup.add_child(this._tip);
        this._signals.connect(gear, 'notify::hover', () => this._syncTip(gear.hover));
        this._signals.connect(gear, 'key-focus-in', () => this._syncTip(true));
        this._signals.connect(gear, 'key-focus-out', () => this._syncTip(false));

        this._menu = new PopupMenu.PopupMenu(gear, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        menuManager.addMenu(this._menu);
        // (GNOME opens no empty menu: filled before)
        this._signals.connect(gear, 'clicked', (_b, button) => {
            if (button !== Clutter.BUTTON_SECONDARY)
                return;
            this._tip.hide();
            if (!this._menu.isOpen)
                this._fillMenu();
            this._menu.toggle();
        });

        for (const key of ['profiles', 'active-profile', 'profile-locked'])
            this._signals.connect(this._settings, `changed::${key}`, () => this.sync());
        this.sync();
    }

    destroy() {
        this._signals.disconnectAll();
        this._menuManager?.removeMenu(this._menu);
        this._menu?.destroy();
        this._menu = null;
        this._tip?.destroy();
        this._tip = null;
        if (this._gear) {
            this._gear.button_mask = St.ButtonMask.ONE;
            this._gear.child.style = null;
        }
        this._gear = null;
    }

    // The gear went with the panel (logout): only what is outside it is ours
    forget() {
        this._gear = null;
        this._menuManager = null;
        this.destroy();
    }

    // "Settings" alone with only one profile
    _label() {
        if (profileList(this._settings).length < 2)
            return _('Settings');
        const {name} = readProfile(this._settings);
        return this._settings.get_boolean('profile-locked')
            ? _('Settings · profile {name} (locked)', {name})
            : _('Settings · profile {name}', {name});
    }

    sync() {
        const color = colorValue(readProfile(this._settings).color);
        this._gear.child.style = color ? `color: ${color};` : null;
        this._gear.accessible_name = this._label();
        if (this._tip.visible)
            this._syncTip(true);
    }

    // Under the gear, kept inside its monitor
    _syncTip(show) {
        if (!show || this._menu.isOpen) {
            this._tip.hide();
            return;
        }
        this._tip.text = this._label();
        Main.uiGroup.set_child_above_sibling(this._tip, null);
        this._tip.show();
        const [x, y] = this._gear.get_transformed_position();
        const [w, h] = this._gear.get_transformed_size();
        const monitor = Main.layoutManager.findMonitorForActor(this._gear) ?? Main.layoutManager.primaryMonitor;
        const [, tipWidth] = this._tip.get_preferred_width(-1);
        const left = Math.min(Math.max(x + (w - tipWidth) / 2, monitor.x + 4), monitor.x + monitor.width - tipWidth - 4);
        this._tip.set_position(Math.floor(left), Math.floor(y + h + 6));
    }

    _fillMenu() {
        this._menu.removeAll();
        const active = readProfile(this._settings).id;
        for (const {id, name} of profileList(this._settings)) {
            const item = new PopupMenu.PopupMenuItem(name);
            item.setOrnament(id === active ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            item.connect('activate', () => setActiveProfile(this._settings, id));
            this._menu.addMenuItem(item);
        }
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const lock = new PopupMenu.PopupSwitchMenuItem(_('Lock on this profile'),
            this._settings.get_boolean('profile-locked'));
        lock.connect('toggled', (_item, on) => this._settings.set_boolean('profile-locked', on));
        this._menu.addMenuItem(lock);
    }
}
