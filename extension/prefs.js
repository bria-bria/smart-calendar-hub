// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {ExtensionState} from 'resource:///org/gnome/Shell/Extensions/js/misc/extensionUtils.js';

import {_, loadUserTranslations} from './sch-i18n.js';
import {loadCalendars, setCalendarSelected} from './sch-eds.js';
import {BII_UUID, biiRowTexts, settingsSections} from './sch-settings-model.js';

// Extensions that provide tray icons (upstream and Ubuntu's build).
const APPINDICATOR_UUIDS = [
    'appindicatorsupport@rgcjonas.gmail.com',
    'ubuntu-appindicators@ubuntu.com',
];

// GNOME Shell's own D-Bus interface for extensions (the one of the
// Extensions app): state of another extension and switching it on
const ShellExtensionsProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.gnome.Shell.Extensions">
    <method name="GetExtensionInfo">
      <arg type="s" direction="in" name="uuid"/>
      <arg type="a{sv}" direction="out" name="info"/>
    </method>
    <method name="EnableExtension">
      <arg type="s" direction="in" name="uuid"/>
      <arg type="b" direction="out" name="success"/>
    </method>
    <signal name="ExtensionStateChanged">
      <arg type="s" name="uuid"/>
      <arg type="a{sv}" name="state"/>
    </signal>
  </interface>
</node>`);

// 'active', 'off' (installed, can be switched on) or 'missing' (not
// installed, or broken: to be taken again from extensions.gnome.org)
const BROKEN = [ExtensionState.ERROR, ExtensionState.OUT_OF_DATE, ExtensionState.UNINSTALLED];
function extensionState(info) {
    const state = info?.state?.unpack();
    if (state === undefined || BROKEN.includes(state))
        return 'missing';
    return state === ExtensionState.ACTIVE ? 'active' : 'off';
}

// Follows another extension while the window is open: onChange(state) as
// soon as GNOME Shell answers and at every change. Returns a function that
// switches it on (a toast if GNOME refuses, e.g. all extensions are off).
function watchExtension(window, uuid, onChange) {
    let proxy = null;
    let signalId = 0;
    let closed = false;
    const fail = e => console.error(`Smart Calendar Hub: GNOME Shell extensions service, ${uuid}: ${e}`);
    const refresh = () => {
        proxy?.GetExtensionInfoAsync(uuid)
            .then(([info]) => !closed && onChange(extensionState(info)))
            .catch(fail);
    };
    new ShellExtensionsProxy(Gio.DBus.session, 'org.gnome.Shell', '/org/gnome/Shell',
        (p, error) => {
            if (error)
                fail(error);
            if (error || closed)
                return;
            proxy = p;
            signalId = p.connectSignal('ExtensionStateChanged', (_p, _sender, [id, info]) => {
                if (id === uuid && !closed)
                    onChange(extensionState(info));
            });
            refresh();
        }, null, Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES);
    window.connect('close-request', () => {
        closed = true;
        if (signalId)
            proxy?.disconnectSignal(signalId);
        signalId = 0;
        return false;
    });
    return () => {
        proxy?.EnableExtensionAsync(uuid)
            .then(([ok]) => ok || window.add_toast(new Adw.Toast({
                title: _('GNOME did not turn it on: check that extensions are on in the Extensions app'),
            })))
            .catch(fail);
    };
}

// A row about Battery Indicator Icon, with one button: its project page
// while it is active, "Turn on" if installed but off, "Get it" (its page on
// extensions.gnome.org) if missing. Hidden until the state is known.
// Returns {row, set(state)}.
function batteryIndicatorIconRow(window, enable) {
    const row = new Adw.ActionRow({title: 'Battery Indicator Icon', visible: false});
    row.add_prefix(new Gtk.Image({icon_name: 'battery-good-symbolic'}));
    const button = new Gtk.Button({valign: Gtk.Align.CENTER});
    row.add_suffix(button);
    let action = null;
    button.connect('clicked', () => {
        if (action === 'enable')
            enable();
        else if (action)
            new Gtk.UriLauncher({uri: action}).launch(window, null, null);
    });
    const set = s => {
        const texts = biiRowTexts(s);
        action = texts.action;
        row.visible = true;
        row.subtitle = texts.subtitle;
        button.label = texts.button;
        if (texts.primary)
            button.add_css_class('suggested-action');
        else
            button.remove_css_class('suggested-action');
    };
    return {row, set};
}

// A row described in sch-settings-model.js, as an Adw row; null when this
// window does not build it. ctx: {syncs, env, customRows}
function modelRow(settings, row, ctx) {
    let widget = null;
    switch (row.type) {
    case 'switch':
        if (row.children?.length) {
            // the rows inside matter only while it is on: an expander with
            // its own switch
            widget = new Adw.ExpanderRow({title: row.title, subtitle: row.subtitle ?? '', show_enable_switch: true});
            settings.bind(row.key, widget, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);
            for (const child of row.children) {
                const inner = modelRow(settings, child, ctx);
                if (inner)
                    widget.add_row(inner);
            }
        } else {
            widget = new Adw.SwitchRow({title: row.title, subtitle: row.subtitle ?? ''});
            settings.bind(row.key, widget, 'active', Gio.SettingsBindFlags.DEFAULT);
        }
        break;
    case 'check': {
        widget = new Adw.ActionRow({title: row.title, subtitle: row.subtitle ?? ''});
        const check = new Gtk.CheckButton({valign: Gtk.Align.CENTER});
        settings.bind(row.key, check, 'active', Gio.SettingsBindFlags.DEFAULT);
        widget.add_prefix(check);
        widget.activatable_widget = check;
        break;
    }
    case 'choice':
        widget = choiceRow(settings, row.key, row.title, row.description, row.options);
        break;
    case 'number':
        widget = new Adw.SpinRow({
            title: row.title,
            subtitle: row.subtitle ?? '',
            adjustment: new Gtk.Adjustment({
                lower: row.min,
                upper: row.max,
                step_increment: row.step,
                page_increment: row.page,
            }),
        });
        settings.bind(row.key, widget, 'value', Gio.SettingsBindFlags.DEFAULT);
        break;
    case 'custom':
        widget = ctx.customRows[row.id]?.() ?? null;
        break;
    }
    if (widget && (row.enabledWhen || row.visibleWhen)) {
        ctx.syncs.push(() => {
            if (row.enabledWhen)
                widget.sensitive = row.enabledWhen(settings);
            if (row.visibleWhen)
                widget.visible = row.visibleWhen(settings, ctx.env);
        });
    }
    return widget;
}

// The groups of a section of sch-settings-model.js on `page`; the custom
// groups come from ctx.customGroups
function modelGroups(settings, page, section, ctx) {
    for (const group of section.groups ?? []) {
        if (group.custom) {
            const custom = ctx.customGroups[group.custom]?.();
            if (custom)
                page.add(custom);
            continue;
        }
        const params = {};
        if (group.title)
            params.title = group.title;
        if (typeof group.description === 'string')
            params.description = group.description;
        const widget = new Adw.PreferencesGroup(params);
        if (typeof group.description === 'function') {
            ctx.syncs.push(() => {
                widget.description = group.description(settings, ctx.env);
            });
        }
        for (const row of group.rows) {
            const child = modelRow(settings, row, ctx);
            if (child)
                widget.add(child);
        }
        page.add(widget);
    }
}

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
        label: _('Open the page'),
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
        // One tab per section instead of one long page; the tab bar adapts
        // to the width
        window.set_default_size(640, 760);
        window.search_enabled = true;

        // The sections and most of their settings come from
        // sch-settings-model.js, shared with the card beside the panel
        const sections = settingsSections();
        const pages = {};
        for (const section of sections) {
            pages[section.id] = new Adw.PreferencesPage({
                title: section.title,
                icon_name: section.icon,
            });
            window.add(pages[section.id]);
        }

        // Battery Indicator Icon: in Panel → Battery and in Extensions,
        // followed while the window is open (see watchExtension)
        const biiRows = [];
        let enableBii = () => {};
        const ctx = {
            syncs: [],
            env: {bii: null},
            customRows: {
                bii: () => {
                    const bii = batteryIndicatorIconRow(window, () => enableBii());
                    biiRows.push(bii);
                    return bii.row;
                },
            },
            customGroups: {
                'muted-apps': () => mutedGroup(window, settings),
                'red-dot': () => appSwitchGroup(window, settings, {
                    title: _('Red dot on the clock'),
                    description: _('A red dot appears next to the clock while one of the apps switched on here has notifications, or its tray icon changes from the usual one (for example a badge with unread messages).'),
                    seenKey: 'notify-apps-seen',
                    listKey: 'alert-apps',
                    listMeansOn: true,
                    emptyTitle: _('No notifications seen yet'),
                    emptySubtitle: _('Apps appear here after they send a notification'),
                }),
            },
        };
        for (const section of sections)
            modelGroups(settings, pages[section.id], section, ctx);
        // greyed out and hidden rows follow every change
        const runSyncs = () => ctx.syncs.forEach(fn => fn());
        runSyncs();
        const syncsId = settings.connect('changed', runSyncs);
        window.connect('close-request', () => {
            settings.disconnect(syncsId);
            return false;
        });
        enableBii = watchExtension(window, BII_UUID, state => {
            ctx.env.bii = state;
            biiRows.forEach(bii => bii.set(state));
            runSyncs();
        });

        byHandPage(window, pages['by-hand']);

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
        pages.tray.add(bannerGroup);

        const trayGroup = new Adw.PreferencesGroup();
        trayGroup.add(choiceRow(settings, 'tray-mode',
            _('Icons inside the panel'),
            _('Top bar icons moved to the top of the panel'),
            [
                ['all-tray', _('Tray icons of applications')],
                ['all-right-icons', _('All icons on the right side')],
                ['disabled', _('None, leave them in the top bar')],
            ]));
        pages.tray.add(trayGroup);

        pages.tray.add(appSwitchGroup(window, settings, {
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
        const cardRow = new Adw.SwitchRow({
            title: _('Menu blended into the panel'),
            subtitle: _('On: the menu of the app sits directly on the panel, without a card around it, so it looks part of the panel.'),
        });
        settings.bind('tray-menu-blend', cardRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        menusGroup.add(cardRow);
        const fillRow = new Adw.SwitchRow({
            title: _('Calendar and clocks under the menus'),
            subtitle: _('On: under the menu of an app the calendar row, the world clocks with alarms and timers, and the bottom buttons stay visible, in the room the menu leaves free.'),
        });
        settings.bind('tray-menu-fill', fillRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        menusGroup.add(fillRow);
        pages.tray.add(menusGroup);
        pages.tray.add(appSwitchGroup(window, settings, {
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
        pages.calendars.add(today);
        const todayRow = new Adw.SwitchRow({
            title: _('Today’s events'),
            subtitle: _('A card with the events of the day above the notifications; click it to open the calendar beside the panel'),
        });
        settings.bind('show-today-events', todayRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        today.add(todayRow);
        pages.calendars.add(await calendarsGroup());
    }
}
