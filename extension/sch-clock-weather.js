// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The weather next to the clock, inside the same pill: icon and temperature
// in the font of the clock, before or after it. GNOME draws the pill on the
// clock label (style class "clock"): the class moves to a box of ours that
// holds both the clock and the weather, so they are one indicator, not two.
// While GNOME Weather loads nothing changes (the last weather stays, or the
// pill shows only the clock): a spinner made the pill change width and moved
// the other icons. After each update the description ("Cloudy") replaces
// the temperature for a few seconds; when the width changes, clock and
// weather slide to their new place instead of jumping. Hidden while offline,
// it tries again by itself and asks for fresh data every 10 minutes.
// Written for Smart Calendar Hub after the behaviour of Weather O'Clock.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const FADE_OUT = 250;
const FADE_IN = 400;
const SLIDE = 300;
const DESCRIPTION_DELAY = 1500; // ms after the temperature appears
const DESCRIPTION_TIME = 5; // seconds the description stays
const REFRESH_SECONDS = 600;
const RETRY_SECONDS = [5, 5, 30, 30, 30];

export class ClockWeather {
    constructor(dateMenu, client, settings) {
        this._clock = dateMenu._clockDisplay;
        this._client = client;
        this._settings = settings;
        // the pill: takes the place and the "clock" class of the clock label
        this._pill = new St.BoxLayout({style_class: 'clock'});
        const parent = this._clock.get_parent();
        this._clock.remove_style_class_name('clock');
        parent.replace_child(this._clock, this._pill);
        this._pill.add_child(this._clock);
        this._monitor = Gio.NetworkMonitor.get_default();
        this._signals = [];
        this._timers = {};
        this._retries = 0;
        this._shown = null; // {icon, temp} on screen
        this._description = null;
        this._showingDescription = false;

        this.actor = new St.BoxLayout({
            style_class: 'sch-clock-weather',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._icon = new St.Icon({
            style_class: 'system-status-icon sch-clock-weather-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({
            style_class: 'clock-label sch-clock-weather-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.clutter_text.y_align = Clutter.ActorAlign.CENTER;
        this.actor.add_child(this._icon);
        this.actor.add_child(this._label);
        this._place();

        // Another extension may destroy the box we live in (Weather O'Clock
        // wraps the clock in its own box and destroys it when turned off)
        this.actor.connect('destroy', () => {
            this._stopTimers();
            this._disconnectAll();
            this.actor = null;
        });
        this._on(client, 'changed', () => this._update());
        this._on(this._monitor, 'notify::connectivity', () => this._onConnectivity());
        this._on(this._pill, 'child-added', () => this._update());
        this._on(this._pill, 'child-removed', () => this._update());
        this._on(settings, 'changed::clock-weather-position', () => this._place());
        this._on(settings, 'changed::clock-weather', () => {
            if (this._mode() === 'off') {
                this._hide(true);
            } else {
                this._shown = null; // shown again with or without the icon
                this._first();
            }
        });
        this._on(settings, 'changed::clock-weather-description', () => this._hideDescription(false));
        this._first();
    }

    destroy() {
        this._stopTimers();
        this._disconnectAll();
        this._restoreTranslation();
        this.actor?.destroy();
        this.actor = null;
        // the clock label back in its place, with its own pill
        const pill = this._pill;
        this._pill = null;
        if (this._clock.get_parent() === pill) {
            pill.remove_child(this._clock);
            this._clock.add_style_class_name('clock');
            pill.get_parent()?.replace_child(pill, this._clock);
        }
        pill.destroy();
    }

    // Another extension shows the weather next to the clock: it took the
    // clock out of our pill (Weather O'Clock wraps it in its own box) or put
    // a weather widget in it
    _isOther() {
        if (this._clock.get_parent() !== this._pill)
            return true;
        const isWeather = a => (a.style_class ?? '').includes('weather');
        return this._pill.get_children().some(ch => ch !== this.actor && ch !== this._clock &&
            (isWeather(ch) || ch.get_children().some(isWeather)));
    }

    _on(obj, signal, callback) {
        this._signals.push([obj, obj.connect(signal, callback)]);
    }

    _disconnectAll() {
        for (const [obj, id] of this._signals) {
            try {
                obj.disconnect(id);
            } catch (_e) {
                // already destroyed
            }
        }
        this._signals = [];
    }

    // One-shot timer by name; `ms` = the delay is in milliseconds
    _timer(name, delay, callback, ms = false) {
        this._clearTimer(name);
        const done = () => {
            this._timers[name] = 0;
            if (this.actor)
                callback();
            return GLib.SOURCE_REMOVE;
        };
        this._timers[name] = ms
            ? GLib.timeout_add(GLib.PRIORITY_LOW, delay, done)
            : GLib.timeout_add_seconds(GLib.PRIORITY_LOW, delay, done);
    }

    _clearTimer(name) {
        if (this._timers[name])
            GLib.source_remove(this._timers[name]);
        this._timers[name] = 0;
    }

    _stopTimers() {
        for (const name of Object.keys(this._timers))
            this._clearTimer(name);
    }

    // Before or after the clock, in the clock's own box
    _place() {
        if (!this.actor)
            return;
        this._restoreTranslation();
        this.actor.get_parent()?.remove_child(this.actor);
        const before = this._settings.get_string('clock-weather-position') === 'before';
        this.actor.remove_style_class_name(before ? 'sch-clock-weather-after' : 'sch-clock-weather-before');
        this.actor.add_style_class_name(before ? 'sch-clock-weather-before' : 'sch-clock-weather-after');
        if (this._clock.get_parent() !== this._pill)
            this._pill.add_child(this.actor);
        else if (before)
            this._pill.insert_child_below(this.actor, this._clock);
        else
            this._pill.insert_child_above(this.actor, this._clock);
    }

    // 'both', 'temperature' or 'off'
    _mode() {
        return this._settings.get_string('clock-weather');
    }

    _offline() {
        return this._monitor.connectivity === Gio.NetworkConnectivity.LOCAL;
    }

    _first() {
        if (this._mode() === 'off')
            return;
        if (this._client.info?.is_valid() || this._client.loading) {
            this._update();
            return;
        }
        if (this._offline()) {
            this._hide();
            return;
        }
        this._client.update();
        this._loading();
    }

    _onConnectivity() {
        if (this._offline()) {
            this._clearTimer('retry');
            if (!this._client.info?.is_valid())
                this._hide();
            return;
        }
        if (!this._shown) {
            this._retries = 0;
            this._client.update();
            this._loading();
        }
    }

    _update() {
        if (!this.actor)
            return;
        // the clock is back in our pill (e.g. Weather O'Clock was turned off
        // and gave it back with its own pill): one pill only, ours
        if (this._clock.get_parent() === this._pill && this._clock.has_style_class_name('clock'))
            this._clock.remove_style_class_name('clock');
        if (this._mode() === 'off' || this._isOther() ||
            !this._client.available || !this._client.hasLocation) {
            this._hide(true);
            return;
        }
        if (this._client.loading) {
            if (!this._shown)
                this._loading();
            return;
        }
        const info = this._client.info;
        const icon = info?.get_symbolic_icon_name();
        const [tempOk] = info?.get_value_temp(GWeather.TemperatureUnit.DEFAULT) ?? [false];
        const temp = tempOk ? info.get_temp_summary() : '';
        if (icon && icon !== 'weather-missing-symbolic' && temp) {
            this._retries = 0;
            this._clearTimer('retry');
            this._show(icon, temp, this._describe(info));
            return;
        }
        if (this._offline()) {
            this._hide();
        } else if (this._retries < RETRY_SECONDS.length) {
            const delay = RETRY_SECONDS[this._retries++];
            this._timer('retry', delay, () => this._client.update());
        } else if (!this._shown) {
            this._hide();
        }
    }

    // "Cloudy", "Light rain"…, or null
    _describe(info) {
        const [skyOk, sky] = info.get_value_sky();
        if (skyOk && sky !== GWeather.Sky.INVALID)
            return info.get_sky();
        const [condOk, phenomenon] = info.get_value_conditions();
        if (condOk && phenomenon !== GWeather.ConditionPhenomenon.INVALID &&
            phenomenon !== GWeather.ConditionPhenomenon.NONE)
            return info.get_conditions();
        return null;
    }

    // GNOME Weather is loading: nothing on screen changes
    _loading() {
        this._clearTimer('description');
    }

    _show(icon, temp, description) {
        const iconChanged = icon !== this._shown?.icon;
        const changed = iconChanged || temp !== this._shown?.temp;
        const wasShown = !!this._shown;
        this._shown = {icon, temp};
        this._scheduleRefresh();
        if (wasShown && (!changed || this._showingDescription))
            return;
        // only the text fades when the icon stays the same
        this._change(wasShown && !iconChanged ? this._label : this.actor, () => {
            this._icon.icon_name = icon;
            this._icon.visible = this._mode() !== 'temperature';
            this._label.text = temp;
            this._label.show();
        }, () => {
            if (description && this._settings.get_boolean('clock-weather-description'))
                this._timer('description', DESCRIPTION_DELAY, () => this._showDescription(description), true);
        });
    }

    _showDescription(text) {
        if (!text || text === '-' || text === this._description)
            return;
        this._description = text;
        this._showingDescription = true;
        this._change(this._label, () => {
            this._label.text = text;
        }, () => this._timer('description', DESCRIPTION_TIME, () => this._hideDescription(true)));
    }

    _hideDescription(animate) {
        this._clearTimer('description');
        if (!this._showingDescription)
            return;
        this._showingDescription = false;
        const back = () => {
            this._label.text = this._shown?.temp ?? '';
        };
        if (animate)
            this._change(this._label, back);
        else
            back();
    }

    _scheduleRefresh() {
        if (this._timers.refresh)
            return;
        this._timers.refresh = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, REFRESH_SECONDS, () => {
            if (this.actor && !this._offline())
                this._client.update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _hide(now = false) {
        this._stopTimers();
        this._shown = null;
        this._description = null;
        this._showingDescription = false;
        if (!this.actor?.visible)
            return;
        this.actor.remove_all_transitions();
        if (now) {
            this.actor.visible = false;
            return;
        }
        this.actor.ease({
            opacity: 0,
            duration: FADE_OUT,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (this.actor)
                    this.actor.visible = false;
            },
        });
    }

    // Fades `target` out, applies the change, slides clock and weather from
    // the old width to the new one, fades `target` back in.
    _change(target, apply, onShown = null) {
        const run = () => {
            if (!this.actor)
                return;
            const fromWidth = this.actor.visible ? this._width() : 0;
            apply();
            target.opacity = 0;
            this.actor.visible = true;
            if (target !== this.actor)
                this.actor.opacity = 255;
            this._slide(fromWidth);
            target.ease({
                opacity: 255,
                duration: FADE_IN,
                delay: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (this.actor)
                        onShown?.();
                },
            });
        };
        if (!this.actor.visible || this.actor.opacity === 0 || target.opacity === 0) {
            run();
            return;
        }
        target.ease({
            opacity: 0,
            duration: FADE_OUT,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: run,
        });
    }

    _width() {
        return this.actor.get_parent() ? this.actor.get_preferred_width(-1)[1] : 0;
    }

    // The pill grows or shrinks at once; its contents slide to the new place
    _slide(fromWidth) {
        const delta = this._width() - fromWidth;
        if (Math.abs(delta) <= 2)
            return;
        // part of the change taken on the left: 0 in the left box of the top
        // bar, 1 in the right box, half in the centre
        let share = 0.5;
        for (let a = this.actor.get_parent(); a; a = a.get_parent()) {
            if (a === Main.panel._leftBox) {
                share = 0;
                break;
            }
            if (a === Main.panel._rightBox) {
                share = 1;
                break;
            }
        }
        const shift = share * delta;
        const children = this._pill.get_children();
        const before = children.indexOf(this.actor) < children.indexOf(this._clock);
        for (const [actor, from] of [[this.actor, shift], [this._clock, before ? shift - delta : shift]]) {
            actor.remove_transition('translation-x');
            actor.translation_x = from;
            actor.ease({translation_x: 0, duration: SLIDE, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    _restoreTranslation() {
        for (const actor of [this.actor, this._clock]) {
            if (!actor)
                continue;
            actor.remove_transition('translation-x');
            actor.translation_x = 0;
        }
    }
}
