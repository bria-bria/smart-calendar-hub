// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk';
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
        description: _('Silenced with the bell of a notification: no pop-up and no red dot; the notifications stay in the panel. Change or turn off the silence with the bell of the notification too.'),
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

const SCRIPT = 'installa-schermata-accesso.sh';
// the raw file: the browser shows the script itself, to be saved as it is
const SCRIPT_URL = `https://raw.githubusercontent.com/bria-bria/smart-calendar-hub/main/${SCRIPT}`;

// A row with a command and a button that copies it
function commandRow(window, title, command) {
    const row = new Adw.ActionRow({title, subtitle: command, subtitle_selectable: true});
    row.add_css_class('property');
    const copy = new Gtk.Button({
        icon_name: 'edit-copy-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: _('Copy the command'),
    });
    copy.add_css_class('flat');
    copy.connect('clicked', () => {
        Gdk.Display.get_default().get_clipboard().set(command);
        window.add_toast(new Adw.Toast({title: _('Command copied'), timeout: 2}));
    });
    row.add_suffix(copy);
    return row;
}

// Everything to be done outside the extension, by hand: apps and extensions
// it relies on, extensions that do the same things, calendar reminders, the
// login screen (a script run by the user in a terminal: the extension never
// runs anything as administrator)
function byHandPage(window, page) {
    const info = (group, icon, title, subtitle) => {
        const row = new Adw.ActionRow({title, subtitle});
        row.add_prefix(new Gtk.Image({icon_name: icon}));
        group.add(row);
    };

    const needs = new Adw.PreferencesGroup({
        title: _('What it uses'),
        description: _('Install them from your distribution or from GNOME Software.'),
    });
    page.add(needs);
    info(needs, 'application-x-addon-symbolic', _('AppIndicator and KStatusNotifierItem Support'),
        _('Extension: it creates the tray icons that Smart Calendar Hub moves into the panel. Keep it on.'));
    info(needs, 'weather-few-clouds-symbolic', _('GNOME Weather'),
        _('The weather and its cities: add your cities there.'));
    info(needs, 'alarm-symbolic', _('GNOME Clocks'),
        _('World clocks, alarms and timers shown at the bottom of the panel: add them there.'));
    info(needs, 'x-office-calendar-symbolic', _('GNOME Calendar'),
        _('“New event” and the calendars of your online accounts (GNOME Settings → Online Accounts).'));

    const overlap = new Adw.PreferencesGroup({
        title: _('Extensions to switch off'),
        description: _('They do the same things: with both on, the top bar may show them twice or they fight over it.'),
    });
    page.add(overlap);
    info(overlap, 'weather-overcast-symbolic', "Weather O'Clock",
        _('Weather inside the clock pill: Panel → Weather.'));
    info(overlap, 'battery-good-symbolic', 'Battery Indicator Icon',
        _('Battery as a circle: Panel → Battery.'));
    info(overlap, 'view-more-horizontal-symbolic', 'Status Area Horizontal Spacing',
        _('Space between the top bar icons: Panel → Appearance.'));
    info(overlap, 'applications-graphics-symbolic', 'DashCraft',
        _('Only its "Items Color": accent colour in the top bar, Panel → Appearance.'));

    const reminders = new Adw.PreferencesGroup({
        title: _('Calendar reminders'),
        description: _('On some systems the reminders of your events never show up: the service that sends them (evolution-alarm-notify) does not start in GNOME. These two commands start it at every login, without the option that stops it (the path of the service is taken from your system).'),
    });
    page.add(reminders);
    const dropIn = '~/.config/systemd/user/evolution-alarm-notify.service.d';
    reminders.add(commandRow(window, _('1. In a terminal'),
        `mkdir -p ${dropIn} && printf '[Service]\\nExecStart=\\n%s\\n' "$(grep -m1 '^ExecStart=' "$(systemctl --user show -P FragmentPath evolution-alarm-notify.service)" | sed 's/ --autostart//')" > ${dropIn}/senza-autostart.conf`));
    reminders.add(commandRow(window, _('2. Then'),
        'systemctl --user daemon-reload && systemctl --user restart evolution-alarm-notify.service'));
    reminders.add(commandRow(window, _('To undo it'),
        `rm ${dropIn}/senza-autostart.conf && systemctl --user daemon-reload && systemctl --user restart evolution-alarm-notify.service`));

    const lock = new Adw.PreferencesGroup({
        title: _('Lock screen'),
        description: _('Automatic: on the lock screen the top bar keeps the accent colour, the space between the icons, the clock position and the battery circle. The side panel, the notifications and the calendar are taken away while the screen is locked, so nothing personal shows.'),
    });
    page.add(lock);

    const login = new Adw.PreferencesGroup({
        title: _('Login screen'),
        description: _('The screen where you choose the user belongs to the system: Smart Calendar Hub cannot change it by itself. A script, run by you in a terminal, installs the extension for all users and copies your accent colour, icon spacing, clock position and battery circle there.'),
    });
    page.add(login);

    const warning = new Adw.ActionRow({
        title: _('It needs the administrator password'),
        subtitle: _('It writes in /usr/share/gnome-shell/extensions and in /etc/dconf (settings of the gdm user). Read the script before running it.'),
    });
    warning.add_prefix(new Gtk.Image({icon_name: 'dialog-warning-symbolic'}));
    login.add(warning);

    const download = new Adw.ActionRow({
        title: _('1. Download the script'),
        subtitle: _('It opens in the browser: save it with Ctrl+S in a folder of yours'),
    });
    const open = new Gtk.Button({
        label: _('Open'),
        valign: Gtk.Align.CENTER,
    });
    open.connect('clicked', () => {
        new Gtk.UriLauncher({uri: SCRIPT_URL}).launch(window, null, null);
    });
    download.add_suffix(open);
    login.add(download);

    login.add(commandRow(window,
        _('2. In a terminal, in that folder'),
        `sudo bash ${SCRIPT}`));
    login.add(new Adw.ActionRow({
        title: _('3. Log out'),
        subtitle: _('The login screen shows the change. Run the script again after changing those settings or updating the extension.'),
    }));

    const remove = new Adw.PreferencesGroup({title: _('Back to the login screen as it was')});
    page.add(remove);
    remove.add(commandRow(window, _('In a terminal, in the folder of the script'),
        `sudo bash ${SCRIPT} --rimuovi`));
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
        const pageNetwork = new Adw.PreferencesPage({
            title: _('Network'),
            icon_name: 'network-workgroup-symbolic',
        });
        const pageLogin = new Adw.PreferencesPage({
            title: _('By hand'),
            icon_name: 'utilities-terminal-symbolic',
        });
        for (const page of [pagePanel, pageTray, pageCalendars, pageNotifications, pageNetwork, pageLogin])
            window.add(page);
        byHandPage(window, pageLogin);

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
                ['right-between-tray-and-menu', _('Right, next to the system menu')],
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
            description: _('From top to bottom: tray icons (with the settings button), IP addresses, weather (collapsed at login), date, calendar, notifications, world clocks.'),
        });
        pagePanel.add(look);

        const collapseRow = new Adw.SwitchRow({
            title: _('Calendar collapsed on opening'),
            subtitle: _('Click “Calendar and events” to open it'),
        });
        settings.bind('calendar-collapsed', collapseRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(collapseRow);
        look.add(choiceRow(settings, 'calendar-side-reopen',
            _('Calendar beside the panel'),
            _('When the panel opens again (it opens with a click on the “Today” card)'),
            [
                ['closed', _('Closed')],
                ['last', _('As it was left')],
                ['open', _('Open')],
            ]));

        const alignRow = new Adw.SwitchRow({
            title: _('Align to GNOME’s menu'),
            subtitle: _('As wide as the system menu (Wi-Fi, volume…), kept the same automatically'),
        });
        settings.bind('sidebar-width-gnome', alignRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(alignRow);
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
        settings.bind('sidebar-width-gnome', widthRow, 'sensitive',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);
        look.add(widthRow);

        // one setting for the space between the icons of the top bar
        const spacingRow = new Adw.SpinRow({
            title: _('Space between the top bar icons (pixels)'),
            subtitle: _('12 is the GNOME default; less brings the icons closer together'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 12,
                step_increment: 1,
                page_increment: 2,
            }),
        });
        settings.bind('top-bar-spacing', spacingRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        look.add(spacingRow);
        const accentRow = new Adw.SwitchRow({
            title: _('Accent colour in the top bar'),
            subtitle: _('Texts and icons of the top bar in the accent colour chosen in GNOME Settings, and they follow it when it changes'),
        });
        settings.bind('accent-top-bar', accentRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(accentRow);
        const toneRow = choiceRow(settings, 'accent-top-bar-tone',
            _('Tone of the accent colour'),
            _('Light: bright on the dark bar. Full: the colour of GNOME’s buttons, duller as text.'),
            [
                ['light', _('Light')],
                ['full', _('Full')],
            ]);
        settings.bind('accent-top-bar', toneRow, 'sensitive', Gio.SettingsBindFlags.GET);
        look.add(toneRow);

        // The battery as a circle in the top bar (also on the lock and login
        // screens)
        const battery = new Adw.PreferencesGroup({
            title: _('Battery'),
            description: _('In the top bar, also on the lock screen and on the login screen.'),
        });
        pagePanel.add(battery);
        const circleRow = new Adw.SwitchRow({
            title: _('Battery as a circle'),
            subtitle: _('A ring that empties with the charge, in the colour of the bar; yellow under 20%, red under 10%. A bolt only while it is really charging'),
        });
        settings.bind('battery-circle', circleRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        battery.add(circleRow);
        const circleTextRow = new Adw.SwitchRow({
            title: _('Percentage inside the circle'),
        });
        settings.bind('battery-circle-text', circleTextRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('battery-circle', circleTextRow, 'sensitive', Gio.SettingsBindFlags.GET);
        battery.add(circleTextRow);

        // Everything about the weather in one group
        const weather = new Adw.PreferencesGroup({
            title: _('Weather'),
            description: _('From GNOME Weather: set your cities there. In the panel, the up and down arrows go through them.'),
        });
        pagePanel.add(weather);
        weather.add(choiceRow(settings, 'clock-weather',
            _('Weather in the top bar'),
            _('Next to the clock, from GNOME Weather'),
            [
                ['both', _('Icon and temperature')],
                ['temperature', _('Temperature only')],
                ['off', _('Off')],
            ]));
        const positionRow = choiceRow(settings, 'clock-weather-position',
            _('Position'),
            _('In the same pill as the clock, before or after the time'),
            [
                ['after', _('After the clock')],
                ['before', _('Before the clock')],
            ]);
        weather.add(positionRow);
        const descriptionRow = new Adw.SwitchRow({
            title: _('Weather description'),
            subtitle: _('After each update, “Cloudy”, “Light rain”… for a few seconds instead of the temperature'),
        });
        settings.bind('clock-weather-description', descriptionRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        weather.add(descriptionRow);
        // position and description only matter with the weather switched on
        const syncWeatherRows = () => {
            const on = settings.get_string('clock-weather') !== 'off';
            positionRow.sensitive = on;
            descriptionRow.sensitive = on;
        };
        const weatherRowsId = settings.connect('changed::clock-weather', syncWeatherRows);
        window.connect('close-request', () => {
            settings.disconnect(weatherRowsId);
            return false;
        });
        syncWeatherRows();

        const sky = new Adw.PreferencesGroup({
            title: _('Date and sky'),
            description: _('The date, and next to it the sun and the moon. The two sky options can be used separately or together.'),
        });
        pagePanel.add(sky);
        const dateRow = new Adw.SwitchRow({
            title: _('Date'),
            subtitle: _('Off: no date in the panel, and no sun or moon either'),
        });
        settings.bind('show-date', dateRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        sky.add(dateRow);
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
        // sun and moon only with the date
        for (const row of [sunMoonRow, phaseRow])
            settings.bind('show-date', row, 'sensitive', Gio.SettingsBindFlags.GET);

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

        const menusGroup = new Adw.PreferencesGroup({title: _('Menus of the icons')});
        const insideRow = new Adw.SwitchRow({
            title: _('Menus inside the panel'),
            subtitle: _('Clicking a tray icon shows its menu inside the panel, in place of the cards, instead of a floating menu. Back with the arrow, Esc or another click on the icon.'),
        });
        settings.bind('tray-menus-inside', insideRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        menusGroup.add(insideRow);
        pageTray.add(menusGroup);
        pageTray.add(appSwitchGroup(window, settings, {
            title: _('Menu inside the panel, icon by icon'),
            description: _('Switch off an icon to keep its menu floating (e.g. an app whose menu does not look right inside).'),
            seenKey: 'tray-items-seen',
            listKey: 'tray-menus-floating',
            listMeansOn: false,
            emptyTitle: _('No icons found yet'),
            emptySubtitle: _('Open the panel once: the list fills in by itself'),
            isDisabled: () => settings.get_string('tray-mode') === 'disabled' ||
                !settings.get_boolean('tray-menus-inside'),
            watchKeys: ['tray-mode', 'tray-menus-inside'],
        }));

        // ---------------- Calendars ----------------
        const today = new Adw.PreferencesGroup();
        pageCalendars.add(today);
        const todayRow = new Adw.SwitchRow({
            title: _('Today’s events'),
            subtitle: _('A card with the events of the day above the notifications; click it to open the calendar beside the panel'),
        });
        settings.bind('show-today-events', todayRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        today.add(todayRow);
        pageCalendars.add(await calendarsGroup());

        // ---------------- Network ----------------
        const ip = new Adw.PreferencesGroup({
            title: _('IP addresses in the top bar'),
            description: _('Click the addresses in the top bar: the menu lists every address switched on here, click one to copy it.'),
        });
        pageNetwork.add(ip);
        const showIp = new Adw.SwitchRow({title: _('Show the IP addresses')});
        settings.bind('show-ip', showIp, 'active', Gio.SettingsBindFlags.DEFAULT);
        ip.add(showIp);
        const ipPosition = choiceRow(settings, 'ip-position',
            _('Position in the top bar'),
            _('Where the IP addresses appear'),
            [
                ['left', _('Left')],
                ['center', _('Center')],
                ['right', _('Right')],
            ]);
        ip.add(ipPosition);
        // switch = the address is known and listed in the menu;
        // open the row to choose whether it is in the bar too
        const addressRow = (key, title, subtitle) => {
            const row = new Adw.ExpanderRow({title, subtitle, show_enable_switch: true});
            settings.bind(`ip-show-${key}`, row, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);
            const bar = new Adw.SwitchRow({
                title: _('Show in the top bar'),
                subtitle: _('Off: only in the menu that opens when you click the addresses'),
            });
            settings.bind(`ip-bar-${key}`, bar, 'active', Gio.SettingsBindFlags.DEFAULT);
            row.add_row(bar);
            ip.add(row);
            return row;
        };
        const lanRow = addressRow('lan', _('Local network address'),
            _('The address of this computer in the network it is connected to now'));
        const vpnRow = addressRow('vpn', _('VPN address'),
            _('Shown with a shield while a VPN such as Tailscale is active'));
        const publicRow = addressRow('public', _('Public address'),
            _('The address seen on the Internet. To know it, the extension asks api.ipify.org (when the network changes and every 30 minutes); that service sees the request.'));
        for (const row of [ipPosition, lanRow, vpnRow, publicRow])
            settings.bind('show-ip', row, 'sensitive', Gio.SettingsBindFlags.GET);

        // IP addresses in the side panel, under the tray
        const panelIp = new Adw.PreferencesGroup({
            title: _('IP addresses in the panel'),
            description: _('A box under the tray icons. With more than one address, arrows go through them; click an address to copy it.'),
        });
        pageNetwork.add(panelIp);
        const panelIpRow = new Adw.SwitchRow({
            title: _('IP address in Smart Calendar Hub'),
            subtitle: _('Show the box in the side panel'),
        });
        settings.bind('panel-ip', panelIpRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        panelIp.add(panelIpRow);
        for (const [key, title, subtitle] of [
            ['panel-ip-lan', _('Local network'), _('The address in the network you are connected to now')],
            ['panel-ip-vpn', _('VPN'), _('Every active one: VPN 1, 2, 3…')],
            ['panel-ip-public', _('Public address'), _('Asks api.ipify.org, like the top bar')],
        ]) {
            const row = new Adw.ActionRow({title, subtitle});
            const check = new Gtk.CheckButton({valign: Gtk.Align.CENTER});
            settings.bind(key, check, 'active', Gio.SettingsBindFlags.DEFAULT);
            row.add_prefix(check);
            row.activatable_widget = check;
            settings.bind('panel-ip', row, 'sensitive', Gio.SettingsBindFlags.GET);
            panelIp.add(row);
        }

        // ---------------- Notifications ----------------
        pageNotifications.add(mutedGroup(window, settings));
        pageNotifications.add(appSwitchGroup(window, settings, {
            title: _('Red dot on the clock'),
            description: _('A red dot appears next to the clock while one of the apps switched on here has notifications, or its tray icon changes from the usual one (for example a badge with unread messages).'),
            seenKey: 'notify-apps-seen',
            listKey: 'alert-apps',
            listMeansOn: true,
            emptyTitle: _('No notifications seen yet'),
            emptySubtitle: _('Apps appear here after they send a notification'),
        }));
    }
}
