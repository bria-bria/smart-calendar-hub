// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The weather of the panel, collapsible: "Weather · 12° Brescia" on the
// row, GNOME's weather of the first city under it, and the other cities
// saved in GNOME Weather with the up and down arrows (sch-weather.js).

import Clutter from 'gi://Clutter';
import GWeather from 'gi://GWeather';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {_} from './sch-i18n.js';
import {CityWeather, buildForecast} from './sch-weather.js';
import {Connections} from './sch-signals.js';

// Open or closed. Module-level on purpose: it survives disable/enable
// (screen lock) and goes back to closed at the next login.
let weatherExpanded = false;

export class WeatherSection {
    // onCityChanged: the city shown changed (the sky follows it)
    constructor(panel, onCityChanged) {
        this._panel = panel;
        this._signals = new Connections();
        const dm = panel.dateMenu;
        const sidebar = panel.sidebar;
        const weatherRow = new St.BoxLayout({style_class: 'sch-weather-row', x_expand: true});
        sidebar.add_child(weatherRow);

        const weatherExpander = new St.Button({
            style_class: 'sch-calendar-expander sch-weather-expander',
            x_expand: true,
            can_focus: true,
            visible: !!dm._weatherItem,
        });
        // "Weather · 12° Brescia [icon of today's weather]"   >
        const weatherLine = new St.BoxLayout({x_expand: true, style_class: 'sch-weather-line'});
        this._summary = new St.Label({
            text: _('Weather'),
            style_class: 'sch-calendar-expander-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        weatherLine.add_child(this._summary);
        this._summaryIcon = new St.Icon({
            icon_size: 16,
            style_class: 'sch-weather-summary-icon',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        weatherLine.add_child(this._summaryIcon);
        weatherLine.add_child(new St.Widget({x_expand: true}));
        this._arrow = new St.Icon({
            icon_name: 'pan-end-symbolic',
            icon_size: 16,
            style_class: 'sch-calendar-expander-arrow',
        });
        weatherLine.add_child(this._arrow);
        weatherExpander.set_child(weatherLine);
        weatherRow.add_child(weatherExpander);

        // Cities saved in GNOME Weather: up/down arrows between the weather
        // and the gear (only with two or more cities)
        this._citySelector = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-city-selector',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        for (const [icon, delta, name] of [['pan-up-symbolic', -1, _('Previous city')],
            ['pan-down-symbolic', 1, _('Next city')]]) {
            const btn = new St.Button({
                style_class: 'sch-city-arrow',
                can_focus: true,
                accessible_name: name,
                child: new St.Icon({icon_name: icon, icon_size: 12}),
            });
            btn.connect('clicked', () => this.cityWeather.move(delta));
            this._citySelector.add_child(btn);
        }
        weatherRow.add_child(this._citySelector);

        this._body = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        sidebar.add_child(this._body);
        // GNOME's weather (first city) in a box of ours, so it can be hidden
        // while another city is shown (GNOME drives its own visibility)
        this._gnomeWeatherBin = new St.Bin({x_expand: true});
        this._body.add_child(this._gnomeWeatherBin);
        panel.adopt(dm._weatherItem, this._gnomeWeatherBin);
        // Another city: a card with its name and the next hours
        // a button, like GNOME's weather of the first city: a click opens
        // GNOME Weather
        this._cityCard = new St.Button({
            style_class: 'sch-city-card',
            x_expand: true,
            can_focus: true,
            visible: false,
        });
        this._cityCardBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-city-card-box',
            x_expand: true,
        });
        this._cityCard.set_child(this._cityCardBox);
        this._cityCard.connect('clicked', () => {
            this._client?.activateApp();
            Main.overview.hide();
            dm.menu.close();
        });
        this._body.add_child(this._cityCard);
        weatherExpander.connect('clicked', () => {
            weatherExpanded = !weatherExpanded;
            this._syncExpanded();
        });
        this._syncExpanded();

        const client = this._client = dm._weatherItem?._weatherClient;
        this.cityWeather = new CityWeather(() => {
            this._updateSummary(this._client);
            onCityChanged();
        });
        if (client)
            this._signals.connect(client, 'changed', () => this._updateSummary(client));
        this._updateSummary(client);
    }

    destroy() {
        this._signals.disconnectAll();
        this.cityWeather.destroy();
    }

    // The coordinates of the city shown, or null for GNOME's own
    coords() {
        return this.cityWeather.coords();
    }

    // When the panel opens
    refresh() {
        this.cityWeather.refresh();
    }

    retranslate() {
        this._updateSummary(this._client);
    }

    _syncExpanded() {
        this._body.visible = weatherExpanded;
        this._arrow.icon_name = weatherExpanded ? 'pan-down-symbolic' : 'pan-end-symbolic';
        this._panel.relayout();
    }

    // "Weather · 10° Brescia" on the collapsed row.
    _updateSummary(client) {
        const city = this.cityWeather.current();
        const info = city ? city.info : client?.info;
        const hasLocation = city ? true : !!client?.hasLocation;
        let text = _('Weather');
        let icon = null;
        if (hasLocation && info?.is_valid()) {
            const [ok, temp] = info.get_value_temp(GWeather.TemperatureUnit.DEFAULT);
            const place = city?.name ?? info.get_location_name() ?? '';
            if (ok && Number.isFinite(temp))
                text = _('Weather · {temp}° {place}', {temp: Math.round(temp), place}).trim();
            icon = info.get_symbolic_icon_name() || null;
        } else if (city) {
            text = _('Weather · {temp}° {place}', {temp: '…', place: city.name});
        }
        this._summary.text = text;
        this._summaryIcon.icon_name = icon ?? 'weather-clear-symbolic';
        this._summaryIcon.visible = !!icon;

        // The arrows, and which weather the open section shows
        this._citySelector.visible = this.cityWeather.count > 1;
        this._gnomeWeatherBin.visible = !city;
        this._cityCard.visible = !!city;
        this._cityCardBox.destroy_all_children();
        if (city) {
            const head = new St.BoxLayout({style_class: 'sch-city-card-head', x_expand: true});
            head.add_child(new St.Label({text: _('Weather'), x_expand: true}));
            head.add_child(new St.Label({text: city.name}));
            this._cityCardBox.add_child(head);
            this._cityCardBox.add_child(buildForecast(info));
        }
    }
}
