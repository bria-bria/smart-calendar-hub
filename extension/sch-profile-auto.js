// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Changes the profile by itself (sch-profiles.js): the profile of a Wi-Fi
// network the computer is connected to, else the one whose hours hold,
// else "Default". Only when what the rules want changes (another network,
// hours starting or ending): a profile chosen by hand stays until then. The
// lock (profile-locked) stops it; without rules it does nothing. The names
// of the networks connected are read from NetworkManager, asynchronously,
// and never saved here.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import NM from 'gi://NM';

import {logError} from './sch-log.js';
import {automaticProfile, hasRules, setActiveProfile} from './sch-profiles.js';

Gio._promisify(NM.Client, 'new_async');

const CHECK_SECONDS = 60; // the hours: checked once a minute

export class ProfileAuto {
    constructor(settings) {
        this._settings = settings;
        this._wanted = null; // what the rules wanted at the last check
        this._ssids = [];
        this._cancellable = new Gio.Cancellable();
        this._settings.connectObject(
            'changed::profiles', () => this.check(),
            'changed::profile-locked', () => {
                // unlocked: the rules take over again at once
                this._wanted = null;
                this.check();
            }, this);
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CHECK_SECONDS, () => {
            this.check();
            return GLib.SOURCE_CONTINUE;
        });
        this._initNetwork().catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(`profiles: ${e}`);
        });
        this.check();
    }

    destroy() {
        this._cancellable.cancel();
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        this._settings.disconnectObject(this);
        this._client?.disconnectObject(this);
        this._client = null;
    }

    // The names of the Wi-Fi networks connected now (for "Use the network
    // I am on")
    get ssids() {
        return [...this._ssids];
    }

    async _initNetwork() {
        const client = await NM.Client.new_async(this._cancellable);
        if (this._cancellable.is_cancelled())
            return;
        this._client = client;
        // (a connection becoming active changes the primary connection)
        client.connectObject(
            'notify::active-connections', () => this._readNetworks(),
            'notify::primary-connection', () => this._readNetworks(),
            'notify::state', () => this._readNetworks(), this);
        this._readNetworks();
    }

    _readNetworks() {
        this._ssids = (this._client?.get_active_connections() ?? [])
            .filter(ac => ac.get_connection_type() === '802-11-wireless' &&
                ac.get_state() === NM.ActiveConnectionState.ACTIVATED)
            .map(ac => ac.get_connection()?.get_setting_wireless()?.get_ssid())
            .filter(Boolean)
            .map(bytes => NM.utils_ssid_to_utf8(bytes.get_data()));
        this.check();
    }

    // now: for the tests, a GLib.DateTime
    // What the rules want is followed even without rules, so that the first
    // rule added changes the profile only if it holds now
    check(now = GLib.DateTime.new_now_local()) {
        if (this._settings.get_boolean('profile-locked'))
            return;
        const wanted = automaticProfile(this._settings, this._ssids, now);
        if (wanted === this._wanted)
            return;
        this._wanted = wanted;
        if (hasRules(this._settings))
            setActiveProfile(this._settings, wanted);
    }
}
