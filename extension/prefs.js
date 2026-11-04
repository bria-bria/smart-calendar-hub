// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Extensions that provide tray icons (upstream and Ubuntu's build).
const APPINDICATOR_UUIDS = [
    'appindicatorsupport@rgcjonas.gmail.com',
    'ubuntu-appindicators@ubuntu.com',
];

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

// A group with one switch per app, read from a list written by the extension
// ("identifier TAB name" in seenKey). The chosen identifiers are stored in
// listKey: with listMeansOn the list holds the apps switched on, otherwise
// the apps switched off.
function appSwitchGroup(window, settings, opts) {
    const group = new Adw.PreferencesGroup({
        title: opts.title,
        description: opts.description,
    });
    let rows = [];

    const rebuild = () => {
        rows.forEach(r => group.remove(r));
        rows = [];

        const items = settings.get_strv(opts.seenKey)
            .map(line => {
                const tab = line.indexOf('\t');
                return tab === -1
                    ? {key: line, label: line}
                    : {key: line.slice(0, tab), label: line.slice(tab + 1)};
            })
            .sort((a, b) => a.label.localeCompare(b.label));
        const chosen = new Set(settings.get_strv(opts.listKey));
        const sensitive = !opts.isDisabled?.();

        if (!items.length) {
            const row = new Adw.ActionRow({title: opts.emptyTitle, subtitle: opts.emptySubtitle});
            group.add(row);
            rows.push(row);
            return;
        }

        for (const {key, label} of items) {
            const row = new Adw.SwitchRow({
                title: label,
                subtitle: key !== label ? key : '',
                active: chosen.has(key) === opts.listMeansOn,
                sensitive,
            });
            row.connect('notify::active', () => {
                const list = settings.get_strv(opts.listKey).filter(k => k !== key);
                if (row.active === opts.listMeansOn)
                    list.push(key);
                settings.set_strv(opts.listKey, list);
            });
            group.add(row);
            rows.push(row);
        }
    };
    rebuild();

    // New apps appear while the window is open.
    const ids = [opts.seenKey, ...(opts.watchKeys ?? [])]
        .map(k => settings.connect(`changed::${k}`, rebuild));
    window.connect('close-request', () => {
        ids.forEach(id => settings.disconnect(id));
        return false;
    });
    return group;
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

        // Tray icons are created by the AppIndicator extension: warn if it is off.
        const shellSettings = new Gio.Settings({schema_id: 'org.gnome.shell'});
        const banner = new Adw.Banner({
            title: _('Tray icons need the “AppIndicator and KStatusNotifierItem Support” extension: turn it on'),
        });
        const syncBanner = () => {
            const enabled = shellSettings.get_strv('enabled-extensions')
                .some(uuid => APPINDICATOR_UUIDS.includes(uuid));
            banner.revealed = !enabled && settings.get_string('tray-mode') !== 'disabled';
        };
        syncBanner();
        const shellId = shellSettings.connect('changed::enabled-extensions', syncBanner);
        const trayId = settings.connect('changed::tray-mode', syncBanner);
        window.connect('close-request', () => {
            shellSettings.disconnect(shellId);
            settings.disconnect(trayId);
            return false;
        });
        const bannerGroup = new Adw.PreferencesGroup();
        bannerGroup.add(banner);
        page.add(bannerGroup);

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

        page.add(appSwitchGroup(window, settings, {
            title: _('Apps inside the panel'),
            description: _('Choose, among the icons present now, which ones move inside the panel and which stay in the top bar.'),
            seenKey: 'tray-items-seen',
            listKey: 'tray-excluded',
            listMeansOn: false,
            emptyTitle: _('No icons found yet'),
            emptySubtitle: _('Open the panel once: the list fills in by itself'),
            isDisabled: () => settings.get_string('tray-mode') === 'disabled',
            watchKeys: ['tray-mode'],
        }));

        const tboRow = new Adw.SwitchRow({
            title: _('Keep Top Bar Organizer in sync'),
            subtitle: _('Also writes the clock position into the Top Bar Organizer extension settings; the previous order is restored when Smart Calendar Hub is turned off'),
        });
        settings.bind('sync-top-bar-organizer', tboRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        position.add(tboRow);

        page.add(appSwitchGroup(window, settings, {
            title: _('Red dot on the clock'),
            description: _('A red dot appears next to the clock while one of the apps switched on here has notifications, or its tray icon signals something new (only for apps that report it, e.g. Telegram).'),
            seenKey: 'notify-apps-seen',
            listKey: 'alert-apps',
            listMeansOn: true,
            emptyTitle: _('No notifications seen yet'),
            emptySubtitle: _('Apps appear here after they send a notification'),
        }));

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
