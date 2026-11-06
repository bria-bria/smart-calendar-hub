// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The settings of Smart Calendar Hub described once, for both places that
// show them: the Preferences window (prefs.js, with Adw and GTK) and the
// card beside the panel (sch-hub-settings.js, with St and our page kit).
// A new setting written here appears in both. Neither GTK nor St here.
//
// settingsSections() → the sections, in order:
//   {id, title, icon, groups}   groups null = built by each place on its own
//                               (not described here yet)
// a group:
//   {title?, description?, rows}  description: a text, or
//                               (settings, env) => text | null
//   {custom: 'id'}              a whole group each place builds itself
// a row:
//   {type: 'switch', key, title, subtitle?, children?}  a boolean key;
//        children: rows that matter only while it is on (the Preferences
//        show them inside it, as an expander with its own switch)
//   {type: 'check', key, title, subtitle?}   a boolean key, as a check box
//   {type: 'choice', key, title, description, options: [[value, label], …]}
//   {type: 'number', key, title, subtitle?, min, max, step, page}
//   {type: 'custom', id}        a row each place builds itself
// and, on any row:
//   enabledWhen: settings => bool      greyed out when false
//   visibleWhen: (settings, env) => bool
// env: what does not come from our settings, followed by each place:
//   env.bii  the state of Battery Indicator Icon: 'active', 'off'
//            (installed, can be switched on), 'missing', or null (not known)

import {_} from './sch-i18n.js';

// Battery Indicator Icon by Deminder, from which the idea of our battery
// circle comes: while it is active it draws the battery and our circle steps
// aside (sch-battery.js)
export const BII_UUID = 'battery-indicator-icon@Deminder';
export const BII_PROJECT_URL = 'https://github.com/Deminder/battery-indicator-icon';
export const BII_EGO_URL = 'https://extensions.gnome.org/extension/5718/battery-indicator-icon/';

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
        {custom: 'muted-apps'},
        {custom: 'red-dot'},
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
                    _('The address of this computer in the network it is connected to now')),
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
                    subtitle: _('The address in the network you are connected to now'), enabledWhen: panelIpOn},
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

// Built when asked, so the texts are in the language loaded by then
export function settingsSections() {
    return [
        {id: 'panel', title: _('Panel'), icon: 'view-dual-symbolic', groups: panelGroups()},
        {id: 'tray', title: _('Tray'), icon: 'view-app-grid-symbolic', groups: null},
        {id: 'calendars', title: _('Calendars'), icon: 'x-office-calendar-symbolic', groups: null},
        {id: 'notifications', title: _('Notifications'), icon: 'preferences-system-notifications-symbolic',
            groups: notificationGroups()},
        {id: 'network', title: _('Network'), icon: 'network-workgroup-symbolic', groups: networkGroups()},
        {id: 'extensions', title: _('Extensions'), icon: 'application-x-addon-symbolic', groups: extensionGroups()},
        {id: 'by-hand', title: _('By hand'), icon: 'utilities-terminal-symbolic', groups: null},
    ];
}
