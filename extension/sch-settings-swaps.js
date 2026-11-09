// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// In the panel, the items of an extension's menu that open its preferences
// window (SETTINGS_SWAPS in sch-ext-settings.js, by role) open its main
// settings in the card beside the panel instead: for the visit each one is
// hidden and one of ours takes its place. Applied again when the extension
// builds its menu anew (Freon does, with removeAll(), when a setting
// changes): our items go with the old ones, theirs come back.

import Gettext from 'gettext';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {_} from './sch-i18n.js';
import {SETTINGS_SWAPS} from './sch-ext-settings.js';
import {VESPERAL_ROLE} from './sch-ext-icons.js';

export class SettingsSwaps {
    constructor(panel) {
        this._panel = panel;
        this._reopenId = 0;
    }

    destroy() {
        if (this._reopenId)
            GLib.source_remove(this._reopenId);
        this._reopenId = 0;
    }

    // Our items in the menu of the visit, if its extension has a swap
    swap(shown) {
        const role = shown?.info?.role;
        const config = Object.hasOwn(SETTINGS_SWAPS, role ?? '') ? SETTINGS_SWAPS[role] : null;
        if (!config || !shown.menu || shown.page || shown.swap || this._panel.pages.visit !== shown)
            return;
        const textOf = item => item.label?.text ??
            item.get_children().find(child => child instanceof St.Label)?.text;
        const items = (shown.menu._getMenuItems?.() ?? []).filter(item =>
            item instanceof PopupMenu.PopupBaseMenuItem);
        const swap = {pairs: []};
        // the items the extension names itself (smartCalendarHub.settingsItems),
        // or else the ones found by their own text, in their own translation
        const declared = Array.isArray(shown.hub?.settingsItems)
            ? shown.hub.settingsItems.filter(item => item instanceof PopupMenu.PopupBaseMenuItem && item.get_parent())
            : [];
        const targets = declared.length
            ? declared
            : config.texts.map(english => {
                const text = Gettext.dgettext(config.domain, english);
                return items.findLast(item => textOf(item) === text);
            });
        for (const theirs of targets) {
            const parent = theirs?.get_parent();
            if (!parent)
                continue;
            const ours = new PopupMenu.PopupMenuItem(textOf(theirs) ?? '');
            // not added with addMenuItem(): the menu would close on activate,
            // and the card with it
            ours.connect('activate', () => this._toggle(shown, config));
            // wanted: whether the extension wants its item seen (Vesperal
            // shows the one for the location only while it knows none);
            // ours follows it, theirs stays hidden
            const pair = {ours, theirs, wanted: theirs.visible, hiding: false};
            const hideTheirs = () => {
                pair.hiding = true;
                theirs.hide();
                pair.hiding = false;
            };
            pair.ids = [
                theirs.connect('destroy', () => {
                    pair.theirs = null;
                }),
                theirs.connect('notify::visible', () => {
                    if (pair.hiding || !pair.theirs)
                        return;
                    pair.wanted = theirs.visible;
                    if (pair.ours)
                        pair.ours.visible = pair.wanted;
                    if (theirs.visible)
                        hideTheirs();
                }),
            ];
            // gone without us (the menu built anew): theirs back, ours again
            // once the extension has finished (never inside 'destroy')
            // (the other items of ours are left to that moment too)
            ours.connect('destroy', () => {
                pair.ours = null;
                if (shown.swap !== swap)
                    return;
                shown.swap = null;
                this._restoreTheirs(swap, false);
                shown.oldSwap = swap;
                if (!shown.swapIdleId) {
                    shown.swapIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        shown.swapIdleId = 0;
                        this._dropOldSwap(shown);
                        this.swap(shown);
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
            parent.insert_child_above(ours, theirs);
            ours.visible = pair.wanted;
            hideTheirs();
            swap.pairs.push(pair);
        }
        if (!swap.pairs.length)
            return;
        shown.swap = swap;
        if (!shown.swapRestore) {
            shown.swapRestore = () => this._unswap(shown);
            (shown.onClose ??= []).push(shown.swapRestore);
        }
    }

    // Their items back as they want them, and ours gone (not from inside
    // the 'destroy' of one of ours: destroyOurs false)
    _restoreTheirs(swap, destroyOurs = true) {
        for (const pair of swap.pairs) {
            const theirs = pair.theirs;
            pair.theirs = null;
            // null once destroyed (its 'destroy' handler)
            if (theirs) {
                pair.ids.forEach(id => theirs.disconnect(id));
                theirs.visible = pair.wanted;
            }
            // null once destroyed (its 'destroy' handler)
            if (destroyOurs)
                pair.ours?.destroy();
        }
    }

    // The items of ours left from a menu built anew
    _dropOldSwap(shown) {
        const old = shown.oldSwap;
        shown.oldSwap = null;
        if (old)
            this._restoreTheirs(old);
    }

    // At the end of the visit: their items back, ours gone
    _unswap(shown) {
        if (shown.swapIdleId)
            GLib.source_remove(shown.swapIdleId);
        shown.swapIdleId = 0;
        this._dropOldSwap(shown);
        const swap = shown.swap;
        shown.swap = null; // before destroy: no new swap from its 'destroy'
        if (swap)
            this._restoreTheirs(swap);
    }

    _toggle(shown, config) {
        if (this._panel.pages.visit !== shown)
            return;
        if (shown.side) {
            this._panel.side.hideSidePage(shown);
            return;
        }
        const settings = config.settings();
        if (!settings) {
            Main.extensionManager.openExtensionPrefs(config.uuid, '', {});
            return;
        }
        const role = shown.info?.role;
        // a change that makes the extension build its icon and menu anew
        // (Vesperal, when its icon moves) ends this visit: made after the
        // click (the card goes with the menu), then the card opened again
        // on the new menu, which the extension builds at once
        const rebuild = change => {
            if (this._reopenId)
                return;
            this._reopenId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._reopenId = 0;
                change();
                this._reopen(role, config);
                return GLib.SOURCE_REMOVE;
            });
        };
        this._panel.side.showSidePage(shown, () => config.build(settings, {rebuild}), {
            sideTitle: config.name,
            sideActions: [{
                icon: 'window-close-symbolic',
                label: _('Close'),
                onClick: () => this._panel.side.hideSidePage(shown),
            }],
        });
    }

    // The card of `role` again, if its menu went away with the change and
    // the panel is still open (only Vesperal's menu can be opened from here)
    _reopen(role, config) {
        if (role !== VESPERAL_ROLE || this._panel.disabling || !this._panel.dateMenu.menu.isOpen)
            return;
        if (this._panel.pages.visit?.info?.role !== role)
            this._panel.openVesperalMenu();
        const shown = this._panel.pages.visit;
        if (shown?.info?.role === role && !shown.side)
            this._toggle(shown, config);
    }
}
