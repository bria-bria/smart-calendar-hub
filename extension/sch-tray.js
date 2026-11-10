// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The tray at the top of the panel: the icons of the top bar (AppIndicator,
// legacy tray icons, or every icon on the right) moved into one row, each in
// a cell of ours, with an arrow on each side when they do not fit. The
// settings button sits at the end of the row. The icons themselves are made
// by their extensions (AppIndicator): we only move them, and put them back.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {_} from './sch-i18n.js';
import {logError} from './sch-log.js';
import {FREON_ROLE} from './sch-ext-icons.js';
import {IP_ROLE} from './sch-net.js';
import {oneLine, setStrvIfChanged} from './sch-settings-model.js';

// Panel items that must never be moved inside the panel tray.
const ROLES_NEVER_IN_TRAY = new Set([
    'dateMenu',
    IP_ROLE, // our own IP indicator: it has its own position setting
    'quickSettings',
    'screenRecording',
    'screenSharing',
    'keyboard',
    'a11y',
    'dwellClick',
    'activities',
    'appMenu',
    'places-menu',
    'apps-menu',
    'activities-icon-button',
]);

// Names for the icons whose only name is their role in the top bar
const TRAY_NAMES = {[FREON_ROLE]: 'Freon'};

// Inline style of the buttons in the tray (see _tightenButton)
const TRAY_BUTTON_STYLE = '-natural-hpadding: 0px; -minimum-hpadding: 0px';

export class Tray {
    constructor(panel) {
        this._panel = panel;
        this._settings = panel.settings;
        this._moved = new Map();
        this._excluded = new Set();
        this._syncing = false;
        this._layoutId = 0;
        this._arrowsId = 0;
        // the floating menus of the icons that keep them
        this.menuManager = new PopupMenu.PopupMenuManager(panel.sidebar);
        this.actor = new St.BoxLayout({style_class: 'sch-weather-row', x_expand: true});
        // [◀] icons [▶]: the arrows appear only when the icons do not fit
        this._section = new St.BoxLayout({
            style_class: 'sch-tray-section',
            x_expand: true,
            visible: false,
        });
        // with no icons in the tray: the name of the extension on the left,
        // the settings button stays on the right
        this._title = new St.Label({
            text: 'Smart Calendar Hub',
            style_class: 'sch-app-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // One row of icons, each in a cell of ours of the same size
        // (sch-tray-cell) with the icon centred: the buttons of other
        // extensions have different widths. In the centre; with more icons
        // than room, an arrow on each side moves the view.
        this._box = new St.BoxLayout({style_class: 'sch-tray-box', x_expand: true});
        // a spacer on each side: the icons stay in the centre
        this._box.add_child(new St.Widget({x_expand: true}));
        this._endSpacer = new St.Widget({x_expand: true});
        this._box.add_child(this._endSpacer);
        // No scrollbar: the arrows on the sides move the view. EXTERNAL, not
        // NEVER: with NEVER the view asks for the whole width of the icons
        // and pushed the settings button out of the panel.
        const trayScroll = this._scroll = new St.ScrollView({
            style_class: 'sch-tray-scroll',
            x_expand: true,
            hscrollbar_policy: St.PolicyType.EXTERNAL,
            vscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: false,
            child: this._box,
        });
        // the mouse wheel scrolls the row sideways
        trayScroll.connect('scroll-event', (_actor, event) => {
            const adj = this._box.hadjustment;
            const dir = event.get_scroll_direction();
            let delta = 0;
            if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT)
                delta = -1;
            else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT)
                delta = 1;
            else if (dir === Clutter.ScrollDirection.SMOOTH) {
                const [dx, dy] = event.get_scroll_delta();
                delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
            }
            if (!delta)
                return Clutter.EVENT_PROPAGATE;
            adj.value += delta * this._step();
            return Clutter.EVENT_STOP;
        });
        const arrow = (icon, delta, name) => {
            const btn = new St.Button({
                style_class: 'sch-tray-arrow',
                can_focus: true,
                accessible_name: name,
                y_align: Clutter.ActorAlign.CENTER,
                visible: false,
                child: new St.Icon({icon_name: icon, icon_size: 12}),
            });
            btn.connect('clicked', () => {
                const adj = this._box.hadjustment;
                const target = Math.max(adj.lower,
                    Math.min(adj.upper - adj.page_size, adj.value + delta * this._step()));
                adj.ease(target, {duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            });
            return btn;
        };
        this._left = arrow('pan-start-symbolic', -1, _('Previous icons'));
        this._right = arrow('pan-end-symbolic', 1, _('Next icons'));
        this._section.add_child(this._left);
        this._section.add_child(trayScroll);
        this._section.add_child(this._right);
        trayScroll.connect('notify::width', () => this._queueArrows());
        // the arrow at the end of the row is dimmed
        const adjustment = this._box.hadjustment;
        for (const prop of ['value', 'upper', 'page-size'])
            adjustment.connect(`notify::${prop}`, () => this._syncArrowEnds());
        this.actor.add_child(this._section);
        this.actor.add_child(this._title);
        const gear = this._gear = new St.Button({
            style_class: 'sch-gear-button',
            can_focus: true,
            accessible_name: _('Settings'),
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 14}),
        });
        // our settings in the card beside the panel (sch-hub-settings.js)
        // (a right click: the profiles, sch-profile-switch.js)
        gear.connect('clicked', (_gear, button) => {
            if (button !== Clutter.BUTTON_SECONDARY)
                this._panel.side.toggleHubSettings();
        });
        this.actor.add_child(gear);
        this._settings.connectObject(
            'changed::tray-menus-inside', () => this.syncMenuModes(),
            'changed::tray-menus-floating', () => this.syncMenuModes(),
            'changed::top-bar-spacing', () => {
                for (const info of this._moved.values())
                    info.cell.set_style(this._cellStyle());
                this._queueArrows();
            },
            this.actor);
    }

    // Every icon back where it was in the top bar
    destroy() {
        if (this._layoutId)
            GLib.source_remove(this._layoutId);
        this._layoutId = 0;
        if (this._arrowsId)
            GLib.source_remove(this._arrowsId);
        this._arrowsId = 0;
        this._restoreAll();
        this._moved.clear();
    }

    // The row went with the panel (GNOME Shell destroyed it at logout)
    forget() {
        this.actor = null;
        this._section = null;
        this._title = null;
        this._box = null;
        this._endSpacer = null;
        this._scroll = null;
        this._left = null;
        this._right = null;
        this._gear = null;
    }

    // true while the icons are being moved (they land in the boxes of the
    // top bar, which looks like new icons)
    get syncing() {
        return this._syncing;
    }

    // A button of another part of the panel, before the gear (it frees it)
    addButton(button) {
        this.actor.insert_child_below(button, this._gear);
    }

    get gear() {
        return this._gear;
    }

    // Stable identifier of an icon, kept across sessions: the app id for
    // AppIndicator icons (the panel role of some apps changes every login),
    // the window class for legacy tray icons, otherwise the panel role.
    _key(role, indicator) {
        return indicator._indicator?.id || indicator._icon?.wm_class || role;
    }

    label(role, indicator) {
        const sni = indicator._indicator;
        // title first: the accessible name often contains unread counts,
        // which would rewrite the list on every new message
        return sni?.title || sni?.accessibleName || sni?.id ||
            indicator._icon?.title || indicator._icon?.wm_class ||
            indicator.accessible_name || TRAY_NAMES[role] || role;
    }

    _wanted(role, indicator) {
        return this._isCandidate(role, indicator) &&
            !this._excluded.has(this._key(role, indicator));
    }

    // Writes the icons that can be moved, for the settings (Tray section)
    // (only when the list changed, to avoid needless dconf writes).
    _publish() {
        // With the tray turned off nothing is a candidate: keep the last list,
        // so our settings show it greyed out instead of empty.
        if (this._settings.get_string('tray-mode') === 'disabled')
            return;
        const items = new Map();
        for (const [role, indicator] of Object.entries(Main.panel.statusArea)) {
            if (this._isCandidate(role, indicator)) {
                const label = oneLine(this.label(role, indicator));
                items.set(this._key(role, indicator), label);
            }
        }
        const list = [...items].map(([k, l]) => `${k}\t${l}`).sort();
        setStrvIfChanged(this._settings, 'tray-items-seen', list);
    }

    _isCandidate(role, indicator) {
        const mode = this._settings.get_string('tray-mode');
        if (mode === 'disabled' || !indicator?.container || ROLES_NEVER_IN_TRAY.has(role))
            return false;

        const r = (role ?? '').toLowerCase();
        const c = (indicator.constructor?.name ?? '').toLowerCase();
        const isTray = r.startsWith('appindicator') ||
            ['kstatusnotifier', 'statusnotifier', 'status_icon', 'tray'].some(s => r.includes(s)) ||
            ['appindicator', 'statusnotifier', 'tray'].some(s => c.includes(s));

        if (mode === 'all-tray')
            return isTray;
        // 'all-right-icons'
        return isTray || this._moved.has(indicator) ||
            indicator.container.get_parent() === Main.panel._rightBox;
    }

    sync() {
        if (!this._box || this._syncing)
            return;
        this._syncing = true;
        this._excluded = new Set(this._settings.get_strv('tray-excluded'));
        try {
            for (const [indicator, info] of [...this._moved]) {
                if (info.container.get_parent() !== info.cell ||
                    info.cell.get_parent() !== this._box) {
                    // Another extension (e.g. Top Bar Organizer, which re-sorts
                    // every icon whenever one is added) took it back to the
                    // top bar: forget it, the loop below moves it in again.
                    this._release(indicator, info);
                    this._moved.delete(indicator);
                } else if (!this._wanted(info.role, indicator)) {
                    this._restore(indicator, info);
                    this._moved.delete(indicator);
                }
            }
            for (const [role, indicator] of Object.entries(Main.panel.statusArea)) {
                if (!this._moved.has(indicator) && this._wanted(role, indicator))
                    this._move(role, indicator);
            }
            this._publish();
        } catch (e) {
            logError(`tray sync failed: ${e}`);
        } finally {
            this._syncing = false;
        }
        this.layout();
        this._panel.alerts.syncTray();
    }

    // Arrows only when the icons do not fit (checked after the layout)
    _queueArrows() {
        if (this._arrowsId || !this._box || this._panel.disabling)
            return;
        this._arrowsId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._arrowsId = 0;
            const scroll = this._scroll;
            if (!scroll || !this._box)
                return GLib.SOURCE_REMOVE;
            // natural width of the icons (the spacer in front has none)
            const [, natural] = this._box.get_preferred_width(-1);
            // with the arrows shown the box is narrower: compare with the
            // room the icons have without them
            const arrows = this._left.visible ? this._left.width + this._right.width + 8 : 0;
            const overflow = natural > scroll.width + arrows + 1;
            this._left.visible = overflow;
            this._right.visible = overflow;
            if (!overflow)
                this._box.hadjustment.value = 0;
            this._syncArrowEnds();
            return GLib.SOURCE_REMOVE;
        });
    }

    // How far one click of the tray arrows moves the view: one icon cell and
    // the space after it, as the stylesheet draws them
    _step() {
        const cell = this._box?.get_child_at_index(1);
        if (!cell || cell === this._endSpacer || !(cell.width > 0))
            return 36;
        return cell.width + this._box.get_theme_node().get_length('spacing');
    }

    _syncArrowEnds() {
        const adj = this._box?.hadjustment;
        if (!adj || !this._left)
            return;
        this._left.opacity = adj.value > adj.lower + 1 ? 255 : 90;
        this._right.opacity = adj.value < adj.upper - adj.page_size - 1 ? 255 : 90;
    }

    // layout() once the current destruction is over
    _queueLayout() {
        // not while the extension is being disabled (icons are destroyed then)
        if (this._layoutId || !this._box || this._panel.disabling)
            return;
        this._layoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._layoutId = 0;
            this.layout();
            return GLib.SOURCE_REMOVE;
        });
    }

    layout() {
        if (!this._box)
            return;
        const cells = [...this._moved.values()].map(i => i.cell);
        this._showSection(this._anyShown());
        // first and last children: the spacers that centre the icons
        const current = this._box.get_children().slice(1, -1);
        // cells left empty by icons that were destroyed
        const wanted = new Set(cells);
        for (const cell of current.filter(c => !wanted.has(c)))
            cell.destroy();
        // Nothing to do if the order is the same (re-adding every icon makes
        // AppIndicator reload them)
        const kept = current.filter(c => wanted.has(c));
        if (kept.length === cells.length && kept.every((c, i) => c === cells[i])) {
            this._queueArrows();
            return;
        }
        for (const cell of kept)
            this._box.remove_child(cell);
        for (const cell of cells) {
            cell.get_parent()?.remove_child(cell);
            this._box.insert_child_below(cell, this._endSpacer);
        }
        this._queueArrows();
    }

    // A cell as wide as an icon's button in the top bar: the 16 px icon,
    // GNOME's 3 px border on each side and the space chosen for the bar
    _cellStyle() {
        return `width: ${22 + 2 * this._settings.get_int('top-bar-spacing')}px`;
    }

    // The tray box only with icons; the spacer keeps the settings button on
    // the right when the box is hidden.
    _showSection(visible) {
        if (this._section)
            this._section.visible = visible;
        if (this._title)
            this._title.visible = !visible;
    }

    _move(role, indicator) {
        const container = indicator.container;
        const parent = container.get_parent();
        if (!parent)
            return;

        const info = {
            role,
            container,
            parent,
            index: parent.get_children().indexOf(container),
            hadPanelMenu: false,
            yExpand: container.y_expand,
            xExpand: container.x_expand,
            xAlign: container.x_align,
            yAlign: container.y_align,
            // a cell of ours, all of the same size, with the icon centred
            cell: new St.Bin({style_class: 'sch-tray-cell', style: this._cellStyle()}),
            menuId: 0,
            destroyId: 0,
        };

        const menu = indicator.menu;
        if (menu) {
            // removeMenu() never fails, so check first whether the panel owns it
            info.hadPanelMenu = Main.panel.menuManager._menus?.includes(menu) ?? false;
            if (info.hadPanelMenu)
                Main.panel.menuManager.removeMenu(menu);
            info.key = this._key(role, indicator);
            this._setMenuMode(indicator, info);
            info.menuId = menu.connect('open-state-changed', (m, isOpen) => {
                if (isOpen && info.inside && !this._panel.disabling)
                    this._panel.pages.showTrayMenu(indicator, info);
                else if (isOpen && m.actor)
                    Main.uiGroup.set_child_above_sibling(m.actor, null);
                else if (!isOpen && this._panel.pages.visit?.menu === m)
                    this._panel.pages.hide();
            });
        }

        // into its cell; layout() puts the cell in the row
        parent.remove_child(container);
        container.add_style_class_name('sch-tray-item');
        container.y_expand = false;
        container.x_expand = false;
        container.x_align = Clutter.ActorAlign.CENTER;
        container.y_align = Clutter.ActorAlign.CENTER;
        info.cell.set_child(container);
        this._tightenButton(info);

        // The icon is being destroyed (e.g. AppIndicator removes it). Its cell
        // must NOT be destroyed here: the icon is still its child, in the
        // middle of its own destruction, and destroying the parent now trips
        // a Clutter assertion that crashes GNOME Shell. The empty cell is
        // removed by the next layout, after the icon is gone.
        info.destroyId = container.connect('destroy', () => {
            this._moved.delete(indicator);
            this._showSection(this._anyShown());
            this._queueLayout();
        });
        this._moved.set(indicator, info);

        // An app may hide its icon (GSConnect: device not connected): its
        // cell goes too, no hole in the row
        const syncCell = () => {
            if (this._panel.disabling || !info.cell)
                return;
            info.cell.visible = container.visible && indicator.visible;
            if (!info.cell.visible && this._panel.pages.visit?.info === info)
                this._panel.pages.close();
            this._showSection(this._anyShown());
            this._queueArrows();
        };
        info.visibleIds = [container, indicator]
            .filter((actor, i, all) => all.indexOf(actor) === i)
            .map(actor => [actor, actor.connect('notify::visible', syncCell)]);
        syncCell();
    }

    // at least one icon of the tray is shown (else the name of the extension)
    _anyShown() {
        return [...this._moved.values()].some(i => i.cell.visible);
    }

    // Undoes everything _move did except the position of the container.
    _release(indicator, info) {
        info.container.disconnect(info.destroyId);
        for (const [actor, id] of info.visibleIds)
            actor.disconnect(id);
        info.visibleIds = [];
        const menu = indicator.menu;
        if (menu && this._panel.pages.visit?.menu === menu)
            this._panel.pages.close();
        if (menu && info.menuId) {
            menu.disconnect(info.menuId);
            this.menuManager.removeMenu(menu);
            if (info.hadPanelMenu)
                Main.panel.menuManager.addMenu(menu);
        }
        this._restoreButton(info);
        info.container.remove_style_class_name('sch-tray-item');
        info.container.y_expand = info.yExpand;
        info.container.x_expand = info.xExpand;
        info.container.x_align = info.xAlign;
        info.container.y_align = info.yAlign;
        // the cell goes away; the container stays where it is (the caller
        // moves it back to the top bar, or another extension already did)
        if (info.container.get_parent() === info.cell)
            info.cell.set_child(null);
        info.cell.destroy();
    }

    // No side padding on the button of a tray icon, so every icon fits its
    // cell centred. Other extensions set it INLINE (AppIndicator in compact
    // mode: "-natural-hpadding: 10px"), and inline style wins over our
    // stylesheet: so it is set inline too, in front of their style, and set
    // again if they change it (same approach as the Status Area Horizontal
    // Spacing extension). _restoreButton() gives the original back.
    _tightenButton(info) {
        const button = info.container.get_first_child();
        if (!button?.set_style)
            return;
        info.button = button;
        info.buttonStyle = button.get_style();
        const apply = () => {
            const theirs = info.buttonStyle ? `; ${info.buttonStyle}` : '';
            // ours last, so it wins over theirs
            button.set_style(`${theirs}; ${TRAY_BUTTON_STYLE}`.replace(/^; /, ''));
        };
        apply();
        info.buttonStyleId = button.connect('style-changed', () => {
            const current = button.get_style() ?? '';
            if (current.includes(TRAY_BUTTON_STYLE))
                return;
            // they changed it: keep theirs as the original, ours again on top
            info.buttonStyle = current;
            apply();
        });
    }

    _restoreButton(info) {
        const button = info.button;
        if (!button)
            return;
        button.disconnect(info.buttonStyleId);
        button.set_style(info.buttonStyle ?? null);
        info.button = null;
        info.buttonStyleId = 0;
    }

    _restore(indicator, info) {
        this._release(indicator, info);
        info.container.get_parent()?.remove_child(info.container);
        const n = info.parent.get_n_children();
        info.parent.insert_child_at_index(info.container, Math.min(info.index, n));
    }

    // Inside the panel unless switched off, or chosen floating for this icon.
    // Inside: no menu manager (its grab would close the menu at the first
    // click inside the panel); the panel's own grab covers it.
    _setMenuMode(indicator, info) {
        const menu = indicator.menu;
        const inside = this._settings.get_boolean('tray-menus-inside') &&
            !this._settings.get_strv('tray-menus-floating').includes(info.key);
        const managed = this.menuManager._menus?.includes(menu) ?? false;
        if (inside && managed)
            this.menuManager.removeMenu(menu);
        else if (!inside && !managed)
            this.menuManager.addMenu(menu);
        info.inside = inside;
    }

    syncMenuModes() {
        this.menuManager.activeMenu?.close();
        this._panel.pages.close();
        for (const [indicator, info] of this._moved) {
            if (info.menuId && indicator.menu)
                this._setMenuMode(indicator, info);
        }
    }

    _restoreAll() {
        // Reverse order, so saved indices are still valid.
        for (const [indicator, info] of [...this._moved].reverse())
            this._restore(indicator, info);
    }
}
