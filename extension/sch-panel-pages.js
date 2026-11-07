// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Pages inside the panel: the menu of a tray icon (instead of floating), or
// a page of another extension (showExternalPage, see README, "For extension
// developers"). A card of ours takes the place of every other card of the
// panel for the visit: [←] title, then the menu or the page (scrolls if
// long). Esc or the arrow goes back.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {_} from './sch-i18n.js';
import {logError} from './sch-log.js';
import {tidy as tidyMenu, untidy as untidyMenu} from './sch-menu-tidy.js';

// A box that never asks for less than its full height. A scroll view gives
// its content only the minimum height: an app's menu whose rows can shrink
// would be squashed (rows on top of each other) instead of scrolled when
// there is little room, e.g. with the calendar open under it.
const FullHeightBox = GObject.registerClass(
class FullHeightBox extends St.BoxLayout {
    vfunc_get_preferred_height(forWidth) {
        const [, natural] = super.vfunc_get_preferred_height(forWidth);
        return [natural, natural];
    }
});

// A menu out of its floating box and back. The box keeps its menu in an
// St.Bin, which must be emptied with set_child(null).
function takeOut(box, bin) {
    if (bin instanceof St.Bin)
        bin.set_child(null);
    else
        bin.remove_child(box);
}

function putBack(box, bin) {
    if (bin instanceof St.Bin)
        bin.set_child(box);
    else
        bin.add_child(box);
}

export class PanelPages {
    constructor(panel) {
        this._panel = panel;
        this._visit = null;
        this._pageMessageId = 0;
        this.actor = new St.BoxLayout({
            style_class: 'sch-tray-menu-host',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            reactive: true,
            visible: false,
        });
        const header = new St.BoxLayout({style_class: 'sch-tray-menu-header', x_expand: true});
        const back = new St.Button({
            style_class: 'sch-tray-menu-back',
            can_focus: true,
            accessible_name: _('Back'),
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'go-previous-symbolic', icon_size: 16}),
        });
        back.connect('clicked', () => this.close());
        header.add_child(back);
        this._title = new St.Label({
            style_class: 'sch-tray-menu-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        header.add_child(this._title);
        this.actor.add_child(header);

        // the scrolled box holds a box at full height: the menu scrolls,
        // it is never squashed
        this._content = new FullHeightBox({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        const viewport = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        viewport.add_child(this._content);
        this._scroll = new St.ScrollView({
            style_class: 'sch-tray-menu-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
            child: viewport,
        });
        this.actor.add_child(this._scroll);
        // short messages of an extension's page (showPageMessage)
        this._pageMessage = new St.Label({style_class: 'sch-page-message', x_expand: true, visible: false});
        this._pageMessage.clutter_text.line_wrap = true;
        this.actor.add_child(this._pageMessage);
        // Esc: back to our cards (not the whole panel closed)
        this.actor.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            this.close();
            return Clutter.EVENT_STOP;
        });
        this._syncFlat();
        panel.settings.connectObject('changed::tray-menu-blend', () => this._syncFlat(), this.actor);
    }

    destroy() {
        this.close();
        this.forget();
    }

    // The panel went (disable, or destroyed by GNOME Shell at logout): the
    // timers of the visit go, nothing is put back into widgets now gone
    forget() {
        for (const key of ['cardsId', 'restoreId', 'sideRestoreId']) {
            if (this._visit?.[key])
                GLib.source_remove(this._visit[key]);
        }
        this._visit = null;
        if (this._pageMessageId)
            GLib.source_remove(this._pageMessageId);
        this._pageMessageId = 0;
    }

    // The visit on screen: {menu, info, hub, page, side…}, or null
    get visit() {
        return this._visit;
    }

    // With the card (like the other cards of the panel) or without: the menu of
    // the app then sits on the panel itself, only the title row stays
    _syncFlat() {
        if (this._panel.settings.get_boolean('tray-menu-blend'))
            this.actor.add_style_class_name('sch-tray-menu-host-flat');
        else
            this.actor.remove_style_class_name('sch-tray-menu-host-flat');
    }

    // The menu leaves its floating box (hidden) for our card; every other
    // card of the panel hides (and stays hidden if something shows it)
    showTrayMenu(indicator, info) {
        const menu = indicator.menu;
        if (this._visit?.menu === menu)
            return;
        this.close();
        // An extension may describe itself for the hub (see README, "For
        // extension developers"): a title, a page of its own instead of its
        // menu, and whether we may clear its backgrounds
        const hub = indicator.smartCalendarHub ?? null;
        const shown = {menu, info, hub, hidden: [], cleared: new Map(), ornaments: new Map()};
        if (typeof hub?.buildPage === 'function') {
            try {
                shown.page = hub.buildPage();
            } catch (e) {
                logError(`page of ${info.role}: ${e}`);
            }
        }
        // a page still inside something else cannot be shown: the menu instead
        if (shown.page instanceof Clutter.Actor && !shown.page.get_parent()) {
            this._content.add_child(shown.page);
            shown.page.add_style_class_name?.('sch-hub-page');
            // its menu leaves the floating box for the visit (kept aside, put
            // back after): an empty floating box never shows, as for the menus
            // shown inside
            const heldBox = menu.box;
            const heldBin = heldBox?.get_parent();
            if (heldBox && heldBin) {
                takeOut(heldBox, heldBin);
                Object.assign(shown, {heldBox, heldBin});
            }
            shown.pageDestroyId = shown.page.connect('destroy', () => {
                if (this._visit === shown) {
                    shown.page = null;
                    this.close();
                }
            });
        } else {
            shown.page = null;
            const box = menu.box;
            const bin = box?.get_parent();
            if (!box || !bin)
                return;
            takeOut(box, bin);
            this._content.add_child(box);
            box.add_style_class_name('sch-tray-menu-box');
            box.add_style_class_name('sch-hub-page');
            // as tall as its items, at the top: an item asking for the free
            // room (y_expand) would otherwise stretch to the bottom of the card
            Object.assign(shown, {box, bin, yExpand: box.y_expand});
            box.y_expand = false;
            shown.boxDestroyId = box.connect('destroy', () => {
                if (this._visit === shown) {
                    shown.box = null;
                    this.hide();
                }
            });
        }
        // the floating box stays hidden for the whole visit: GNOME may show
        // it again while it finishes opening (with a page of the extension
        // its menu is still in there and would float next to the panel)
        menu.actor.hide();
        shown.actorShowId = menu.actor.connect('notify::visible', () => {
            if (menu.actor.visible && this._visit === shown)
                menu.actor.hide();
        });
        // "Nothing Phone 2a Indicator" → "Nothing Phone 2a"
        const title = typeof hub?.title === 'string' && hub.title
            ? hub.title
            : this._panel.tray.label(info.role, indicator).replace(/\s+indicator$/i, '');
        this._enter(shown, title);
        info.cell?.add_style_class_name('sch-tray-cell-open');
    }

    // The card takes the place of every other card of the panel (they stay
    // hidden even if something shows them meanwhile), with the title on top
    _enter(shown, title) {
        // an app's page may want the card beside the panel: ours goes
        this._panel.side.closeHubSettings();
        // with tray-menu-fill the calendar, the clocks and the bottom buttons
        // stay under the menu, which then takes only the room it needs
        const fill = this._panel.settings.get_boolean('tray-menu-fill');
        const keep = fill ? this._fillKeepers() : new Set();
        this.actor.y_expand = !fill;
        this._panel.fillSpacer.visible = fill;
        for (const child of this._panel.sidebar.get_children()) {
            if (child === this.actor || child === this._panel.tray.actor || keep.has(child))
                continue;
            const entry = {child, wanted: child.visible};
            entry.id = child.connect('notify::visible', () => {
                if (child.visible) {
                    entry.wanted = true;
                    child.hide();
                }
            });
            child.hide();
            shown.hidden.push(entry);
        }
        this._visit = shown;
        this._title.text = title;
        this._scroll.vadjustment.value = 0;
        this.actor.show();
        this.tidy();
        // the apps rebuild parts of their menu while it is open (e.g. the
        // list of networks): the new pieces get the same treatment
        shown.cardsId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this.tidy();
            return GLib.SOURCE_CONTINUE;
        });
        // the keys go to our card (Esc: back, arrows: into the menu); no item
        // lit up at the start, as in a floating menu opened with the mouse
        this.actor.grab_key_focus();
    }

    // The pieces of the panel that stay under an app's menu: the rows of the
    // panel that hold the calendar, the world clocks and the bottom buttons
    _fillKeepers() {
        const keep = new Set();
        const {calendarLabel, calendarScroll, fillSpacer, worldClocks, bottom} = this._panel;
        for (const actor of [calendarLabel, calendarScroll, fillSpacer, worldClocks.actor, bottom.actor]) {
            let row = actor;
            while (row && row.get_parent() !== this._panel.sidebar)
                row = row.get_parent();
            if (row)
                keep.add(row);
        }
        return keep;
    }

    // The same sizes for every app: its cards without background, and no
    // empty room before the items when the menu has no check marks at all
    tidy() {
        if (!this._visit)
            return;
        this._panel.swaps.swap(this._visit);
        this._panel.updates.attach(this._visit);
        tidyMenu(this._visit);
    }

    // Close the menu shown inside (its 'open-state-changed' puts it back)
    close() {
        const shown = this._visit;
        if (!shown)
            return;
        try {
            shown.menu?.close();
        } catch (e) {
            logError(`tray menu: ${e}`);
        }
        this.hide();
    }

    // The menu back in its floating box, our cards back as they want to be
    hide() {
        const shown = this._visit;
        if (!shown)
            return;
        this._visit = null;
        if (shown.cardsId)
            GLib.source_remove(shown.cardsId);
        this._panel.side.hideSidePage(shown);
        if (shown.actorShowId)
            shown.menu.actor.disconnect(shown.actorShowId);
        untidyMenu(shown);
        for (const restore of shown.onClose ?? [])
            restore();
        // a page of the extension: built for this visit, destroyed after it
        // (the extension frees its resources on its 'destroy')
        if (shown.page) {
            shown.page.disconnect(shown.pageDestroyId);
            // another extension's widget: its own destroy() may throw
            try {
                shown.page.destroy();
            } catch (e) {
                logError(`page of ${shown.info?.role ?? shown.externalId}: ${e}`);
            }
        }
        // the menu of an extension that showed a page of its own goes back
        // into its floating box
        if (shown.heldBox && !shown.heldBox.get_parent())
            putBack(shown.heldBox, shown.heldBin);
        if (shown.box) {
            shown.box.y_expand = shown.yExpand;
            shown.box.disconnect(shown.boxDestroyId);
            shown.box.remove_style_class_name('sch-tray-menu-box');
            shown.box.remove_style_class_name('sch-hub-page');
            shown.box.get_parent()?.remove_child(shown.box);
            putBack(shown.box, shown.bin);
        }
        for (const {child, wanted, id} of shown.hidden) {
            child.disconnect(id);
            child.visible = wanted;
        }
        // the calendar may have been opened or closed under the menu
        // (tray-menu-fill): notifications, "Today" and the bottom buttons
        // follow it again
        this._panel.setCalendarExpanded(this._panel.calendarExpanded);
        shown.info?.cell?.remove_style_class_name('sch-tray-cell-open');
        for (const key of ['restoreId', 'sideRestoreId']) {
            if (shown[key])
                GLib.source_remove(shown[key]);
            shown[key] = 0;
        }
        if (this._pageMessageId)
            GLib.source_remove(this._pageMessageId);
        this._pageMessageId = 0;
        this._pageMessage.visible = false;
        this._panel.fillSpacer.visible = false;
        this.actor.y_expand = true;
        this.actor.hide();
    }

    // Public, for other extensions: show a page of theirs in the panel, with
    // no icon in the tray (see README, "For extension developers"). The panel
    // opens on it, in the same card as the tray menus: title, back arrow, Esc.
    // The page is built now and destroyed when the visit ends. Returns false
    // when the panel is not available (extension switched off, lock screen)
    // or the page cannot be shown, so the caller can use its own fallback.
    showExternalPage({
        id = null, title = '', buildPage, keepStyle = false,
        buildSidePage = null, sideTitle = '', sideCount = null, sideActions = [],
    } = {}) {
        const dm = this._panel.dateMenu;
        if (this._panel.disabling || typeof buildPage !== 'function')
            return false;
        // the same page already on screen: nothing to do
        if (id !== null && this._visit?.externalId === id && dm.menu.isOpen)
            return true;
        let page;
        try {
            page = buildPage();
        } catch (e) {
            logError(`external page ${id}: ${e}`);
            return false;
        }
        // a page still inside something else cannot be shown
        if (!(page instanceof Clutter.Actor) || page.get_parent())
            return false;
        try {
            if (!dm.menu.isOpen)
                dm.menu.open();
            this.close();
        } catch (e) {
            logError(`external page ${id}: ${e}`);
        }
        // the panel did not open: the page goes, the caller uses its fallback
        if (!dm.menu.isOpen) {
            page.destroy();
            return false;
        }
        const shown = {
            externalId: id, menu: null, info: null, page,
            hub: {keepStyle: !!keepStyle},
            hidden: [], cleared: new Map(), ornaments: new Map(),
        };
        this._content.add_child(page);
        this._watchExternalPage(shown, page);
        this._enter(shown, typeof title === 'string' && title ? title : String(id ?? ''));
        if (buildSidePage)
            this._panel.side.showSidePage(shown, buildSidePage, {sideTitle, sideCount, sideActions});
        return true;
    }

    // The page of an extension: our style class, and destroying it ends the visit
    _watchExternalPage(shown, page) {
        page.add_style_class_name?.('sch-hub-page');
        shown.pageDestroyId = page.connect('destroy', () => {
            if (this._visit === shown && shown.page === page) {
                shown.page = null;
                this.close();
            }
        });
    }

    // The external page `id` shown now, or null
    _externalShown(id) {
        const shown = this._visit;
        return shown && shown.externalId !== null && shown.externalId === id ? shown : null;
    }

    // Public: a short message at the bottom of the page of extension `id`
    // (the result of an action, an error), gone after `seconds`. false when
    // that page is not on screen.
    showPageMessage(id, text, seconds = 4) {
        if (!this._externalShown(id))
            return false;
        this._pageMessage.text = String(text ?? '');
        this._pageMessage.visible = !!this._pageMessage.text;
        if (this._pageMessageId)
            GLib.source_remove(this._pageMessageId);
        this._pageMessageId = 0;
        const secs = Math.max(1, Math.min(30, Math.round(Number(seconds) || 4)));
        this._pageMessageId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
            this._pageMessageId = 0;
            this._pageMessage.visible = false;
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }

    // Public: the number in the header of the side card of extension `id`
    setSideCount(id, count) {
        const label = this._externalShown(id)?.side?.countLabel;
        if (!label)
            return false;
        label.text = count === null || count === undefined ? '' : String(count);
        return true;
    }

    // Public: new contents for the page (and side page) of extension `id`,
    // keeping where they were scrolled. false when that page is not on
    // screen or nothing could be replaced.
    updateExternalPage(id, {buildPage = null, buildSidePage = null} = {}) {
        const shown = this._externalShown(id);
        if (!shown)
            return false;
        const build = fn => {
            try {
                const actor = fn();
                return actor instanceof Clutter.Actor && !actor.get_parent() ? actor : null;
            } catch (e) {
                logError(`external page ${id}: ${e}`);
                return null;
            }
        };
        // put back the scroll position once the new contents are laid out
        const keepScroll = (adjustment, key) => {
            const value = adjustment.value;
            if (shown[key])
                GLib.source_remove(shown[key]);
            shown[key] = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                shown[key] = 0;
                if (this._visit === shown)
                    adjustment.value = Math.max(adjustment.lower, Math.min(value, adjustment.upper - adjustment.page_size));
                return GLib.SOURCE_REMOVE;
            });
        };
        let done = false;
        if (typeof buildPage === 'function' && shown.page) {
            const page = build(buildPage);
            if (page) {
                keepScroll(this._scroll.vadjustment, 'restoreId');
                const old = shown.page;
                old.disconnect(shown.pageDestroyId);
                this._content.insert_child_above(page, old);
                shown.page = page;
                this._watchExternalPage(shown, page);
                old.destroy();
                done = true;
            }
        }
        const side = shown.side;
        if (typeof buildSidePage === 'function' && side?.page) {
            const page = build(buildSidePage);
            const inner = side.page.get_parent();
            if (page && inner) {
                keepScroll(side.scroll.vadjustment, 'sideRestoreId');
                inner.insert_child_above(page, side.page);
                page.add_style_class_name?.('sch-hub-page');
                side.page.destroy();
                side.page = page;
                done = true;
            } else {
                page?.destroy();
            }
        }
        if (done)
            this.tidy();
        return done;
    }
}
