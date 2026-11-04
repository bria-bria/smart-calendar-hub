// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Calendars known to evolution-data-server (name, colour, account), read over
// D-Bus. Gio/GLib only, so both the side panel (sch-calendar.js) and the
// preferences window (prefs.js) can use it.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// GNOME Shell already does this; the preferences process does not
Gio._promisify(Gio.DBusConnection.prototype, 'call');

const EDS_SOURCES = 'org.gnome.evolution.dataserver.Sources5';
const EDS_PATH = '/org/gnome/evolution/dataserver/SourceManager';
const SOURCE_IFACE = 'org.gnome.evolution.dataserver.Source';

export const FALLBACK_COLOR = '#62a0ea';

// Only #rgb / #rrggbb colours are used in styles and markup
export function safeColor(color) {
    return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color ?? '') ? color : FALLBACK_COLOR;
}

function readString(keyFile, group, key, localized = false) {
    try {
        return localized
            ? keyFile.get_locale_string(group, key, null)
            : keyFile.get_string(group, key);
    } catch (_e) {
        return null;
    }
}

// Returns [{uid, name, color, account}] for every calendar (sources with a
// [Calendar] group). account = name of the parent source (e.g. the Google
// address), or '' when there is none.
export async function loadCalendars(cancellable = null) {
    const reply = await Gio.DBus.session.call(EDS_SOURCES, EDS_PATH,
        'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects', null,
        new GLib.VariantType('(a{oa{sa{sv}}})'), Gio.DBusCallFlags.NONE, -1,
        cancellable);
    const [objects] = reply.recursiveUnpack();

    const names = new Map(); // uid -> display name, for every source
    const calendars = [];
    for (const ifaces of Object.values(objects)) {
        const props = ifaces[SOURCE_IFACE];
        if (!props?.UID || !props.Data)
            continue;
        const keyFile = new GLib.KeyFile();
        try {
            // the length is in bytes (GJS refuses -1 for this gsize argument)
            keyFile.load_from_data(props.Data, new TextEncoder().encode(props.Data).length,
                GLib.KeyFileFlags.NONE);
        } catch (_e) {
            continue; // malformed source
        }
        const name = readString(keyFile, 'Data Source', 'DisplayName', true) ?? props.UID;
        names.set(props.UID, name);
        if (keyFile.has_group('Calendar')) {
            calendars.push({
                uid: props.UID,
                name,
                color: safeColor(readString(keyFile, 'Calendar', 'Color')),
                parent: readString(keyFile, 'Data Source', 'Parent') ?? '',
            });
        }
    }
    return calendars.map(({uid, name, color, parent}) => ({
        uid, name, color,
        // local "stubs" (On This Computer, Contacts, Weather) are not accounts
        account: parent.endsWith('-stub') ? '' : names.get(parent) ?? '',
    }));
}
