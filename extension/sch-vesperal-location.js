// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Where Vesperal takes its location from, in the card beside the panel:
// automatic (the location services) or manual, with a city search
// and the coordinates, as in its own preferences. The search is offline,
// in the cities GNOME knows (GWeather, the same list as Vesperal's search);
// a city or coordinates chosen here are written as Vesperal writes them
// (manual-location, a m(sdd): name, latitude, longitude) and the mode goes
// to manual.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';
import St from 'gi://St';

import {_} from './sch-i18n.js';
import {pageKit as kit} from './sch-page-kit.js';

const MAX_RESULTS = 8;
const SEARCH_DELAY_MS = 250;

// The location stored in `key` ({name, latitude, longitude}), or null
function storedLocation(settings, key) {
    if (!settings.settings_schema.has_key(key))
        return null;
    const value = settings.get_value(key).get_maybe();
    if (!value)
        return null;
    const [name, latitude, longitude] = value.deepUnpack();
    return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? {name, latitude, longitude} : null;
}

// The location Vesperal is using now: the manual one, or else the last one
// the location services gave
export function vesperalLocation(settings) {
    if (settings.get_string('location-mode') === 'manual')
        return storedLocation(settings, 'manual-location');
    return storedLocation(settings, 'last-known-location');
}

// Lower case without accents, for the search: "Zürich" → "zurich"
const FOLDED = {'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ł': 'l', 'đ': 'd', 'ı': 'i'};
const searchKey = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[øæœßłđı]/g, letter => FOLDED[letter]);

// Every city with coordinates in GNOME's list, with its region and country
function collectCities() {
    const cities = [];
    const regionOf = city => {
        const parts = [];
        for (let parent = city.get_parent(); parent; parent = parent.get_parent()) {
            const level = parent.get_level();
            if ((level === GWeather.LocationLevel.ADM1 || level === GWeather.LocationLevel.COUNTRY) && parent.get_name())
                parts.push(parent.get_name());
        }
        return parts.join(', ');
    };
    const visit = location => {
        if (location.get_level() === GWeather.LocationLevel.CITY && location.has_coords()) {
            const name = location.get_name() ?? '';
            const [latitude, longitude] = location.get_coords();
            cities.push({name, region: regionOf(location), latitude, longitude, key: searchKey(name)});
        }
        for (let child = location.next_child(null); child; child = location.next_child(child))
            visit(child);
    };
    const world = GWeather.Location.get_world();
    if (world)
        visit(world);
    return cities;
}

// Degrees typed by the user ("45,46", "−9.19"), or null when not a number
// within ±limit
function parseDegrees(text, limit) {
    const normal = text.trim().replace(',', '.').replace('−', '-');
    if (!/^[-+]?\d+(\.\d+)?$/.test(normal))
        return null;
    const degrees = Number(normal);
    return Math.abs(degrees) <= limit ? degrees : null;
}

const round = degrees => Math.round(degrees * 1e4) / 1e4;

function entry(hint) {
    const e = new St.Entry({style_class: 'sch-ext-entry', hint_text: hint, can_focus: true, x_expand: true});
    e.clutter_text.single_line_mode = true;
    return e;
}

// The pieces of the page: the mode, the search, the coordinates
export function buildLocation(settings) {
    let cities = null; // built at the first search
    let searchId = 0;
    const choose = (name, latitude, longitude) => {
        settings.set_value('manual-location', new GLib.Variant('m(sdd)', [name, latitude, longitude]));
        settings.set_string('location-mode', 'manual');
    };

    // automatic or manual, a check on the chosen one
    const automatic = kit.row({title: _('Automatic'), onActivate: () => settings.set_string('location-mode', 'automatic')});
    const manual = kit.row({title: _('Manual'), onActivate: () => settings.set_string('location-mode', 'manual')});
    const services = new Gio.Settings({schema_id: 'org.gnome.system.location'});
    const check = on => (on ? new St.Icon({icon_name: 'object-select-symbolic', icon_size: 16}) : null);

    // the search: results under the box, the first one with Enter
    const search = entry(_('Search for a city'));
    const results = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, visible: false});
    const found = text => {
        const key = searchKey(text.trim());
        if (key.length < 2)
            return [];
        cities ??= collectCities();
        const starts = city => (city.key.startsWith(key) ? 0 : 1);
        return cities.filter(city => city.key.includes(key))
            .sort((a, b) => starts(a) - starts(b) || a.key.localeCompare(b.key))
            .slice(0, MAX_RESULTS);
    };
    const pick = city => {
        choose(city.name, city.latitude, city.longitude);
        search.text = '';
    };
    const showResults = () => {
        results.destroy_all_children();
        for (const city of found(search.text))
            results.add_child(kit.row({title: city.name, subtitle: city.region, onActivate: () => pick(city)}));
        results.visible = results.get_n_children() > 0;
    };
    search.clutter_text.connect('text-changed', () => {
        if (searchId)
            GLib.source_remove(searchId);
        searchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_DELAY_MS, () => {
            searchId = 0;
            showResults();
            return GLib.SOURCE_REMOVE;
        });
    });
    search.clutter_text.connect('activate', () => {
        const [first] = found(search.text);
        if (first)
            pick(first);
    });

    // the coordinates, applied with Enter in either box
    const latitude = entry(_('Latitude (north positive)'));
    const longitude = entry(_('Longitude (east positive)'));
    const problem = kit.notice({icon: 'dialog-warning-symbolic'});
    problem.visible = false;
    const apply = () => {
        const lat = parseDegrees(latitude.text, 90);
        const lon = parseDegrees(longitude.text, 180);
        problem.textLabel.text = lat === null ? _('Latitude must be between −90 and 90')
            : lon === null ? _('Longitude must be between −180 and 180') : '';
        problem.visible = !!problem.textLabel.text;
        if (!problem.visible)
            choose('', lat, lon);
    };
    latitude.clutter_text.connect('activate', apply);
    longitude.clutter_text.connect('activate', apply);

    const sync = () => {
        const mode = settings.get_string('location-mode');
        automatic.setTrailing(check(mode === 'automatic'));
        manual.setTrailing(check(mode === 'manual'));
        automatic.subtitleLabel.text = services.get_boolean('enabled')
            ? _('From the location services') : _('Location services are off');
        const chosen = storedLocation(settings, 'manual-location');
        const coordinates = chosen ? `${round(chosen.latitude)}, ${round(chosen.longitude)}` : '';
        manual.subtitleLabel.text = chosen?.name || coordinates || _('No location set');
        latitude.text = chosen ? String(round(chosen.latitude)) : '';
        longitude.text = chosen ? String(round(chosen.longitude)) : '';
        problem.visible = false;
    };
    sync();
    const ids = ['location-mode', 'manual-location'].map(key => settings.connect(`changed::${key}`, sync));
    const servicesId = services.connect('changed::enabled', sync);

    const searchCard = kit.card(search, results);
    searchCard.connect('destroy', () => {
        if (searchId)
            GLib.source_remove(searchId);
        searchId = 0;
        ids.forEach(id => settings.disconnect(id));
        services.disconnect(servicesId);
    });
    return [
        kit.section(_('Location')),
        kit.card(automatic, manual),
        searchCard,
        kit.section(_('Coordinates')),
        kit.card(latitude, longitude),
        problem,
    ];
}
