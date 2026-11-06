// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Calendars known to evolution-data-server (name, colour, account), read over
// D-Bus. Gio/GLib only: used by the calendar of the panel (sch-calendar.js)
// and by the settings (sch-settings-model.js).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// GNOME Shell already does this; the preferences process does not
Gio._promisify(Gio.DBusConnection.prototype, 'call');

const EDS_SOURCES = 'org.gnome.evolution.dataserver.Sources5';
const EDS_PATH = '/org/gnome/evolution/dataserver/SourceManager';
const SOURCE_IFACE = 'org.gnome.evolution.dataserver.Source';
const WRITABLE_IFACE = 'org.gnome.evolution.dataserver.Source.Writable';

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

// Returns [{uid, path, name, color, selected, account}] for every calendar
// (sources with a [Calendar] group). selected = shown, the same switch GNOME
// Calendar uses. account = name of the parent source (e.g. the Google
// address), or '' when there is none.
export async function loadCalendars(cancellable = null) {
    const reply = await Gio.DBus.session.call(EDS_SOURCES, EDS_PATH,
        'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects', null,
        new GLib.VariantType('(a{oa{sa{sv}}})'), Gio.DBusCallFlags.NONE, -1,
        cancellable);
    const [objects] = reply.recursiveUnpack();

    const names = new Map(); // uid -> display name, for every source
    const calendars = [];
    for (const [path, ifaces] of Object.entries(objects)) {
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
            let selected = true;
            try {
                selected = keyFile.get_boolean('Calendar', 'Selected');
            } catch (_e) {
                // not set: shown
            }
            calendars.push({
                uid: props.UID,
                path,
                selected,
                writable: WRITABLE_IFACE in ifaces,
                name,
                color: safeColor(readString(keyFile, 'Calendar', 'Color')),
                parent: readString(keyFile, 'Data Source', 'Parent') ?? '',
            });
        }
    }
    return calendars.map(({uid, path, selected, writable, name, color, parent}) => ({
        uid, path, selected, writable, name, color,
        // local "stubs" (On This Computer, Contacts, Weather) are not accounts
        account: parent.endsWith('-stub') ? '' : names.get(parent) ?? '',
    }));
}

// Shows or hides a calendar the way GNOME Calendar does: rewrites the
// "Selected" key of its source. GNOME Calendar and GNOME Shell follow it.
export async function setCalendarSelected(path, selected, cancellable = null) {
    const reply = await Gio.DBus.session.call(EDS_SOURCES, path,
        'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', [SOURCE_IFACE, 'Data']),
        new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, -1, cancellable);
    const data = reply.recursiveUnpack()[0];
    const keyFile = new GLib.KeyFile();
    keyFile.load_from_data(data, new TextEncoder().encode(data).length,
        GLib.KeyFileFlags.KEEP_COMMENTS | GLib.KeyFileFlags.KEEP_TRANSLATIONS);
    keyFile.set_boolean('Calendar', 'Selected', selected);
    const [newData] = keyFile.to_data();
    await Gio.DBus.session.call(EDS_SOURCES, path, WRITABLE_IFACE, 'Write',
        new GLib.Variant('(s)', [newData]), null, Gio.DBusCallFlags.NONE, -1, cancellable);
}
