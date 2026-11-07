// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The settings of Smart Calendar Hub described once: what each section
// holds, in order, with its texts. The card beside the panel
// (sch-hub-settings.js) builds them with our page kit; this file has no
// pieces of the screen (no St), only the description and the reading and
// writing of the lists.
//
// settingsSections() → the sections, in order: {id, title, icon, groups}
// a group:
//   {title?, description?, rows}  description: a text, or
//                               (settings, env) => text | null
//   {kind: 'apps', title, description, apps}  one switch per app (appItems)
//   {kind: 'muted', title, description, emptyTitle, unmute}  the silenced
//        apps (mutedEntries), each with a button to turn it back on
//   {kind: 'calendars', title, description, emptyTitle, emptySubtitle}
//        one switch per calendar (calendarRows, read asynchronously)
//   {kind: 'appindicator', text}  a warning while the extension that makes
//        the tray icons is off (env.appIndicator false) and the tray is used
// a row:
//   {type: 'switch', key, title, subtitle?, children?}  a boolean key;
//        children: rows that matter only while it is on (shown under it,
//        greyed out while it is off)
//   {type: 'check', key, title, subtitle?}   a boolean key, as a check box
//   {type: 'choice', key, title, description, options: [[value, label], …]}
//   {type: 'number', key, title, subtitle?, min, max, step, page}
//   {type: 'info', icon?, title, subtitle?}   a line to read, no setting
//   {type: 'command', title, command}  a command, with a button to copy it
//   {type: 'link', title, subtitle, button, url}  a button opening a page
//   {type: 'custom', id}        a row the card builds itself (id 'bii')
// and, on any row:
//   enabledWhen: settings => bool      greyed out when false
//   visibleWhen: (settings, env) => bool
// env: what does not come from our settings, followed by the card:
//   env.bii  the state of Battery Indicator Icon: 'active', 'off'
//            (installed, can be switched on), 'missing', or null (not known)
//   env.appIndicator  whether the extension of the tray icons is on

import GLib from 'gi://GLib';

import {_} from './sch-i18n.js';
import {loadCalendars, safeColor, setCalendarSelected} from './sch-eds.js';

// Extensions that provide tray icons (upstream and Ubuntu's build).
export const APPINDICATOR_UUIDS = [
    'appindicatorsupport@rgcjonas.gmail.com',
    'ubuntu-appindicators@ubuntu.com',
];

// Battery Indicator Icon by Deminder, from which the idea of our battery
// circle comes: while it is active it draws the battery and our circle steps
// aside (sch-battery.js)
export const BII_UUID = 'battery-indicator-icon@Deminder';
const BII_PROJECT_URL = 'https://github.com/Deminder/battery-indicator-icon';
const BII_EGO_URL = 'https://extensions.gnome.org/extension/5718/battery-indicator-icon/';

// The subtitle and the button of the Battery Indicator Icon row, for its
// state: {subtitle, button, primary, action: 'enable' | url}
export function biiRowTexts(state) {
    if (state === 'active') {
        return {
            subtitle: _('Deminder’s extension, which gave us the idea of the circle, is drawing the battery: change its look in its own settings. Switch it off to get our circle back.'),
            button: _('Project page'), primary: false, action: BII_PROJECT_URL,
        };
    }
    if (state === 'off') {
        return {
            subtitle: _('Deminder’s extension, which gave us the idea of the circle, is installed but off. Turn it on and our circle steps aside.'),
            button: _('Turn on'), primary: true, action: 'enable',
        };
    }
    return {
        subtitle: _('Deminder’s extension, which gave us the idea of the circle: a circle or a portrait, in several styles. With it on, our circle steps aside.'),
        button: _('Get it'), primary: false, action: BII_EGO_URL,
    };
}

const on = key => settings => settings.get_boolean(key);
const off = key => settings => !settings.get_boolean(key);
const notBii = (_settings, env) => env.bii !== 'active';

function panelGroups() {
    const batteryText = _('In the top bar, also on the lock screen and on the login screen.');
    const weatherOn = settings => settings.get_string('clock-weather') !== 'off';
    return [
        {
            title: _('Position'),
            description: _('Where the side panel opens and where the clock sits in the top bar.'),
            rows: [
                {type: 'choice', key: 'sidebar-side', title: _('Panel side'),
                    description: _('Side of the screen where the panel appears when you click the clock'),
                    options: [
                        ['right', _('Right edge of the screen')],
                        ['left', _('Left edge of the screen')],
                        ['button', _('Under the clock button')],
                    ]},
                {type: 'choice', key: 'top-bar-position', title: _('Clock in the top bar'),
                    description: _('Position of the clock and temperature in the GNOME top bar'),
                    options: [
                        ['right-between-tray-and-menu', _('Right, next to the system menu')],
                        ['right-before-tray', _('Right, before tray icons')],
                        ['left-after-menu', _('Left, after the menus')],
                        ['center', _('Center (GNOME default)')],
                    ]},
            ],
        },
        {
            title: _('Appearance'),
            description: _('From top to bottom: tray icons (with the settings button), IP addresses, weather (collapsed at login), date, calendar, notifications, world clocks.'),
            rows: [
                {type: 'switch', key: 'calendar-collapsed', title: _('Calendar collapsed on opening'),
                    subtitle: _('Click “Calendar and events” to open it')},
                {type: 'choice', key: 'calendar-side-reopen', title: _('Calendar beside the panel'),
                    description: _('When the panel opens again (it opens with a click on the “Today” card)'),
                    options: [
                        ['closed', _('Closed')],
                        ['last', _('As it was left')],
                        ['open', _('Open')],
                    ]},
                {type: 'switch', key: 'sidebar-width-gnome', title: _('Align to GNOME’s menu'),
                    subtitle: _('As wide as the system menu (Wi-Fi, volume…), kept the same automatically')},
                {type: 'number', key: 'sidebar-width', title: _('Panel width (pixels)'),
                    min: 320, max: 520, step: 10, page: 20,
                    enabledWhen: off('sidebar-width-gnome')},
                {type: 'number', key: 'top-bar-spacing', title: _('Space between the top bar icons (pixels)'),
                    subtitle: _('12 is the GNOME default; less brings the icons closer together'),
                    min: 0, max: 12, step: 1, page: 2},
                {type: 'switch', key: 'accent-top-bar', title: _('Accent colour in the top bar'),
                    subtitle: _('Texts and icons of the top bar in the accent colour chosen in GNOME Settings, and they follow it when it changes')},
                {type: 'choice', key: 'accent-top-bar-tone', title: _('Tone of the accent colour'),
                    description: _('Light: bright on the dark bar. Full: the colour of GNOME’s buttons, duller as text.'),
                    options: [
                        ['light', _('Light')],
                        ['full', _('Full')],
                    ],
                    enabledWhen: on('accent-top-bar')},
            ],
        },
        {
            // while Battery Indicator Icon is active our two switches make no
            // difference: only its row is shown (the settings are kept)
            title: _('Battery'),
            description: (_settings, env) => (env.bii === 'active' ? null : batteryText),
            rows: [
                {type: 'switch', key: 'battery-circle', title: _('Battery as a circle'),
                    subtitle: _('A ring that empties with the charge, in the colour of the bar; yellow under 20%, red under 10%. A bolt only while it is really charging'),
                    visibleWhen: notBii},
                {type: 'switch', key: 'battery-circle-text', title: _('Percentage inside the circle'),
                    enabledWhen: on('battery-circle'), visibleWhen: notBii},
                {type: 'custom', id: 'bii'},
            ],
        },
        {
            title: _('Weather'),
            description: _('From GNOME Weather: set your cities there. In the panel, the up and down arrows go through them.'),
            rows: [
                {type: 'choice', key: 'clock-weather', title: _('Weather in the top bar'),
                    description: _('Next to the clock, from GNOME Weather'),
                    options: [
                        ['both', _('Icon and temperature')],
                        ['temperature', _('Temperature only')],
                        ['off', _('Off')],
                    ]},
                // position and description only matter with the weather on
                {type: 'choice', key: 'clock-weather-position', title: _('Position'),
                    description: _('In the same pill as the clock, before or after the time'),
                    options: [
                        ['after', _('After the clock')],
                        ['before', _('Before the clock')],
                    ],
                    enabledWhen: weatherOn},
                {type: 'switch', key: 'clock-weather-description', title: _('Weather description'),
                    subtitle: _('After each update, “Cloudy”, “Light rain”… for a few seconds instead of the temperature'),
                    enabledWhen: weatherOn},
            ],
        },
        {
            title: _('Date and sky'),
            description: _('The date, and next to it the sun and the moon. The two sky options can be used separately or together.'),
            rows: [
                {type: 'switch', key: 'show-date', title: _('Date'),
                    subtitle: _('Off: no date in the panel, and no sun or moon either')},
                // sun and moon only with the date
                {type: 'switch', key: 'show-sun-moon', title: _('Sun and moon of the day'),
                    subtitle: _('The sun moves along an arc from sunrise to sunset, then the moon until the next sunrise'),
                    enabledWhen: on('show-date')},
                {type: 'switch', key: 'show-moon-phase', title: _('Moon phase'),
                    subtitle: _('The moon is drawn in its real phase; alone, it shows only the moon'),
                    enabledWhen: on('show-date')},
            ],
        },
    ];
}

function notificationGroups() {
    return [
        {
            rows: [
                {type: 'switch', key: 'banners-away-from-mouse', title: _('Banners away from the mouse'),
                    subtitle: _('While the pointer is where a notification would pop up, it waits and appears as soon as the pointer moves away (urgent ones appear at once)')},
                {type: 'number', key: 'banners-away-margin', title: _('Area around the banner (percent)'),
                    subtitle: _('How much larger than the notification the area the mouse must leave is: 0 = only the notification itself'),
                    min: 0, max: 200, step: 5, page: 25,
                    enabledWhen: on('banners-away-from-mouse')},
            ],
        },
        {
            kind: 'muted',
            title: _('Silenced apps'),
            description: _('Silenced with the bell of a notification: no pop-up and no red dot; the notifications stay in the panel. Change or turn off the silence with the bell of the notification too.'),
            emptyTitle: _('No silenced apps'),
            unmute: _('Unmute'),
        },
        {
            kind: 'apps',
            title: _('Red dot on the clock'),
            description: _('A red dot appears next to the clock while one of the apps switched on here has notifications, or its tray icon changes from the usual one (for example a badge with unread messages).'),
            apps: {
                seenKey: 'notify-apps-seen', listKey: 'alert-apps', listMeansOn: true,
                emptyTitle: _('No notifications seen yet'),
                emptySubtitle: _('Apps appear here after they send a notification'),
            },
        },
    ];
}

function networkGroups() {
    const ipOn = on('show-ip');
    // switch = the address is known and listed in the menu; inside it,
    // whether it is in the bar too
    const address = (key, title, subtitle) => ({
        type: 'switch', key: `ip-show-${key}`, title, subtitle, enabledWhen: ipOn,
        children: [
            {type: 'switch', key: `ip-bar-${key}`, title: _('Show in the top bar'),
                subtitle: _('Off: only in the menu that opens when you click the addresses')},
        ],
    });
    const panelIpOn = on('panel-ip');
    return [
        {
            title: _('IP addresses in the top bar'),
            description: _('Click the addresses in the top bar: the menu lists every address switched on here, click one to copy it.'),
            rows: [
                {type: 'switch', key: 'show-ip', title: _('Show the IP addresses')},
                {type: 'choice', key: 'ip-position', title: _('Position in the top bar'),
                    description: _('Where the IP addresses appear'),
                    options: [
                        ['left', _('Left')],
                        ['center', _('Center')],
                        ['right', _('Right')],
                    ],
                    enabledWhen: ipOn},
                address('lan', _('Local network address'),
                    _('The address of this computer on the network it is connected to now')),
                address('vpn', _('VPN address'),
                    _('Shown with a shield while a VPN such as Tailscale is active')),
                address('public', _('Public address'),
                    _('The address seen on the Internet. To know it, the extension asks api.ipify.org (when the network changes and every 30 minutes); that service sees the request.')),
            ],
        },
        {
            // IP addresses in the side panel, under the tray
            title: _('IP addresses in the panel'),
            description: _('A box under the tray icons. With more than one address, arrows go through them; click an address to copy it.'),
            rows: [
                {type: 'switch', key: 'panel-ip', title: _('IP address in Smart Calendar Hub'),
                    subtitle: _('Show the box in the side panel')},
                {type: 'check', key: 'panel-ip-lan', title: _('Local network'),
                    subtitle: _('The address on the network you are connected to now'), enabledWhen: panelIpOn},
                {type: 'check', key: 'panel-ip-vpn', title: _('VPN'),
                    subtitle: _('Every active one: VPN 1, 2, 3…'), enabledWhen: panelIpOn},
                {type: 'check', key: 'panel-ip-public', title: _('Public address'),
                    subtitle: _('Asks api.ipify.org, like the top bar'), enabledWhen: panelIpOn},
            ],
        },
    ];
}

// other extensions that Smart Calendar Hub works with: each setting matters
// only when that extension is installed
function extensionGroups() {
    return [
        {
            title: 'Top Bar Organizer',
            description: _('Orders the icons of the top bar.'),
            rows: [
                {type: 'switch', key: 'sync-top-bar-organizer', title: _('Keep Top Bar Organizer in sync'),
                    subtitle: _('Also writes the clock position into the Top Bar Organizer extension settings; the previous order is restored when Smart Calendar Hub is turned off')},
            ],
        },
        {
            title: 'Vesperal',
            description: _('Sunrise, sunset and day length. With it installed, a click on the sun and moon of the panel opens its menu inside the panel.'),
            rows: [
                {type: 'switch', key: 'vesperal-hide-icon', title: _('Hide its icon in the top bar'),
                    subtitle: _('Its menu still opens from the sun and moon of the panel')},
            ],
        },
        {
            title: 'Freon',
            description: _('Temperatures of the processor, the disks and the graphics card, and the fans.'),
            rows: [
                {type: 'switch', key: 'freon-single-icon', title: _('One thermometer icon'),
                    subtitle: _('Its button shows one thermometer instead of an icon and a temperature for each sensor; the temperatures stay in its menu')},
            ],
        },
        {
            title: 'Battery Indicator Icon',
            description: _('The battery in the top bar as a circle or a portrait, by Deminder. While it is on, Smart Calendar Hub leaves the battery to it.'),
            rows: [{type: 'custom', id: 'bii'}],
        },
    ];
}

// The apps of an 'apps' group, from the list written by the extension
// ("identifier TAB name" in seenKey), by name: [{key, label, on}]. The
// chosen identifiers are in listKey: with listMeansOn the list holds the
// apps switched on, otherwise the apps switched off.
export function appItems(settings, apps) {
    const chosen = new Set(settings.get_strv(apps.listKey));
    return settings.get_strv(apps.seenKey)
        .map(line => {
            const tab = line.indexOf('\t');
            return tab === -1
                ? {key: line, label: line}
                : {key: line.slice(0, tab), label: line.slice(tab + 1)};
        })
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(item => ({...item, on: chosen.has(item.key) === apps.listMeansOn}));
}

export function setAppOn(settings, apps, key, on) {
    const list = settings.get_strv(apps.listKey).filter(k => k !== key);
    if (on === apps.listMeansOn)
        list.push(key);
    settings.set_strv(apps.listKey, list);
}

// A name kept in our "key TAB name" lists: no tab or line break inside
export function oneLine(text) {
    return text.replace(/[\t\n]/g, ' ');
}

// Writes a list only when it changed (no needless dconf writes)
export function setStrvIfChanged(settings, key, list) {
    const old = settings.get_strv(key);
    if (old.length !== list.length || old.some((x, i) => x !== list[i]))
        settings.set_strv(key, list);
}

// The lines of muted-apps ("key TAB name TAB until TAB choice", until in
// Unix seconds, 0 = always; choice: the duration button chosen, -1 none)
export function parseMuted(lines) {
    return lines.map(line => {
        const [key, label = key, until = '0', choice = ''] = line.split('\t');
        return {key, label, until: Number(until) || 0, choice: choice === '' ? -1 : Number(choice)};
    }).filter(e => e.key);
}

// The silence has not expired yet
export function stillMuted(entry) {
    return entry.until === 0 || entry.until > Date.now() / 1000;
}

// The apps silenced with the bell of a notification and not expired:
// [{key, label, when}]
export function mutedEntries(settings) {
    return parseMuted(settings.get_strv('muted-apps'))
        .filter(stillMuted)
        .map(e => ({
            key: e.key,
            label: e.label,
            when: e.until === 0
                ? _('Always')
                : _('Until {time}', {time: GLib.DateTime.new_from_unix_local(e.until).format('%a %H:%M')}),
        }));
}

export function unmuteApp(settings, key) {
    settings.set_strv('muted-apps',
        settings.get_strv('muted-apps').filter(l => l.split('\t')[0] !== key));
}

// One row per calendar of the online accounts (from evolution-data-server):
// [{name, color, account, paths, selected}]. The same calendar shared with
// both accounts appears once per account: same name and colour = one row,
// switching all its copies together (paths: the writable copies). Grouped
// by account, then by name; local calendars last.
export async function calendarRows(cancellable = null) {
    const merged = new Map();
    for (const cal of await loadCalendars(cancellable)) {
        const key = `${cal.name}\n${cal.color}`;
        const entry = merged.get(key) ?? {name: cal.name, color: safeColor(cal.color), paths: [], selected: false, accounts: []};
        if (cal.writable)
            entry.paths.push(cal.path);
        entry.selected ||= cal.selected;
        if (cal.account && !entry.accounts.includes(cal.account))
            entry.accounts.push(cal.account);
        merged.set(key, entry);
    }
    const rows = [...merged.values()].map(e => ({...e, account: e.accounts.sort().join(', ')}));
    rows.sort((a, b) =>
        (a.account === '') - (b.account === '') ||
        a.account.localeCompare(b.account) ||
        a.name.localeCompare(b.name));
    return rows;
}

// The switch of a calendar: the same one GNOME Calendar uses ("Selected"
// of the source), so turning a calendar off here turns it off there too
export function setCalendarShown(cal, shown) {
    return Promise.all(cal.paths.map(path => setCalendarSelected(path, shown)));
}

function trayGroups() {
    const trayOn = settings => settings.get_string('tray-mode') !== 'disabled';
    return [
        {kind: 'appindicator',
            text: _('Tray icons need the “AppIndicator and KStatusNotifierItem Support” extension: turn it on')},
        {
            rows: [
                {type: 'choice', key: 'tray-mode', title: _('Icons inside the panel'),
                    description: _('Top bar icons moved to the top of the panel'),
                    options: [
                        ['all-tray', _('Tray icons of applications')],
                        ['all-right-icons', _('All icons on the right side')],
                        ['disabled', _('None, leave them in the top bar')],
                    ]},
            ],
        },
        {
            kind: 'apps',
            title: _('Apps inside the panel'),
            description: _('Choose, among the icons present now, which ones move inside the panel and which stay in the top bar.'),
            apps: {
                seenKey: 'tray-items-seen', listKey: 'tray-excluded', listMeansOn: false,
                emptyTitle: _('No icons found yet'),
                emptySubtitle: _('Open the panel once: the list fills in by itself'),
                enabledWhen: trayOn, watchKeys: ['tray-mode'],
            },
        },
        {
            title: _('Menus of the icons'),
            rows: [
                {type: 'switch', key: 'tray-menus-inside', title: _('Menus inside the panel'),
                    subtitle: _('Clicking a tray icon shows its menu inside the panel, in place of the cards, instead of a floating menu. Back with the arrow, Esc or another click on the icon.')},
                {type: 'switch', key: 'tray-menu-blend', title: _('Menu blended into the panel'),
                    subtitle: _('On: the menu of the app sits directly on the panel, without a card around it, so it looks part of the panel.')},
                {type: 'switch', key: 'tray-menu-fill', title: _('Calendar and clocks under the menus'),
                    subtitle: _('On: under the menu of an app the calendar row, the world clocks with alarms and timers, and the bottom buttons stay visible, in the room the menu leaves free.')},
            ],
        },
        {
            title: _('System updates'),
            rows: [
                {type: 'switch', key: 'updates-tray-icon', title: _('Button for system updates'),
                    subtitle: _('When no update program has an icon of its own in the tray, a button next to the gear shows how many updates there are, only while there are some, and opens the System updates page. Checked when the panel opens, at most once an hour.')},
            ],
        },
        {
            kind: 'apps',
            title: _('Menu inside the panel, icon by icon'),
            description: _('Switch off an icon to keep its menu floating (e.g. an app whose menu does not look right inside).'),
            apps: {
                seenKey: 'tray-items-seen', listKey: 'tray-menus-floating', listMeansOn: false,
                emptyTitle: _('No icons found yet'),
                emptySubtitle: _('Open the panel once: the list fills in by itself'),
                enabledWhen: settings => trayOn(settings) && settings.get_boolean('tray-menus-inside'),
                watchKeys: ['tray-mode', 'tray-menus-inside'],
            },
        },
    ];
}

function calendarGroups() {
    return [
        {
            rows: [
                {type: 'switch', key: 'show-today-events', title: _('Today’s events'),
                    subtitle: _('A card with the events of the day above the notifications; click it to open the calendar beside the panel')},
            ],
        },
        {
            kind: 'calendars',
            title: _('Calendars shown'),
            description: _('Choose which calendars appear in the panel and in GNOME Calendar. This does not change your online accounts.'),
            emptyTitle: _('No calendars found'),
            emptySubtitle: _('Calendars come from the online accounts in GNOME Settings'),
        },
    ];
}

const SCRIPT = 'install-login-screen.sh';
// the raw file: the browser shows the script itself, to be saved as it is
const SCRIPT_URL = `https://raw.githubusercontent.com/bria-bria/smart-calendar-hub/main/${SCRIPT}`;

// Everything to be done outside the extension, by hand: apps and extensions
// it relies on, extensions that do the same things, calendar reminders, the
// login screen (a script run by the user in a terminal: the extension never
// runs anything as administrator)
function byHandGroups() {
    const dropIn = '~/.config/systemd/user/evolution-alarm-notify.service.d';
    return [
        {
            title: _('What it uses'),
            description: _('Install them from your distribution or from GNOME Software.'),
            rows: [
                {type: 'info', icon: 'application-x-addon-symbolic', title: _('AppIndicator and KStatusNotifierItem Support'),
                    subtitle: _('Extension: it creates the tray icons that Smart Calendar Hub moves into the panel. Keep it on.')},
                {type: 'info', icon: 'weather-few-clouds-symbolic', title: _('GNOME Weather'),
                    subtitle: _('The weather and its cities: add your cities there.')},
                {type: 'info', icon: 'alarm-symbolic', title: _('GNOME Clocks'),
                    subtitle: _('World clocks, alarms and timers shown at the bottom of the panel: add them there.')},
                {type: 'info', icon: 'x-office-calendar-symbolic', title: _('GNOME Calendar'),
                    subtitle: _('“New event” and the calendars of your online accounts (GNOME Settings → Online Accounts).')},
            ],
        },
        {
            title: _('Extensions to switch off'),
            description: _('They do the same things: with both on, the top bar may show them twice or they fight over it.'),
            rows: [
                {type: 'info', icon: 'weather-overcast-symbolic', title: "Weather O'Clock",
                    subtitle: _('Weather inside the clock pill: Panel → Weather.')},
                {type: 'info', icon: 'view-more-horizontal-symbolic', title: 'Status Area Horizontal Spacing',
                    subtitle: _('Space between the top bar icons: Panel → Appearance.')},
                {type: 'info', icon: 'applications-graphics-symbolic', title: 'DashCraft',
                    subtitle: _('Only its "Items Color": accent colour in the top bar, Panel → Appearance.')},
            ],
        },
        {
            title: _('Calendar reminders'),
            description: _('On some systems the reminders of your events never show up: the service that sends them (evolution-alarm-notify) does not start in GNOME. These two commands start it at every login, without the option that stops it (the path of the service is taken from your system).'),
            rows: [
                {type: 'command', title: _('1. In a terminal'),
                    command: `mkdir -p ${dropIn} && printf '[Service]\\nExecStart=\\n%s\\n' "$(grep -m1 '^ExecStart=' "$(systemctl --user show -P FragmentPath evolution-alarm-notify.service)" | sed 's/ --autostart//')" > ${dropIn}/senza-autostart.conf`},
                {type: 'command', title: _('2. Then'),
                    command: 'systemctl --user daemon-reload && systemctl --user restart evolution-alarm-notify.service'},
                {type: 'command', title: _('To undo it'),
                    command: `rm ${dropIn}/senza-autostart.conf && systemctl --user daemon-reload && systemctl --user restart evolution-alarm-notify.service`},
            ],
        },
        {
            title: _('Lock screen'),
            description: _('Automatic: on the lock screen the top bar keeps the accent colour, the space between the icons, the clock position and the battery circle. The side panel, the notifications and the calendar are taken away while the screen is locked, so nothing personal shows.'),
            rows: [],
        },
        {
            title: _('Login screen'),
            description: _('The screen where you choose the user belongs to the system: Smart Calendar Hub cannot change it by itself. A script, run by you in a terminal, installs the extension for all users and copies your accent colour, icon spacing, clock position and battery circle there.'),
            rows: [
                {type: 'info', icon: 'dialog-warning-symbolic', title: _('It needs the administrator password'),
                    subtitle: _('It writes to /usr/share/gnome-shell/extensions and to /etc/dconf (settings of the gdm user). Read the script before running it.')},
                {type: 'link', title: _('1. Download the script'),
                    subtitle: _('It opens in the browser: save it with Ctrl+S in a folder of yours'),
                    button: _('Open the page'), url: SCRIPT_URL},
                {type: 'command', title: _('2. In a terminal, in that folder'), command: `sudo bash ${SCRIPT}`},
                {type: 'info', title: _('3. Log out'),
                    subtitle: _('The login screen shows the change. Run the script again after changing those settings or updating the extension.')},
            ],
        },
        {
            title: _('Back to the login screen as it was'),
            rows: [
                {type: 'command', title: _('In a terminal, in the folder of the script'), command: `sudo bash ${SCRIPT} --remove`},
            ],
        },
    ];
}

// Built when asked, so the texts are in the language loaded by then
export function settingsSections() {
    return [
        {id: 'panel', title: _('Panel'), icon: 'view-dual-symbolic', groups: panelGroups()},
        {id: 'tray', title: _('Tray'), icon: 'view-app-grid-symbolic', groups: trayGroups()},
        {id: 'calendars', title: _('Calendars'), icon: 'x-office-calendar-symbolic', groups: calendarGroups()},
        {id: 'notifications', title: _('Notifications'), icon: 'preferences-system-notifications-symbolic',
            groups: notificationGroups()},
        {id: 'network', title: _('Network'), icon: 'network-workgroup-symbolic', groups: networkGroups()},
        {id: 'extensions', title: _('Extensions'), icon: 'application-x-addon-symbolic', groups: extensionGroups()},
        {id: 'by-hand', title: _('By hand'), icon: 'utilities-terminal-symbolic', groups: byHandGroups()},
    ];
}
