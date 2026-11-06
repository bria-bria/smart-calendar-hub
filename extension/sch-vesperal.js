// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The main settings of Vesperal (extensions.gnome.org/extension/11329) in the
// card beside the panel, built with our page kit: its "Preferences" item, in
// the panel, opens this card instead of its preferences window (a GTK window
// cannot be shown inside GNOME Shell). They are Vesperal's own settings, read
// from its schema: what it shows in the top bar, the twilight, the side of
// its arc, where the location comes from. The rest (the city search, the
// chart of the year) stays in its window, opened by the last button. Only the
// keys and values its installed version knows are shown.

import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {_} from './sch-i18n.js';
import {pageKit as kit} from './sch-page-kit.js';

export const VESPERAL_UUID = 'vesperal@kornifex.github.io';
const SCHEMA_ID = 'org.gnome.shell.extensions.vesperal';

// key → section title and the label of each value
function choices() {
    return [
        ['reading', _('In the top bar'), {
            remaining: _('Time until the next sunrise or sunset'),
            elapsed: _('Time since the last sunrise or sunset'),
        }],
        ['twilight', _('Dawn and dusk'), {
            civil: _('Civil twilight (6°)'),
            nautical: _('Nautical twilight (12°)'),
            astronomical: _('Astronomical twilight (18°)'),
        }],
        ['sun-arc-position', _('Arc of the sun'), {
            left: _('Left of the time'),
            right: _('Right of the time'),
        }],
        ['location-mode', _('Location'), {
            automatic: _('From the location services'),
            manual: _('The city chosen in its preferences'),
        }],
    ];
}

// Vesperal's settings, from the schema in its own folder; null when it is
// not installed
export function vesperalSettings() {
    const path = Main.extensionManager.lookup(VESPERAL_UUID)?.path;
    if (!path)
        return null;
    // the same way GNOME reads the settings of an extension (getSettings)
    try {
        const source = Gio.SettingsSchemaSource.new_from_directory(`${path}/schemas`,
            Gio.SettingsSchemaSource.get_default(), false);
        const schema = source.lookup(SCHEMA_ID, false);
        return schema ? new Gio.Settings({settings_schema: schema}) : null;
    } catch (_e) {
        return null; // no compiled schema in its folder
    }
}

// The values a key accepts, from the schema (an enum): [] if it is not one
function enumValues(settings, key) {
    if (!settings.settings_schema.has_key(key))
        return [];
    const [type, values] = settings.settings_schema.get_key(key).get_range().deepUnpack();
    return type === 'enum' ? values.deepUnpack?.() ?? values : [];
}

// The page: one card per setting, one row per value (a check on the chosen
// one), then the button that opens Vesperal's own window
export function buildVesperalPage(settings) {
    const pieces = [];
    const rows = [];
    for (const [key, title, labels] of choices()) {
        const values = enumValues(settings, key);
        if (!values.length)
            continue;
        const cardRows = values.map(value => {
            const row = kit.row({
                title: labels[value] ?? value,
                onActivate: () => settings.set_string(key, value),
            });
            rows.push({row, key, value});
            return row;
        });
        pieces.push(kit.section(title), kit.card(cardRows));
    }
    const sync = () => {
        for (const {row, key, value} of rows) {
            const chosen = settings.get_string(key) === value;
            row.setTrailing(chosen ? new St.Icon({icon_name: 'object-select-symbolic', icon_size: 16}) : null);
        }
    };
    sync();
    const page = kit.page(pieces, kit.buttons(kit.button({
        label: _('All the preferences of Vesperal'),
        onClick: () => Main.extensionManager.openExtensionPrefs(VESPERAL_UUID, '', {}),
    })));
    const changedId = settings.connect('changed', sync);
    page.connect('destroy', () => settings.disconnect(changedId));
    return page;
}
