// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {_, loadUserTranslations} from './sch-i18n.js';
import {loadCalendars, setCalendarSelected} from './sch-eds.js';

// Extensions that provide tray icons (upstream and Ubuntu's build).
const APPINDICATOR_UUIDS = [
    'appindicatorsupport@rgcjonas.gmail.com',
    'ubuntu-appindicators@ubuntu.com',
];

// A choice bound to a string key with a fixed list of values.
// An expander row instead of a drop-down: the drop-down cut long choices
// ("Right, between tray icons and ..."); here every choice is shown in full,
// with a check mark on the current one, and the row subtitle tells it.
function choiceRow(settings, key, title, description, options) {
    const row = new Adw.ExpanderRow({title, tooltip_text: description});
    let group = null;
    const checks = options.map(([value, label]) => {
        const check = new Gtk.CheckButton({group, valign: Gtk.Align.CENTER});
        group ??= check;
        const option = new Adw.ActionRow({title: label, activatable_widget: check});
        option.add_prefix(check);
        row.add_row(option);
        check.connect('toggled', () => {
            if (check.active && settings.get_string(key) !== value)
                settings.set_string(key, value);
        });
        return check;
    });
    const sync = () => {
        const i = options.findIndex(([value]) => value === settings.get_string(key));
        if (i === -1)
            return;
        row.subtitle = options[i][1];
        if (!checks[i].active)
            checks[i].active = true;
    };
    sync();
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

// One switch per calendar of the online accounts (from evolution-data-server),
// with its colour and account. The switch is the same one GNOME Calendar
// uses ("Selected" of the source): turning a calendar off here turns it off
// in GNOME Calendar too, and the other way round. Google is not touched.
async function calendarsGroup() {
    const group = new Adw.PreferencesGroup({
        title: _('Calendars shown'),
        description: _('Choose which calendars appear in the panel and in GNOME Calendar. This does not change your online accounts.'),
    });

    let calendars = [];
    try {
        calendars = await loadCalendars();
    } catch (e) {
        console.error(`Smart Calendar Hub: cannot read the calendars: ${e}`);
    }
    if (!calendars.length) {
        group.add(new Adw.ActionRow({
            title: _('No calendars found'),
            subtitle: _('Calendars come from the online accounts in GNOME Settings'),
        }));
        return group;
    }

    // The same calendar shared with both accounts appears once per account:
    // same name and colour = one row, switching all its copies together.
    const merged = new Map();
    for (const cal of calendars) {
        const key = `${cal.name}\n${cal.color}`;
        const entry = merged.get(key) ?? {name: cal.name, color: cal.color, paths: [], selected: false, accounts: []};
        if (cal.writable)
            entry.paths.push(cal.path);
        entry.selected ||= cal.selected;
        if (cal.account && !entry.accounts.includes(cal.account))
            entry.accounts.push(cal.account);
        merged.set(key, entry);
    }

    // Grouped by account, then by name; local calendars last
    const rows = [...merged.values()].map(e => ({...e, account: e.accounts.sort().join(', ')}));
    rows.sort((a, b) =>
        (a.account === '') - (b.account === '') ||
        a.account.localeCompare(b.account) ||
        a.name.localeCompare(b.name));

    for (const cal of rows) {
        const row = new Adw.SwitchRow({
            title: cal.name,
            subtitle: cal.account,
            active: cal.selected,
            sensitive: cal.paths.length > 0,
        });
        // coloured dot, the same colour as in the panel (safeColor-checked)
        row.add_prefix(new Gtk.Label({
            use_markup: true,
            label: `<span foreground="${cal.color}" size="x-large">●</span>`,
            valign: Gtk.Align.CENTER,
        }));
        // Writes run one after another (quick toggles keep their order); if a
        // write fails the switch goes back, so it never lies.
        let queue = Promise.resolve();
        let reverting = false;
        row.connect('notify::active', () => {
            if (reverting)
                return;
            const wanted = row.active;
            queue = queue
                .then(() => Promise.all(cal.paths.map(path => setCalendarSelected(path, wanted))))
                .catch(e => {
                    console.error(`Smart Calendar Hub: cannot change calendar ${cal.name}: ${e}`);
                    reverting = true;
                    row.active = !wanted;
                    reverting = false;
                });
        });
        group.add(row);
    }
    return group;
}

// Apps silenced from the bell of a notification: name, until when, and a
// button to turn them back on. Expired silences are not listed.
function mutedGroup(window, settings) {
    const group = new Adw.PreferencesGroup({
        title: _('Silenced apps'),
        description: _('Silenced with the bell of a notification: no pop-up, the notifications stay in the panel and do not light the red dot.'),
    });
    let rows = [];
    const rebuild = () => {
        rows.forEach(r => group.remove(r));
        rows = [];
        const now = Date.now() / 1000;
        const entries = settings.get_strv('muted-apps')
            .map(line => {
                const [key, label = key, until = '0'] = line.split('\t');
                return {line, key, label, until: Number(until) || 0};
            })
            .filter(e => e.key && (e.until === 0 || e.until > now));
        if (!entries.length) {
            const row = new Adw.ActionRow({title: _('No silenced apps')});
            group.add(row);
            rows.push(row);
            return;
        }
        for (const e of entries) {
            const when = e.until === 0
                ? _('Always')
                : _('Until {time}', {time: GLib.DateTime.new_from_unix_local(e.until).format('%a %H:%M')});
            const row = new Adw.ActionRow({title: e.label, subtitle: when});
            const button = new Gtk.Button({
                label: _('Unmute'),
                valign: Gtk.Align.CENTER,
            });
            button.connect('clicked', () => {
                settings.set_strv('muted-apps',
                    settings.get_strv('muted-apps').filter(l => l.split('\t')[0] !== e.key));
            });
            row.add_suffix(button);
            group.add(row);
            rows.push(row);
        }
    };
    rebuild();
    const id = settings.connect('changed::muted-apps', rebuild);
    window.connect('close-request', () => {
        settings.disconnect(id);
        return false;
    });
    return group;
}

export default class SmartCalendarHubPreferences extends ExtensionPreferences {
    // async: GNOME 47+ waits for it, so the window is built already translated
    async fillPreferencesWindow(window) {
        // Languages other than Italian/English: create or complete the user's
        // translation file (new sentences appended at the end), then load it.
        try {
            await loadUserTranslations({merge: true});
        } catch (e) {
            console.error(`Smart Calendar Hub: translations: ${e}`);
        }

        const settings = this.getSettings();
        window._settings = settings;
        // Four tabs instead of one long page; the tab bar adapts to the width
        window.set_default_size(640, 760);
        window.search_enabled = true;

        const pagePanel = new Adw.PreferencesPage({
            title: _('Panel'),
            icon_name: 'view-dual-symbolic',
        });
        const pageTray = new Adw.PreferencesPage({
            title: _('Tray'),
            icon_name: 'view-app-grid-symbolic',
        });
        const pageCalendars = new Adw.PreferencesPage({
            title: _('Calendars'),
            icon_name: 'x-office-calendar-symbolic',
        });
        const pageNotifications = new Adw.PreferencesPage({
            title: _('Notifications'),
            icon_name: 'preferences-system-notifications-symbolic',
        });
        for (const page of [pagePanel, pageTray, pageCalendars, pageNotifications])
            window.add(page);

        // ---------------- Panel ----------------
        const position = new Adw.PreferencesGroup({
            title: _('Position'),
            description: _('Where the side panel opens and where the clock sits in the top bar.'),
        });
        pagePanel.add(position);

        position.add(choiceRow(settings, 'sidebar-side',
            _('Panel side'),
            _('Side of the screen where the panel appears when you click the clock'),
            [
                ['right', _('Right edge of the screen')],
                ['left', _('Left edge of the screen')],
                ['button', _('Under the clock button')],
            ]));

        position.add(choiceRow(settings, 'top-bar-position',
            _('Clock in the top bar'),
            _('Position of the clock and temperature in the GNOME top bar'),
            [
                ['right-between-tray-and-menu', _('Right, between tray icons and system menu')],
                ['right-before-tray', _('Right, before tray icons')],
                ['left-after-menu', _('Left, after the menus')],
                ['center', _('Center (GNOME default)')],
            ]));

        const tboRow = new Adw.SwitchRow({
            title: _('Keep Top Bar Organizer in sync'),
            subtitle: _('Also writes the clock position into the Top Bar Organizer extension settings; the previous order is restored when Smart Calendar Hub is turned off'),
        });
        settings.bind('sync-top-bar-organizer', tboRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        position.add(tboRow);

        const look = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('From top to bottom: tray icons, weather (collapsed at login, with the settings button), date, calendar, notifications, world clocks.'),
        });
        pagePanel.add(look);

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

        const sky = new Adw.PreferencesGroup({
            title: _('Sky'),
            description: _('Next to the date. The two options can be used separately or together.'),
        });
        pagePanel.add(sky);
        const sunMoonRow = new Adw.SwitchRow({
            title: _('Sun and moon of the day'),
            subtitle: _('The sun moves along an arc from sunrise to sunset, then the moon until the next sunrise'),
        });
        settings.bind('show-sun-moon', sunMoonRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        sky.add(sunMoonRow);
        const phaseRow = new Adw.SwitchRow({
            title: _('Moon phase'),
            subtitle: _('The moon is drawn in its real phase; alone, it shows only the moon'),
        });
        settings.bind('show-moon-phase', phaseRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        sky.add(phaseRow);

        // ---------------- Tray ----------------
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
        pageTray.add(bannerGroup);

        const trayGroup = new Adw.PreferencesGroup();
        trayGroup.add(choiceRow(settings, 'tray-mode',
            _('Icons inside the panel'),
            _('Top bar icons moved to the top of the panel'),
            [
                ['all-tray', _('Tray icons of applications')],
                ['all-right-icons', _('All icons on the right side')],
                ['disabled', _('None, leave them in the top bar')],
            ]));
        pageTray.add(trayGroup);

        pageTray.add(appSwitchGroup(window, settings, {
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

        // ---------------- Calendars ----------------
        pageCalendars.add(await calendarsGroup());

        // ---------------- Notifications ----------------
        pageNotifications.add(mutedGroup(window, settings));
        pageNotifications.add(appSwitchGroup(window, settings, {
            title: _('Red dot on the clock'),
            description: _('A red dot appears next to the clock while one of the apps switched on here has notifications, or its tray icon signals something new (only for apps that report it, e.g. Telegram).'),
            seenKey: 'notify-apps-seen',
            listKey: 'alert-apps',
            listMeansOn: true,
            emptyTitle: _('No notifications seen yet'),
            emptySubtitle: _('Apps appear here after they send a notification'),
        }));
    }
}
