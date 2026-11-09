// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The alarms and timers of GNOME Clocks. Installed from the system it keeps
// them in GSettings (schema org.gnome.clocks); installed as a Flatpak
// (Flathub gives it no access to dconf) in the keyfile of its sandbox, read
// here asynchronously and again whenever it changes.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {logError} from './sch-log.js';

export const CLOCKS_ID = 'org.gnome.clocks';
export const CLOCKS_DESKTOP = `${CLOCKS_ID}.desktop`;
// the keyfile of GLib's settings inside the Flatpak sandbox, and its group
// for the schema org.gnome.clocks (path /org/gnome/clocks/)
const FLATPAK_KEYFILE = ['.var', 'app', CLOCKS_ID, 'config', 'glib-2.0', 'settings', 'keyfile'];
const KEYFILE_GROUP = 'org/gnome/clocks';
const KEYFILE_DELAY_MS = 300; // one read for the burst of events of one save

Gio._promisify(Gio.File.prototype, 'load_contents_async');

// {alarms, timers} of the keyfile of GNOME Clocks in Flatpak, unpacked like
// GSettings values; a key never changed in GNOME Clocks is not in the file
function parseClocksKeyfile(bytes) {
    const keyfile = new GLib.KeyFile();
    keyfile.load_from_bytes(new GLib.Bytes(bytes), GLib.KeyFileFlags.NONE);
    // (has_key() is not available from JavaScript)
    const keys = keyfile.has_group(KEYFILE_GROUP) ? keyfile.get_keys(KEYFILE_GROUP)[0] : [];
    const read = key => {
        if (!keys.includes(key))
            return [];
        const text = keyfile.get_value(KEYFILE_GROUP, key);
        return GLib.Variant.parse(new GLib.VariantType('aa{sv}'), text, null, null).recursiveUnpack();
    };
    return {alarms: read('alarms'), timers: read('timers')};
}

export class ClocksSource {
    // onChanged(): the alarms or the timers changed, or were read at last
    // (never called from the constructor)
    constructor(onChanged) {
        this._onChanged = onChanged;
        this.kind = null; // 'host', 'flatpak' or 'none'
        this.loaded = false; // alarms and timers read at least once
        this._values = {alarms: [], timers: []}; // read from the Flatpak keyfile
        this._keyfileId = 0;
        // again when apps are installed or removed
        this._appSystem = Shell.AppSystem.get_default();
        this._appSystem.connectObject('installed-changed', () => this._sync(), this);
        this._sync(false);
    }

    destroy() {
        this._appSystem?.disconnectObject(this);
        this._appSystem = null;
        this._drop();
        this._onChanged = null;
    }

    // The alarms or the timers of GNOME Clocks, unpacked: [] when it is not
    // installed or has none
    read(key) {
        if (this.kind === 'host')
            return this._settings.get_value(key).recursiveUnpack();
        return this._values[key] ?? [];
    }

    // Which GNOME Clocks is installed: the one GNOME starts (its .desktop
    // file; a Flatpak one has X-Flatpak), else the schema of a system one
    _sync(notify = true) {
        const info = this._appSystem.lookup_app(CLOCKS_DESKTOP)?.get_app_info();
        const schema = Gio.SettingsSchemaSource.get_default()?.lookup(CLOCKS_ID, true);
        let kind = 'none';
        if (info?.has_key('X-Flatpak'))
            kind = 'flatpak';
        else if (schema)
            kind = 'host';
        if (kind === this.kind)
            return;
        this._drop();
        this.kind = kind;
        this.loaded = kind !== 'flatpak';
        if (kind === 'host') {
            this._settings = new Gio.Settings({settings_schema: schema});
            this._settings.connectObject(
                'changed::alarms', () => this._onChanged?.(),
                'changed::timers', () => this._onChanged?.(), this);
        } else if (kind === 'flatpak') {
            this._keyfile = Gio.File.new_for_path(
                GLib.build_filenamev([GLib.get_home_dir(), ...FLATPAK_KEYFILE]));
            // GLib saves the keyfile by writing a new one and renaming it:
            // any event on it means "read it again"
            this._keyfileMonitor = this._keyfile.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._keyfileMonitor.connectObject('changed', () => this._scheduleKeyfileRead(), this);
            this._readKeyfile();
        }
        if (notify)
            this._onChanged?.();
    }

    _drop() {
        this._settings?.disconnectObject(this);
        this._settings = null;
        this._keyfileMonitor?.disconnectObject(this);
        this._keyfileMonitor?.cancel();
        this._keyfileMonitor = null;
        this._keyfileCancel?.cancel();
        this._keyfileCancel = null;
        this._keyfile = null;
        if (this._keyfileId)
            GLib.source_remove(this._keyfileId);
        this._keyfileId = 0;
        this._values = {alarms: [], timers: []};
        this.kind = null;
    }

    _scheduleKeyfileRead() {
        if (this._keyfileId)
            GLib.source_remove(this._keyfileId);
        this._keyfileId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, KEYFILE_DELAY_MS, () => {
            this._keyfileId = 0;
            this._readKeyfile();
            return GLib.SOURCE_REMOVE;
        });
    }

    // The keyfile of GNOME Clocks in Flatpak, read without blocking GNOME
    // Shell; missing (GNOME Clocks never saved anything): no alarms. Not
    // readable: what was read before stays (and so do the countdowns)
    async _readKeyfile() {
        this._keyfileCancel?.cancel();
        const cancel = new Gio.Cancellable();
        this._keyfileCancel = cancel;
        let values = {alarms: [], timers: []};
        try {
            const [bytes] = await this._keyfile.load_contents_async(cancel);
            values = parseClocksKeyfile(bytes);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                logError(`GNOME Clocks (Flatpak): ${e}`);
                if (this._keyfileCancel === cancel)
                    this._keyfileCancel = null;
                return;
            }
        }
        if (this._keyfileCancel !== cancel)
            return;
        this._keyfileCancel = null;
        this._values = values;
        this.loaded = true;
        this._onChanged?.();
    }
}
