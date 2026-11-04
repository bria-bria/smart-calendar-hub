// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// A combo row bound to a string key with a fixed list of values.
function comboRow(settings, key, title, subtitle, options) {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(options.map(([, label]) => label)),
    });
    const sync = () => {
        const i = options.findIndex(([value]) => value === settings.get_string(key));
        if (i !== -1 && row.selected !== i)
            row.selected = i;
    };
    sync();
    row.connect('notify::selected', () => {
        const value = options[row.selected]?.[0];
        if (value && value !== settings.get_string(key))
            settings.set_string(key, value);
    });
    // keep in sync with the quick options inside the panel
    const id = settings.connect(`changed::${key}`, sync);
    row.connect('destroy', () => settings.disconnect(id));
    return row;
}

export default class SmartCalendarHubPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: 'Smart Calendar Hub',
            icon_name: 'x-office-calendar-symbolic',
        });
        window.add(page);

        const position = new Adw.PreferencesGroup({
            title: _('Position'),
            description: _('Where the side panel opens, where the clock sits in the top bar and which icons are gathered inside the panel.'),
        });
        page.add(position);

        position.add(comboRow(settings, 'sidebar-side',
            _('Panel side'),
            _('Side of the screen where the panel appears when you click the clock'),
            [
                ['right', _('Right edge of the screen')],
                ['left', _('Left edge of the screen')],
                ['button', _('Under the clock button')],
            ]));

        position.add(comboRow(settings, 'top-bar-position',
            _('Clock in the top bar'),
            _('Position of the clock and temperature in the GNOME top bar'),
            [
                ['right-between-tray-and-menu', _('Right, between tray icons and system menu')],
                ['right-before-tray', _('Right, before tray icons')],
                ['left-after-menu', _('Left, after the menus')],
                ['center', _('Center (GNOME default)')],
            ]));

        position.add(comboRow(settings, 'tray-mode',
            _('Icons inside the panel'),
            _('Top bar icons moved to the top of the panel'),
            [
                ['all-tray', _('Tray icons of applications')],
                ['all-right-icons', _('All icons on the right side')],
                ['disabled', _('None, leave them in the top bar')],
            ]));

        const tboRow = new Adw.SwitchRow({
            title: _('Keep Top Bar Organizer in sync'),
            subtitle: _('Also writes the clock position into the Top Bar Organizer extension settings; the previous order is restored when Smart Calendar Hub is turned off'),
        });
        settings.bind('sync-top-bar-organizer', tboRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        position.add(tboRow);

        const look = new Adw.PreferencesGroup({
            title: _('Panel'),
            description: _('From top to bottom: tray icons, title, weather, date, calendar, notifications, world clocks.'),
        });
        page.add(look);

        const collapseRow = new Adw.SwitchRow({
            title: _('Calendar collapsed on opening'),
            subtitle: _('Click “Calendar and events” to open it'),
        });
        settings.bind('calendar-collapsed', collapseRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(collapseRow);

        const widthRow = new Adw.SpinRow({
            title: _('Panel width (pixels)'),
            adjustment: new Gtk.Adjustment({
                lower: 320,
                upper: 520,
                step_increment: 10,
                page_increment: 20,
            }),
        });
        settings.bind('sidebar-width', widthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        look.add(widthRow);
    }
}
