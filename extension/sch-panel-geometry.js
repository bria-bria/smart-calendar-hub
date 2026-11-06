// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Size and place of the panel: its width (the setting, the width of GNOME's
// system menu, or the one dragged on its edge), its height (the work area),
// cards shaped like GNOME's menu card, and where it opens (an edge of the
// screen or under the clock, by patching the BoxPointer of the date menu).

import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Frame (padding and border) of the menu's content box, measured before it
// becomes transparent with the calendar beside the panel
let cardFrame = null;

// Room the calendar days gain in the card beside the panel, where the side
// bands are narrower (.sch-calendar-card .sch-cal-card in the stylesheet:
// 4 px instead of 12 px each side, and no 2 px panel padding)
const SIDE_CALENDAR_EXTRA = 40;

export class PanelGeometry {
    constructor(panel) {
        this._panel = panel;
        this._dateMenu = panel.dateMenu;
        this._settings = panel.settings;
        this._gnomeWidth = null;
        this._calendarWidth = undefined;
        this._gnomeCard = null;
        this._patchBoxPointer();
    }

    destroy() {
        this._unwatchGnomeCard();
        this._unpatchBoxPointer();
    }

    // Before the menu's content box becomes transparent (calendar beside
    // the panel), with GNOME's padding already applied (first opening)
    measureBeforeSide() {
        this.applyCardShape();
        cardFrame = this.measureCardFrame();
    }

    update() {
        const {sidebar, side} = this._panel;
        if (!sidebar)
            return;
        // first the shape: the width below depends on the frame of the cards
        this.applyCardShape();
        const monitor = Main.layoutManager.findIndexForActor(this._dateMenu.container);
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor);
        const width = this.sidebarWidth(true);
        // with the calendar beside it the panel is a card of its own: its
        // padding and border are inside its width
        const frame = side.calendarSide ? cardFrame ?? 22 : 0;
        sidebar.width = width + frame;
        // the calendar card as wide as the panel card: without a width it grew
        // to fit the longest line of the agenda and went off the screen
        side.card.width = side.calendarSide ? width + frame : -1;
        // the calendar cells follow the width (only when it changed). In the
        // card beside the panel the side bands are narrower (stylesheet,
        // .sch-calendar-card): the days get that room, bigger cells and digits
        const calendarWidth = side.calendarSide ? width + SIDE_CALENDAR_EXTRA : width;
        if (this._calendarWidth !== calendarWidth) {
            this._calendarWidth = calendarWidth;
            this._panel.calendarView.setWidth(calendarWidth);
        }
        // Fill the work area, but never be taller than it: 4 px gap at the
        // top and a margin, minus the frame of the card (padding and border,
        // which follow GNOME's menu)
        const cardBorder = side.calendarSide ? cardFrame ?? 22 : this.measureCardFrame();
        sidebar.height = Math.max(0, workArea.height - 18 - cardBorder) + frame;
        // a side page of an extension (showExternalPage) as tall as the panel
        if (this._panel.pages.visit?.side)
            side.card.height = sidebar.height;
        // the bottom buttons share the new width
        this._panel.bottom.layout();
    }

    // Width of the panel: the setting, or the width of GNOME's system menu
    // ("Align to GNOME's menu"), measured again when asked (`measure`, e.g.
    // every time the panel opens: that menu changes with its buttons, the
    // theme and the screen scale).
    sidebarWidth(measure = false) {
        // being dragged, or dragged earlier (the inner edge of the panel)
        const dragged = this._panel.resize.width;
        if (dragged)
            return dragged;
        if (!this._settings.get_boolean('sidebar-width-gnome'))
            return this._settings.get_int('sidebar-width');
        if (measure || !this._gnomeWidth)
            this._gnomeWidth = this._measureGnomeMenu() ?? this._gnomeWidth;
        return this._gnomeWidth ?? this._settings.get_int('sidebar-width');
    }

    // The card of GNOME's system menu with the buttons (Wi-Fi, Bluetooth…):
    // the one holding the grid of the quick settings. Other cards that
    // extensions put next to it (e.g. Quick Settings Audio Panel) are not
    // counted. Plain GNOME: the grid sits in the menu box ("quick-settings");
    // with LibPanel the grid itself is the card.
    _gnomeMenuCard() {
        const menu = Main.panel.statusArea.quickSettings?.menu;
        let actor = menu?._grid ?? null;
        while (actor && !actor.has_style_class_name('quick-settings'))
            actor = actor.get_parent();
        return actor ?? menu?.box ?? null;
    }

    // Width of that card minus the frame of our popup content
    _measureGnomeMenu() {
        const card = this._gnomeMenuCard();
        if (!card || !this._panel.sidebar)
            return null;
        this._watchGnomeCard(card);
        // the width it has on screen, or the one it asks for
        const [, preferred] = card.get_preferred_width(-1);
        const cardWidth = card.mapped && card.width > 0 ? card.width : preferred;
        // the frame of our content box (with the calendar beside the
        // panel the box is transparent: the frame measured before)
        const frame = this._panel.side.calendarSide ? cardFrame ?? 22 : this.measureCardFrame();
        const width = Math.round(cardWidth - frame);
        // a card not drawn yet measures nothing useful
        return width >= 280 && width <= 900 ? width : null;
    }

    // When that card changes width (its buttons, another extension), the
    // panel follows at once
    _watchGnomeCard(card) {
        if (this._gnomeCard === card)
            return;
        this._unwatchGnomeCard();
        this._gnomeCard = card;
        card.connectObject(
            'notify::width', () => {
                if (this._settings.get_boolean('sidebar-width-gnome') && card.mapped)
                    this.update();
            },
            'destroy', () => {
                this._gnomeCard = null;
            },
            this);
    }

    _unwatchGnomeCard() {
        this._gnomeCard?.disconnectObject(this);
        this._gnomeCard = null;
    }

    // The geometry of GNOME's system menu card (corner radius and padding):
    // {radius, padding} in pixels, or null (then our stylesheet decides)
    _gnomeCardShape() {
        const node = this._gnomeMenuCard()?.get_theme_node();
        if (!node)
            return null;
        const radius = Math.round(node.get_border_radius(St.Corner.TOPLEFT));
        const padding = Math.round(node.get_padding(St.Side.LEFT));
        if (radius < 0 || radius > 80 || padding < 0 || padding > 60)
            return null;
        return {radius, padding};
    }

    // Space between the cards of GNOME's system menu when LibPanel (used by
    // Quick Settings Audio Panel) splits it into cards: it puts them in a box
    // of its own with the spacing set on it. null: GNOME's menu is one card,
    // our stylesheet decides (.sch-cards-host)
    _gnomeCardGap() {
        const menu = Main.panel.statusArea.quickSettings?.menu;
        if (!menu?.actor.has_style_class_name('QSAP-panel-grid') || !menu.box)
            return null;
        const gap = Math.round(menu.box.get_theme_node().get_length('spacing'));
        return gap >= 0 && gap <= 40 ? gap : null;
    }

    // Padding and border of the menu's content box around the panel, from
    // its style: exact, and available before the menu is drawn
    measureCardFrame() {
        const node = this._dateMenu.menu.box.get_theme_node();
        const frame = Math.round(node.get_horizontal_padding() +
            node.get_border_width(St.Side.LEFT) + node.get_border_width(St.Side.RIGHT));
        return frame >= 0 && frame < 80 ? frame : 22;
    }

    // Our cards with the same corners and padding as GNOME's menu card.
    // One card: the menu's content box. With the calendar beside: the box
    // is transparent (only the space between the cards, see _gnomeCardGap)
    // and the panel and the calendar are the cards; the panel keeps its own
    // 2 px inside, so nothing in it moves.
    applyCardShape() {
        const host = this._dateMenu.menu.box;
        const {sidebar, side} = this._panel;
        if (!sidebar)
            return;
        const shape = this._gnomeCardShape();
        const card = pad => shape ? `padding: ${pad}px; border-radius: ${shape.radius}px` : null;
        // only when it changes: a new style restyles the whole panel
        const setStyle = (actor, style) => {
            if (actor && (actor.get_style() ?? null) !== style)
                actor.set_style(style);
        };
        if (side.calendarSide) {
            const gap = this._gnomeCardGap();
            setStyle(host, gap === null ? null : `spacing: ${gap}px`);
            setStyle(sidebar, card(shape?.padding + 2));
            setStyle(side.card, card(shape?.padding));
        } else {
            setStyle(host, card(shape?.padding));
            setStyle(sidebar, null);
            setStyle(side.card, null);
        }
    }

    // The panel opens at an edge of the screen, from the top of the work
    // area, unless "under the clock button" is chosen (GNOME's own placing)
    _patchBoxPointer() {
        const bp = this._dateMenu.menu._boxPointer;
        if (!bp)
            return;

        bp.add_style_class_name('sch-sidebar');
        const settings = this._settings;
        const origReposition = bp._reposition;
        const origUpdateFlip = bp._updateFlip;
        this._bpOriginals = {_reposition: origReposition, _updateFlip: origUpdateFlip};

        bp._updateFlip = function (allocationBox) {
            if (settings.get_string('sidebar-side') === 'button')
                return origUpdateFlip.call(this, allocationBox);
            this._arrowSide = St.Side.TOP;
            return undefined;
        };

        bp._reposition = function (allocationBox) {
            const side = settings.get_string('sidebar-side');
            if (side === 'button')
                return origReposition.call(this, allocationBox);

            const source = this._sourceActor ?? Main.panel;
            const workArea = Main.layoutManager.getWorkAreaForMonitor(
                Main.layoutManager.findIndexForActor(source));
            this._workArea = workArea;
            this._sourceExtents = source.get_transformed_extents();

            const [, , natWidth] = this.get_preferred_size();
            const stageX = side === 'left'
                ? workArea.x + 6
                : workArea.x + workArea.width - natWidth - 6;
            const stageY = workArea.y + 4;
            this.setArrowOrigin(0);

            let parent = this.get_parent();
            let ok = false;
            let x = stageX, y = stageY;
            while (parent && !ok) {
                [ok, x, y] = parent.transform_stage_point(stageX, stageY);
                parent = parent.get_parent();
            }
            allocationBox.set_origin(Math.floor(x), Math.floor(y));
            return undefined;
        };
    }

    _unpatchBoxPointer() {
        const bp = this._dateMenu.menu._boxPointer;
        if (!bp)
            return;
        bp.remove_style_class_name('sch-sidebar');
        if (this._bpOriginals)
            Object.assign(bp, this._bpOriginals);
        this._bpOriginals = null;
    }
}
