// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The settings of another extension in the card beside the panel, built
// with our page kit: in the panel, the items of its menu that open its
// preferences window open this card instead (a GTK window cannot be shown
// inside GNOME Shell), with everything its window has. They are the
// extension's own settings, read from the schema in its own folder; only
// the keys and values its installed version knows are shown.
//
// SETTINGS_SWAPS: the top bar role of the extension → how to find its items
// (the texts it gives them, in its own translation) and how to build the page.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {_} from './sch-i18n.js';
import {pageKit as kit} from './sch-page-kit.js';
import {buildLocation, vesperalLocation} from './sch-vesperal-location.js';
import {buildYearChart} from './sch-year-chart.js';

// The settings of extension `uuid`, from the schema in its own folder; null
// when it is not installed or has no such schema
function extensionSettings(uuid, schemaId) {
    const path = Main.extensionManager.lookup(uuid)?.path;
    if (!path)
        return null;
    // the same way GNOME reads the settings of an extension (getSettings)
    try {
        const source = Gio.SettingsSchemaSource.new_from_directory(`${path}/schemas`,
            Gio.SettingsSchemaSource.get_default(), false);
        const schema = source.lookup(schemaId, false);
        return schema ? new Gio.Settings({settings_schema: schema}) : null;
    } catch (_e) {
        return null; // no compiled schema in its folder
    }
}

// The values an enum key accepts, from the schema: [] if it is not one
function enumValues(settings, key) {
    if (!settings.settings_schema.has_key(key))
        return [];
    const [type, values] = settings.settings_schema.get_key(key).get_range().deepUnpack();
    return type === 'enum' ? values.deepUnpack?.() ?? values : [];
}

const check = () => new St.Icon({icon_name: 'object-select-symbolic', icon_size: 16});

// A small round button with an icon, as the arrows of the calendar
function roundButton(icon, label, onClick) {
    const btn = new St.Button({
        style_class: 'sch-cal-arrow',
        can_focus: true,
        accessible_name: label,
        y_align: Clutter.ActorAlign.CENTER,
        child: new St.Icon({icon_name: icon, icon_size: 16}),
    });
    btn.connect('clicked', onClick);
    return btn;
}

// The rows of one card (see buildPage) and how to bring them up to date
function cardRows(settings, card, syncs, rebuild) {
    const schema = settings.settings_schema;
    const rows = [];
    if (card.switches) {
        for (const [key, title, subtitle = ''] of card.switches) {
            if (!schema.has_key(key))
                continue;
            const sw = kit.toggle({
                active: settings.get_boolean(key),
                onToggle: state => settings.set_boolean(key, state),
            });
            rows.push(kit.row({title, subtitle, trailing: sw}));
            syncs.push(() => {
                sw.state = settings.get_boolean(key);
            });
        }
    } else if (card.flags) {
        // a list of strings: a check on each one in it, a click adds or
        // takes it away (kept in the order of the card)
        const {key, values} = card.flags;
        if (!schema.has_key(key))
            return rows;
        for (const [value, title] of values) {
            const row = kit.row({
                title,
                onActivate: () => {
                    const now = settings.get_strv(key);
                    const on = !now.includes(value);
                    settings.set_strv(key, values.map(([v]) => v)
                        .filter(v => (v === value ? on : now.includes(v))));
                },
            });
            rows.push(row);
            let checked = false;
            syncs.push(() => {
                if (checked !== settings.get_strv(key).includes(value)) {
                    checked = !checked;
                    row.setTrailing(checked ? check() : null);
                }
            });
        }
    } else if (card.stepper) {
        const {key, title, min, max, step: by = 1, format} = card.stepper;
        if (!schema.has_key(key))
            return rows;
        const shown = kit.value('');
        const step = sign => settings.set_int(key,
            Math.max(min, Math.min(max, settings.get_int(key) + sign * by)));
        const box = new St.BoxLayout({style_class: 'sch-ext-stepper', y_align: Clutter.ActorAlign.CENTER});
        const less = roundButton('list-remove-symbolic', _('Less'), () => step(-1));
        const more = roundButton('list-add-symbolic', _('More'), () => step(1));
        box.add_child(less);
        box.add_child(shown);
        box.add_child(more);
        const row = kit.row({title, trailing: box});
        // the buttons answer on their own: switched off with the row
        row.schParts = [less, more];
        rows.push(row);
        syncs.push(() => {
            shown.text = format(settings.get_int(key));
        });
    } else {
        const isInt = !!card.ints;
        if (isInt && !schema.has_key(card.key))
            return rows;
        const options = isInt
            ? card.ints
            : enumValues(settings, card.key).map(value => [value, card.labels[value] ?? value]);
        const get = () => (isInt ? settings.get_int(card.key) : settings.get_string(card.key));
        const set = value => (isInt ? settings.set_int(card.key, value) : settings.set_string(card.key, value));
        // a value that makes the extension build its menu anew: set after
        // the click, then the card comes back (extension.js)
        const choose = value => (card.rebuilds && rebuild
            ? rebuild(() => set(value)) : set(value));
        for (const [value, title] of options) {
            const row = kit.row({title, onActivate: () => {
                if (get() !== value)
                    choose(value);
            }});
            rows.push(row);
            let checked = false;
            syncs.push(() => {
                if (checked !== (get() === value)) {
                    checked = !checked;
                    row.setTrailing(checked ? check() : null);
                }
            });
        }
        if (card.subtitles) {
            syncs.push(() => {
                const details = card.subtitles(settings);
                options.forEach(([value], i) => {
                    rows[i].subtitleLabel.text = details[value] ?? '';
                });
            });
        }
    }
    if (card.enabledWhen && rows.length) {
        syncs.push(() => {
            const on = card.enabledWhen(settings);
            for (const row of rows) {
                row.setSensitive(on);
                for (const part of row.schParts ?? [])
                    part.reactive = part.can_focus = on;
            }
        });
    }
    return rows;
}

// A page made of cards, each one of:
//   {title, key, labels: {value: label}}       an enum key: one row per value
//                                              (a check on the chosen one)
//   {title, key, ints: [[value, label], …]}    an integer key, the same way
//   {title, switches: [[key, label, detail?], …]}  boolean keys, a switch each
//   {title, flags: {key, values: [[value, label], …]}}  a list of strings:
//                                              a check on each one in it
//   {title, stepper: {key, title, min, max, step?, format}}  an integer, − and +
//   {build: settings => [actors]}              pieces made elsewhere
// and, for the cards with rows:
//   subtitles: settings => {value: detail}     (enum and integer cards) the
//                                              detail under each row, followed
//   enabledWhen: settings => bool              greyed out when false
//   rebuilds: true                             (enum and integer cards) a new
//                                              value rebuilds the extension's
//                                              menu: ctx.rebuild(change)
// (title '' = a card under the one before, with no title of its own)
function buildPage(settings, cards, ctx = {}) {
    const pieces = [];
    const syncs = [];
    for (const card of cards) {
        if (card.build) {
            pieces.push(...card.build(settings));
            continue;
        }
        const rows = cardRows(settings, card, syncs, ctx.rebuild);
        if (!rows.length)
            continue;
        if (card.title)
            pieces.push(kit.section(card.title));
        pieces.push(kit.card(rows));
    }
    const sync = () => syncs.forEach(fn => fn());
    sync();
    const page = kit.page(pieces);
    const changedId = settings.connect('changed', sync);
    page.connect('destroy', () => settings.disconnect(changedId));
    return page;
}

// The string of `key`, or `fallback` when the installed Vesperal has no
// such key (an older version)
function stringOf(settings, key, fallback) {
    return settings.settings_schema.has_key(key) ? settings.get_string(key) : fallback;
}

const TWILIGHT_DEPTH = {civil: -6, nautical: -12, astronomical: -18};

// Where Vesperal's day begins and ends, as the sun's altitude: undefined
// for sunrise and sunset (dayLength's own), the twilight for dawn and dusk
function dayHorizon(settings) {
    if (stringOf(settings, 'phase-bounds', 'sunrise-sunset') !== 'dawn-dusk')
        return undefined;
    return TWILIGHT_DEPTH[stringOf(settings, 'twilight', 'civil')];
}

// The year at a glance of Vesperal, built again when its place or the
// bounds of its day change
function vesperalYear(settings) {
    const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'sch-ext-group', x_expand: true});
    const fill = () => {
        box.destroy_all_children();
        for (const piece of buildYearChart(vesperalLocation(settings), dayHorizon(settings)))
            box.add_child(piece);
    };
    fill();
    const keys = ['location-mode', 'manual-location', 'last-known-location', 'twilight', 'phase-bounds']
        .filter(key => settings.settings_schema.has_key(key));
    const ids = keys.map(key => settings.connect(`changed::${key}`, fill));
    box.connect('destroy', () => ids.forEach(id => settings.disconnect(id)));
    return [box];
}

// The details of the readings, which follow the bounds of the day
function readingDetails(settings) {
    const fromDawn = stringOf(settings, 'phase-bounds', 'sunrise-sunset') === 'dawn-dusk';
    return fromDawn ? {
        remaining: _('Until the next dawn or dusk'),
        elapsed: _('Since the last dawn or dusk'),
        'elapsed-and-remaining': _('Since the last dawn or dusk, and until the next'),
    } : {
        remaining: _('Until the next sunrise or sunset'),
        elapsed: _('Since the last sunrise or sunset'),
        'elapsed-and-remaining': _('Since the last sunrise or sunset, and until the next'),
    };
}

const notifying = settings => settings.get_boolean('notifications');

// Vesperal (extensions.gnome.org/extension/11329): everything of its
// window (version 4: the year at a glance and the notifications first,
// then what the top bar shows, the twilight, the bounds of the day, the
// location), in the card; the
// keys an older version does not have are left out
function vesperalCards() {
    return [
        // first, at Michele's request: the year at a glance, then the
        // notifications, then the rest
        {build: vesperalYear},
        {title: _('Notifications'), switches: [['notifications', _('Send notifications')]]},
        {title: '', flags: {key: 'notification-events', values: [
            ['dawn', _('Dawn')],
            ['sunrise', _('Sunrise')],
            ['sunset', _('Sunset')],
            ['dusk', _('Dusk')],
        ]}, enabledWhen: notifying},
        {title: '', stepper: {
            key: 'notification-lead-time', title: _('Notify ahead by'), min: 0, max: 180, step: 5,
            format: minutes => (minutes ? _('{minutes} min', {minutes}) : _('At the event')),
        }, enabledWhen: notifying},
        {key: 'bar-content', title: _('In the top bar'), labels: {
            'arc-and-duration': _('Sun arc and duration'),
            arc: _('Sun arc only'),
            duration: _('Duration only'),
        }},
        {key: 'reading', title: _('Duration'), labels: {
            remaining: _('Remaining time'),
            elapsed: _('Elapsed time'),
            'elapsed-and-remaining': _('Elapsed and remaining time'),
        }, subtitles: readingDetails},
        {key: 'sun-arc-position', title: _('Arc of the sun'), labels: {
            left: _('Left of the duration'),
            right: _('Right of the duration'),
        }, enabledWhen: settings => stringOf(settings, 'bar-content', 'arc-and-duration') === 'arc-and-duration'},
        {key: 'indicator-position', title: _('Place of its icon'), labels: {
            'next-to-clock': _('Next to the clock'),
            left: _('Left side'),
            right: _('Right side'),
        }, subtitles: () => ({
            left: _('After the workspace indicator'),
            right: _('Before the system indicators'),
        }), rebuilds: true},
        {key: 'twilight', title: _('Dawn and dusk'), labels: {
            civil: _('Civil twilight (6°)'),
            nautical: _('Nautical twilight (12°)'),
            astronomical: _('Astronomical twilight (18°)'),
        }},
        {key: 'phase-bounds', title: _('Day and night'), labels: {
            'sunrise-sunset': _('From sunrise to sunset'),
            'dawn-dusk': _('From dawn to dusk'),
        }, subtitles: () => ({
            'dawn-dusk': _('As long as there is the light of the twilight above'),
        })},
        {build: buildLocation},
    ];
}

// Freon (extensions.gnome.org/extension/841): everything of its window but
// its place in the top bar, which does not matter with the hub (its icon is
// in our tray)
function freonCards() {
    return [
        {title: _('In the menu'), switches: [
            ['show-temperature', _('Temperatures')],
            ['show-rotationrate', _('Fans')],
            ['show-voltage', _('Voltages')],
            ['show-power', _('Power')],
            ['show-battery-stats', _('Battery')],
        ]},
        {title: _('Grouped in a sub-menu'), switches: [
            ['group-temperature', _('Temperatures')],
            ['group-rotationrate', _('Fans')],
            ['group-voltage', _('Voltages')],
        ]},
        {title: _('Unit'), key: 'unit', ints: [[0, _('Celsius (°C)')], [1, _('Fahrenheit (°F)')]]},
        {title: '', switches: [['show-decimal-value', _('Decimal values')]]},
        {title: _('In the top bar'), switches: [
            ['show-icon-on-panel', _('Icon')],
            ['show-temperature-unit', _('Temperature unit')],
            ['show-rotationrate-unit', _('Fan speed unit')],
            ['show-voltage-unit', _('Voltage unit')],
            ['show-power-unit', _('Power unit')],
        ]},
        {title: _('Readings'), stepper: {
            key: 'update-time', title: _('Read the sensors every'), min: 1, max: 60,
            format: seconds => _('{seconds} s', {seconds}),
        }},
        {title: _('Sensor sources'), switches: [
            ['use-generic-lmsensors', 'lm-sensors', _('Processor and motherboard')],
            ['use-generic-liquidctl', 'liquidctl', _('Liquid coolers')],
        ]},
        {title: 'FreeIPMI', key: 'freeimpi-selected', ints: [[0, _('Off')], [1, _('Direct')], [2, 'pkexec']]},
        {title: _('Graphics card'), switches: [
            ['use-gpu-nvidia', 'NVIDIA'],
            ['use-gpu-bumblebeenvidia', 'Bumblebee + NVIDIA'],
            ['use-gpu-aticonfig', 'Catalyst'],
        ]},
        {title: _('Disks'), switches: [
            ['use-drive-udisks2', 'Udisks2'],
            ['use-drive-hddtemp', 'Hddtemp'],
            ['use-drive-smartctl', 'smartctl'],
            ['use-drive-nvmecli', 'nvme-cli'],
        ]},
    ];
}

function swap({uuid, schemaId, domain, texts, name, cards}) {
    return Object.freeze({
        uuid, domain, texts, name,
        // null when its settings cannot be read: its own window then
        settings: () => extensionSettings(uuid, schemaId),
        build: (settings, ctx) => buildPage(settings, cards(), ctx),
    });
}

export const SETTINGS_SWAPS = Object.freeze({
    'vesperal@kornifex.github.io': swap({
        uuid: 'vesperal@kornifex.github.io',
        schemaId: 'org.gnome.shell.extensions.vesperal',
        // the item it adds with menu.addAction(), and the one that, while
        // it knows no location, opens its window to set one
        domain: 'vesperal', texts: ['Preferences', 'Set a location manually…'],
        name: 'Vesperal', cards: vesperalCards,
    }),
    freonMenu: swap({
        uuid: 'freon@UshakovVasilii_Github.yahoo.com',
        schemaId: 'org.gnome.shell.extensions.freon',
        // the last item of its menu (_appendStaticMenuItems)
        domain: 'freon', texts: ['Sensor Settings'],
        name: 'Freon', cards: freonCards,
    }),
});
