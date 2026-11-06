// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Top Bar Organizer keeps its own order of the top bar items: with the
// option on, the position of our clock is written into its lists too, and
// the previous order is given back when Smart Calendar Hub goes.

import Gio from 'gi://Gio';

import {MENU_TAIL_ROLES} from './sch-topbar-style.js';
import {setStrvIfChanged} from './sch-settings-model.js';

const TBO_SCHEMA = 'org.gnome.shell.extensions.top-bar-organizer';
const TBO_KEYS = ['left-box-order', 'center-box-order', 'right-box-order'];

export class TopBarOrganizer {
    constructor(settings) {
        this._settings = settings;
        this._clockWas = undefined; // undefined = clock position not saved yet
        const schema = Gio.SettingsSchemaSource.get_default()?.lookup(TBO_SCHEMA, true);
        this._tbo = schema ? new Gio.Settings({settings_schema: schema}) : null;
    }

    // Reads the three TBO lists without 'dateMenu' and tells where it was.
    _read() {
        const lists = {};
        let where = null;
        for (const key of TBO_KEYS) {
            const list = this._tbo.get_strv(key);
            const i = list.indexOf('dateMenu');
            if (i !== -1 && !where)
                where = {key, index: i};
            lists[key] = list.filter(x => x !== 'dateMenu');
        }
        return {lists, where};
    }

    _write(lists) {
        for (const key of TBO_KEYS)
            setStrvIfChanged(this._tbo, key, lists[key]);
    }

    // Called only on enable and when a related setting changes, never on
    // panel changes: TBO reorders the panel when its settings change.
    sync() {
        if (!this._tbo || !this._settings.get_boolean('sync-top-bar-organizer'))
            return;
        const {lists, where} = this._read();
        // Remember only where the clock was, so on restore the entries
        // TBO added in the meantime are kept.
        if (this._clockWas === undefined)
            this._clockWas = where;

        const mode = this._settings.get_string('top-bar-position');
        const left = lists['left-box-order'];
        const center = lists['center-box-order'];
        const right = lists['right-box-order'];
        if (mode === 'right-between-tray-and-menu') {
            let i = right.findIndex(r => MENU_TAIL_ROLES.includes(r));
            if (i === -1)
                i = right.length;
            right.splice(i, 0, 'dateMenu');
        } else if (mode === 'right-before-tray') {
            right.unshift('dateMenu');
        } else if (mode === 'left-after-menu') {
            left.push('dateMenu');
        } else {
            center.splice(Math.min(1, center.length), 0, 'dateMenu');
        }
        this._write(lists);
    }

    restore() {
        if (!this._tbo || this._clockWas === undefined)
            return;
        const {lists} = this._read();
        const where = this._clockWas;
        if (where) {
            const list = lists[where.key];
            list.splice(Math.min(where.index, list.length), 0, 'dateMenu');
        }
        this._write(lists);
        this._clockWas = undefined;
    }
}
