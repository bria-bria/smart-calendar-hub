// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The battery in the top bar as a circle: a ring that empties with the
// charge, the percentage inside (optional) and a bolt while charging. It
// takes the place of GNOME's battery icon in the system indicator, has the
// size of the other icons of the bar (it follows the screen scale) and the
// colour of their text (also GNOME's accent colour, see sch-topbar-style.js):
// yellow under 20%, red under 10%. When the charge changes the ring slides to
// the new value. Kept on every screen (session, lock and login screen).
// Written for Smart Calendar Hub after the idea of Battery Indicator Icon.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';
import UPower from 'gi://UPowerGlib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const ICON_SIZE = 16; // GNOME's panel icon size (panel.js PANEL_ICON_SIZE)
const SLIDE_MS = 800;
const LOW = 20;
const CRITICAL = 10;
const YELLOW = [0.96, 0.83, 0.18]; // GNOME palette yellow 3
const RED = [0.88, 0.11, 0.14]; // GNOME palette red 3
const WAIT_TRIES = 40; // GNOME builds the system indicator a little later

export class CircleBattery {
    constructor(settings) {
        this._settings = settings;
        this._ids = [];
        this._shown = 0; // percentage drawn now (it slides to the real one)
        this._target = 0;
        this._animId = 0;
        this._waitId = 0;
        this._tries = 0;
        this._settingsIds = ['battery-circle', 'battery-circle-text'].map(key =>
            settings.connect(`changed::${key}`, () => this._sync()));
        this._sync();
    }

    destroy() {
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        if (this._waitId)
            GLib.source_remove(this._waitId);
        this._waitId = 0;
        this._unhook();
    }

    // On or off, and the circle drawn again (e.g. the text switched off)
    _sync() {
        if (!this._settings.get_boolean('battery-circle')) {
            this._unhook();
            return;
        }
        if (!this._area) {
            this._tries = 0;
            this._hook();
        }
        this._area?.queue_repaint();
    }

    // Our circle next to GNOME's battery icon, which is hidden while the
    // circle is shown
    _hook() {
        const system = Main.panel.statusArea.quickSettings?._system;
        if (!system?._indicator || !system._systemItem?.powerToggle) {
            this._waitForSystem();
            return;
        }
        this._system = system;
        this._toggle = system._systemItem.powerToggle;
        this._icon = system._indicator;
        // as it was: another extension may keep it hidden too
        this._iconWasVisible = this._icon.visible;

        this._area = new St.DrawingArea({
            style_class: 'system-status-icon sch-battery-circle',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._area.connect('repaint', area => this._repaint(area));
        // the colour comes from the bar (accent colour, light/dark style)
        this._area.connect('style-changed', area => area.queue_repaint());
        // destroyed with GNOME's indicator (e.g. at the end of the session):
        // the animation stops and nothing touches it any more
        this._area.connect('destroy', () => {
            if (this._animId)
                GLib.source_remove(this._animId);
            this._animId = 0;
            this._area = null;
        });
        system.insert_child_above(this._area, this._icon);

        const theme = St.ThemeContext.get_for_stage(global.stage);
        this._on(theme, 'notify::scale-factor', () => this._resize());
        // the battery changes: GNOME's toggle updates its title and icon
        this._on(this._toggle, 'notify::title', () => this._update());
        this._on(this._toggle, 'notify::gicon', () => this._update());
        this._on(this._toggle, 'notify::visible', () => this._update());
        this._resize();
        this._shown = 0; // the first time the ring fills up to the charge
        this._update();
    }

    _unhook() {
        if (this._animId)
            GLib.source_remove(this._animId);
        this._animId = 0;
        for (const [obj, id] of this._ids) {
            try {
                obj.disconnect(id);
            } catch (_e) {
                // already gone
            }
        }
        this._ids = [];
        if (this._icon) {
            try {
                this._icon.visible = this._iconWasVisible ?? true;
            } catch (_e) {
                // GNOME's indicator is gone (shell exit)
            }
        }
        this._area?.destroy();
        this._area = null;
        this._icon = null;
        this._toggle = null;
        this._system = null;
    }

    _waitForSystem() {
        if (this._waitId || this._tries >= WAIT_TRIES)
            return;
        this._waitId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._waitId = 0;
            this._tries++;
            if (this._settings?.get_boolean('battery-circle') && !this._area)
                this._hook();
            return GLib.SOURCE_REMOVE;
        });
    }

    _on(obj, signal, callback) {
        this._ids.push([obj, obj.connect(signal, callback)]);
    }

    // as tall as the other icons of the bar, and round
    _resize() {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const size = ICON_SIZE * scale;
        this._area?.set_size(size, size);
    }

    _proxy() {
        return this._toggle?._proxy ?? null;
    }

    // No battery (desktop PC): GNOME's own power icon stays
    _update() {
        if (!this._area)
            return;
        const proxy = this._proxy();
        const present = !!proxy?.IsPresent && this._toggle.visible;
        this._area.visible = present;
        this._icon.visible = !present;
        if (!present)
            return;
        this._target = Math.max(0, Math.min(100, proxy.Percentage ?? 0));
        this._slide();
    }

    // the ring goes from the value drawn now to the real one
    _slide() {
        if (this._animId)
            GLib.source_remove(this._animId);
        this._animId = 0;
        const from = this._shown;
        const to = this._target;
        if (Math.abs(to - from) < 0.5) {
            this._shown = to;
            this._area.queue_repaint();
            return;
        }
        const begin = GLib.get_monotonic_time();
        this._animId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const t = Math.min(1, (GLib.get_monotonic_time() - begin) / 1000 / SLIDE_MS);
            const eased = 1 - (1 - t) ** 3;
            this._shown = from + (to - from) * eased;
            this._area?.queue_repaint();
            if (t < 1 && this._area)
                return GLib.SOURCE_CONTINUE;
            this._animId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _charging() {
        const proxy = this._proxy();
        return proxy?.State === UPower.DeviceState.CHARGING ||
            proxy?.State === UPower.DeviceState.FULLY_CHARGED;
    }

    _repaint(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const fg = area.get_theme_node().get_foreground_color();
        const rgb = [fg.red / 255, fg.green / 255, fg.blue / 255];
        const level = this._target;
        const charging = this._charging();
        const ring = !charging && level <= CRITICAL ? RED
            : !charging && level <= LOW ? YELLOW : rgb;

        const size = Math.min(w, h);
        const line = Math.max(1.5, size * 0.13);
        const radius = size / 2 - line / 2;
        const cx = w / 2;
        const cy = h / 2;

        // track
        cr.setSourceRGBA(...rgb, 0.3);
        cr.setLineWidth(line);
        cr.arc(cx, cy, radius, 0, 2 * Math.PI);
        cr.stroke();
        // charge, clockwise from the top
        const start = -Math.PI / 2;
        cr.setSourceRGBA(...ring, 1);
        cr.setLineCap(1); // round
        cr.arc(cx, cy, radius, start, start + 2 * Math.PI * (this._shown / 100));
        cr.stroke();

        if (charging) {
            this._drawBolt(cr, cx, cy, size, rgb);
        } else if (this._settings.get_boolean('battery-circle-text')) {
            const layout = PangoCairo.create_layout(cr);
            const text = `${Math.round(level)}`;
            // 100 needs three digits: a smaller size
            layout.set_font_description(this._font(size * (text.length > 2 ? 0.34 : 0.44)));
            layout.set_text(text, -1);
            const [, logical] = layout.get_pixel_extents();
            cr.setSourceRGBA(...rgb, 1);
            cr.moveTo(cx - logical.width / 2 - logical.x, cy - logical.height / 2 - logical.y);
            PangoCairo.show_layout(cr, layout);
        }
        cr.$dispose();
    }

    // the font of the percentage, built once per size
    _font(px) {
        const key = Math.round(px * 10);
        if (this._fontKey !== key) {
            this._fontKey = key;
            this._fontDesc = Pango.FontDescription.from_string('Sans Bold');
            this._fontDesc.set_absolute_size(px * Pango.SCALE);
        }
        return this._fontDesc;
    }

    // a small lightning bolt in the middle
    _drawBolt(cr, cx, cy, size, rgb) {
        const s = size * 0.26;
        cr.setSourceRGBA(...rgb, 1);
        cr.moveTo(cx + s * 0.15, cy - s);
        cr.lineTo(cx - s * 0.55, cy + s * 0.12);
        cr.lineTo(cx - s * 0.02, cy + s * 0.12);
        cr.lineTo(cx - s * 0.15, cy + s);
        cr.lineTo(cx + s * 0.55, cy - s * 0.12);
        cr.lineTo(cx + s * 0.02, cy - s * 0.12);
        cr.closePath();
        cr.fill();
    }
}
