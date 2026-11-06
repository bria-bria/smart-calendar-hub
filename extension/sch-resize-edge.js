// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The inner edge of the panel (the side towards the middle of the
// screen) can be dragged to make the panel wider or narrower, to read
// the pages of other extensions better. The wider panel lasts until it
// closes (or a double click on the edge): it opens again at its usual
// width.

import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Connections} from './sch-signals.js';

export class ResizeEdge {
    constructor(panel) {
        this._live = 0;
        this._dragged = 0;
        this._grab = null;
        this._signals = new Connections();
        const EDGE = 12; // px of the edge that can be grabbed
        const MIN = 280;
        // GNOME's box of the clock menu holds the panel (and the calendar
        // card beside it): its events are watched, so the edge also works on
        // the padding around the panel; the visible card is that box, or the
        // panel itself when the calendar is in a card of its own
        const host = panel.dateMenu.menu.box;
        const card = () => (panel.side.calendarSide ? panel.sidebar : host);
        let drag = null;
        let lastPress = 0;
        const innerLeft = () => {
            const [x] = card().get_transformed_position();
            const monitor = Main.layoutManager.monitors[
                Main.layoutManager.findIndexForActor(panel.sidebar)] ?? Main.layoutManager.primaryMonitor;
            return x + card().width / 2 > monitor.x + monitor.width / 2;
        };
        const nearEdge = px => {
            const [x] = card().get_transformed_position();
            const w = card().width;
            return innerLeft() ? px >= x - 2 && px < x + EDGE : px <= x + w + 2 && px > x + w - EDGE;
        };
        this._end = () => {
            this._grab?.dismiss();
            this._grab = null;
            if (this._live)
                this._dragged = this._live;
            this._live = 0;
            drag = null;
        };
        this._host = host;
        // its padding must receive the pointer too (given back in destroy)
        this._hostReactive = host.reactive;
        host.reactive = true;
        this._signals.connect(host, 'captured-event', (_actor, event) => {
            const type = event.type();
            const [px] = event.get_coords();
            if (drag) {
                if (type === Clutter.EventType.MOTION) {
                    const dx = drag.left ? drag.x - px : px - drag.x;
                    this._live = Math.round(Math.min(Math.max(drag.width + dx, MIN), drag.max));
                    panel.geometry.update();
                    panel.relayout();
                } else if (type === Clutter.EventType.BUTTON_RELEASE) {
                    this._end();
                    panel.tray.layout();
                }
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.MOTION) {
                host.set_cursor_type(nearEdge(px)
                    ? Clutter.CursorType.EW_RESIZE : Clutter.CursorType.INHERIT);
                return Clutter.EVENT_PROPAGATE;
            }
            if (type !== Clutter.EventType.BUTTON_PRESS || event.get_button() !== 1 || !nearEdge(px))
                return Clutter.EVENT_PROPAGATE;
            // double click: back to the width of the settings
            const now = event.get_time();
            if (now - lastPress < 400) {
                lastPress = 0;
                this._dragged = 0;
                panel.geometry.update();
                panel.tray.layout();
                panel.relayout();
                return Clutter.EVENT_STOP;
            }
            lastPress = now;
            const monitor = Main.layoutManager.findIndexForActor(panel.sidebar);
            const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
            drag = {x: px, left: innerLeft(), width: panel.geometry.sidebarWidth(), max: Math.round(area.width * 0.6)};
            // the drag goes on outside the panel too
            this._grab = global.stage.grab(host);
            return Clutter.EVENT_STOP;
        });
    }

    destroy() {
        this._end();
        this._signals.disconnectAll();
        // GNOME's menu box: back to its own cursor
        this._host.set_cursor_type(Clutter.CursorType.INHERIT);
        this._host.reactive = this._hostReactive;
    }

    // The width being dragged, or dragged earlier; 0 = none
    get width() {
        return this._live || this._dragged;
    }

    // The panel closed (also while its edge was being dragged): it opens
    // again at its usual width. true if it had another one.
    panelClosed() {
        this._end();
        const had = this._dragged > 0;
        this._dragged = 0;
        return had;
    }
}
