// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Weather of the other cities saved in GNOME Weather (org.gnome.shell.weather
// "locations"). The first city is the one GNOME itself shows; for the others
// the weather is downloaded with GWeather the same way GNOME does (same
// providers), only when the city is selected in the panel.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';
import St from 'gi://St';

import {formatTime} from 'resource:///org/gnome/shell/misc/dateUtils.js';
import {logError} from './sch-log.js';

const MAX_FORECASTS = 5;
const REFRESH_SECONDS = 15 * 60;

// Selected city. Module-level: survives screen lock, back to the first at login.
let selectedCity = 0;

export class CityWeather {
    // onChange: called when the selected city or its data change
    constructor(onChange) {
        this._onChange = onChange;
        this._infos = new Map(); // index -> {info, id, updated}
        this._settings = new Gio.Settings({schema_id: 'org.gnome.shell.weather'});
        this._settingsId = this._settings.connect('changed::locations', () => {
            this._load();
            this._onChange();
        });
        this._load();
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        for (const {info, id} of this._infos.values())
            info.disconnect(id);
        this._infos.clear();
        this._settings = null;
    }

    _load() {
        for (const {info, id} of this._infos.values())
            info.disconnect(id);
        this._infos.clear();
        const world = GWeather.Location.get_world();
        this._locations = [];
        try {
            for (const serialized of this._settings.get_value('locations').deepUnpack()) {
                const loc = world.deserialize(serialized);
                if (loc)
                    this._locations.push(loc);
            }
        } catch (e) {
            logError(`weather cities: ${e}`);
        }
        if (selectedCity >= this._locations.length)
            selectedCity = 0;
    }

    get count() {
        return this._locations.length;
    }

    get index() {
        return selectedCity;
    }

    move(delta) {
        if (this.count < 2)
            return;
        selectedCity = (selectedCity + delta + this.count) % this.count;
        this.refresh();
        this._onChange();
    }

    // [latitude, longitude] in degrees of the city shown, or null for the
    // first one (GNOME's own weather knows it, also when it is located
    // automatically)
    coords() {
        if (selectedCity === 0)
            return null;
        try {
            const location = this._locations[selectedCity];
            // a location without coordinates would give 0, 0
            return location?.has_coords() ? location.get_coords() : null;
        } catch (_e) {
            return null;
        }
    }

    // null for the first city (GNOME's own weather), else {info, name}
    current() {
        if (selectedCity === 0 || !this._locations[selectedCity])
            return null;
        const loc = this._locations[selectedCity];
        return {info: this._infoFor(selectedCity), name: loc.get_city_name() || loc.get_name()};
    }

    _infoFor(index) {
        let entry = this._infos.get(index);
        if (!entry) {
            const info = new GWeather.Info({
                application_id: 'org.gnome.Shell',
                contact_info: 'https://gitlab.gnome.org/GNOME/gnome-shell/-/raw/HEAD/gnome-shell.doap',
                enabled_providers: GWeather.Provider.METAR | GWeather.Provider.MET_NO | GWeather.Provider.OWM,
            });
            info.set_location(this._locations[index]);
            entry = {info, id: 0, updated: 0};
            entry.id = info.connect_after('updated', () => {
                entry.updated = GLib.get_monotonic_time();
                if (index === selectedCity)
                    this._onChange();
            });
            this._infos.set(index, entry);
            info.update();
        }
        return entry.info;
    }

    // Downloads again the selected city if its data are older than 15 minutes
    refresh() {
        if (selectedCity === 0)
            return;
        const entry = this._infos.get(selectedCity);
        if (!entry) {
            this._infoFor(selectedCity);
            return;
        }
        if (GLib.get_monotonic_time() - entry.updated > REFRESH_SECONDS * 1e6)
            entry.info.update();
    }
}

// The next hours of a city, like GNOME's weather section
export function buildForecast(info) {
    const box = new St.BoxLayout({style_class: 'sch-city-forecast', x_expand: true});
    const now = GLib.DateTime.new_now_local();
    let last = GLib.DateTime.new_from_unix_local(0);
    let count = 0;
    for (const fc of info?.get_forecast_list?.() ?? []) {
        const [valid, ts] = fc.get_value_update();
        if (!valid || ts === 0)
            continue;
        const dt = GLib.DateTime.new_from_unix_local(ts);
        if (now.difference(dt) > 0 || dt.difference(last) < GLib.TIME_SPAN_HOUR)
            continue;
        last = dt;
        const [okT, temp] = fc.get_value_temp(GWeather.TemperatureUnit.DEFAULT);
        const col = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-city-forecast-col',
            x_expand: true,
        });
        col.add_child(new St.Label({text: formatTime(dt, {timeOnly: true}), x_align: Clutter.ActorAlign.CENTER}));
        col.add_child(new St.Icon({
            icon_name: fc.get_symbolic_icon_name() || 'weather-clear-symbolic',
            icon_size: 22,
            x_align: Clutter.ActorAlign.CENTER,
        }));
        col.add_child(new St.Label({
            text: okT ? `${Math.round(temp)}°` : '–',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(col);
        if (++count === MAX_FORECASTS)
            break;
    }
    return box;
}
