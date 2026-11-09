// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The card beside the panel, like the extra cards of Quick Settings Audio
// Panel. It holds the calendar (a click on the "Today" card), or for a while
// the second page of an extension (showExternalPage, the settings of
// Vesperal and Freon) or our own settings (the gear). Both cards stay inside
// the same menu, so a click on one does not close it: the menu's content
// box becomes transparent (sch-cards-host) and the panel and the card each
// get the look of a menu (popup-menu-content).

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {_} from './sch-i18n.js';
import {buildSectionList, buildSectionPage, openPage} from './sch-hub-settings.js';
import {logError, logWarning} from './sch-log.js';
import {settingsSections} from './sch-settings-model.js';
import {UPDATES_SECTION} from './sch-updates.js';

// The calendar beside the panel: kept until the next login (module-level, it
// survives disable/enable on screen lock)
let calendarSide = false;

// A box that asks for no width of its own: it takes the width it is given.
// The pages in the card are as wide as the calendar's card whatever they
// hold; a long text gets its ellipsis instead of widening the card (and the
// whole menu, which then went off the screen).
const NarrowBox = GObject.registerClass(
class NarrowBox extends St.BoxLayout {
    vfunc_get_preferred_width(_forHeight) {
        return [0, 0];
    }
});

export class SideCard {
    constructor(panel) {
        this._panel = panel;
        this._hubSettings = null;
        // the page of our settings on screen (null: the list)
        this._hubSection = null;
        this._hostOrientation = undefined;
        // popup-menu-content: the look of a menu
        this.card = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'popup-menu-content sch-calendar-card',
            y_align: Clutter.ActorAlign.START,
            visible: false,
        });
    }

    // One card again (the menu's content box back as it was)
    destroy() {
        this.closeHubSettings();
        this._unsetCalendarSide();
        this.card.destroy();
    }

    get calendarSide() {
        return calendarSide;
    }

    get hubSettingsOpen() {
        return this._hubSettings !== null;
    }

    // The panel opens: the calendar beside it closed, open, or as it was
    // left (setting calendar-side-reopen)
    panelOpened() {
        const reopen = this._panel.settings.get_string('calendar-side-reopen');
        const side = reopen === 'open' || (reopen === 'last' && calendarSide);
        if (side !== this.card.visible)
            this.setCalendarSide(side);
    }

    // The card goes on the side away from the screen edge
    moveToSide() {
        if (calendarSide && this.card.visible) {
            this._unsetCalendarSide();
            this.setCalendarSide(true);
        }
    }

    // The calendar in the card beside the panel (on) or inside the panel
    setCalendarSide(on) {
        const host = this._panel.dateMenu.menu.box;
        if (!this._panel.sidebar)
            return;
        // before the change (afterwards the box has no padding or border)
        if (on && !host.has_style_class_name('sch-cards-host'))
            this._panel.geometry.measureBeforeSide();
        calendarSide = on;
        const view = this._panel.calendarView.actor;
        if (on) {
            this._panel.setCalendarExpanded(false);
            this._hostOrientation ??= host.orientation;
            host.orientation = Clutter.Orientation.HORIZONTAL;
            host.add_style_class_name('sch-cards-host');
            this._panel.sidebar.add_style_class_name('popup-menu-content');
            if (view.get_parent() !== this.card) {
                view.get_parent()?.remove_child(view);
                this.card.add_child(view);
            }
            if (!this.card.get_parent()) {
                // on the side away from the screen edge
                if (this._panel.settings.get_string('sidebar-side') === 'left')
                    host.insert_child_above(this.card, this._panel.sidebar);
                else
                    host.insert_child_below(this.card, this._panel.sidebar);
            }
            this.card.visible = true;
        } else {
            this._unsetCalendarSide();
        }
        this._panel.geometry.update();
    }

    // Back to one card: the calendar inside the panel again
    _unsetCalendarSide() {
        const {calendarBox, sidebar} = this._panel;
        const host = this._panel.dateMenu.menu.box;
        const view = this._panel.calendarView.actor;
        this.card.visible = false;
        // (no calendar box once GNOME destroyed the panel at logout)
        if (calendarBox && view.get_parent() !== calendarBox) {
            view.get_parent()?.remove_child(view);
            calendarBox.add_child(view);
        }
        this.card.get_parent()?.remove_child(this.card);
        sidebar?.remove_style_class_name('popup-menu-content');
        host.remove_style_class_name('sch-cards-host');
        host.set_style(null);
        if (this._hostOrientation !== undefined)
            host.orientation = this._hostOrientation;
        this._hostOrientation = undefined;
    }

    // The second page of an extension in the card beside the panel (the one
    // of the calendar): the calendar steps aside for the visit, the page
    // scrolls if long. When it cannot be shown, the main page stays alone.
    showSidePage(shown, buildSidePage, {sideTitle = '', sideCount = null, sideActions = []} = {}) {
        let page;
        try {
            page = buildSidePage();
        } catch (e) {
            logError(`side page ${shown.externalId}: ${e}`);
            return;
        }
        if (!(page instanceof Clutter.Actor) || page.get_parent())
            return;
        const card = this.card;
        const view = this._panel.calendarView.actor;
        const side = {page, wasSide: calendarSide, wasExpanded: this._panel.calendarExpanded};
        if (!calendarSide)
            this.setCalendarSide(true);
        if (!calendarSide) {
            page.destroy();
            return;
        }
        view.hide();
        const inner = new NarrowBox({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        inner.add_child(page);
        page.add_style_class_name?.('sch-hub-page');
        side.scroll = new St.ScrollView({
            style_class: 'sch-side-page-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
            child: inner,
        });
        // the header is ours, like the calendar's month header: title, a
        // count, at most two round buttons; it stays while the list scrolls
        if (typeof sideTitle === 'string' && sideTitle) {
            side.header = this.sideHeader(sideTitle, sideCount, sideActions);
            side.countLabel = side.header.countLabel;
            card.add_child(side.header);
        }
        card.add_child(side.scroll);
        // as tall as the panel, so a long list scrolls inside the card
        card.height = this._panel.sidebar.height;
        shown.side = side;
        this._panel.pages.tidy();
    }

    // The calendar back in its card, or back inside the panel as it was
    hideSidePage(shown) {
        const side = shown.side;
        if (!side)
            return;
        shown.side = null;
        side.header?.destroy();
        side.scroll.destroy(); // the page with it: the extension frees it on 'destroy'
        this.card.height = -1;
        this._panel.calendarView.actor.show();
        if (!side.wasSide) {
            this.setCalendarSide(false);
            this._panel.setCalendarExpanded(side.wasExpanded);
        }
    }

    sideHeader(title, count, actions, back = null) {
        const header = new St.BoxLayout({style_class: 'sch-cal-header sch-side-header', x_expand: true});
        // back: the arrow before the title (only for our own settings)
        if (back) {
            const arrow = new St.Button({
                style_class: 'sch-cal-arrow',
                can_focus: true,
                accessible_name: _('Back'),
                y_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({icon_name: 'go-previous-symbolic', icon_size: 16}),
            });
            arrow.connect('clicked', () => back());
            header.add_child(arrow);
        }
        header.add_child(new St.Label({text: title, style_class: 'sch-cal-month', y_align: Clutter.ActorAlign.CENTER}));
        header.countLabel = new St.Label({
            text: count === null || count === undefined ? '' : String(count),
            style_class: 'sch-cal-year',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(header.countLabel);
        for (const action of (Array.isArray(actions) ? actions : []).slice(0, 2)) {
            if (!action?.icon || typeof action.onClick !== 'function')
                continue;
            const btn = new St.Button({
                style_class: 'sch-cal-arrow',
                can_focus: true,
                accessible_name: action.label ?? '',
                y_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({icon_name: action.icon, icon_size: 16}),
            });
            btn.connect('clicked', () => {
                try {
                    action.onClick();
                } catch (e) {
                    logError(`side page action: ${e}`);
                }
            });
            header.add_child(btn);
        }
        return header;
    }

    // Our own settings in the card beside the panel, like the settings of
    // Vesperal and Freon (the panel itself stays as it is): the list of the
    // sections, then one section. A second click on the button closes them.
    toggleHubSettings() {
        if (this._hubSettings) {
            this.closeHubSettings();
            return;
        }
        // the page of an app gives the card back first
        this._panel.pages.close();
        const hub = {externalId: 'smart-calendar-hub'};
        this.showSidePage(hub, () => this._hubSettingsPage(null), {
            sideTitle: 'Smart Calendar Hub',
            sideActions: this._hubSettingsActions(),
        });
        if (hub.side) {
            this._hubSettings = hub;
            this._hubSection = null;
        }
        else
            logWarning('no card beside the panel for the settings');
    }

    // Straight to one page of our settings (the updates button); a second
    // click on it closes the card
    toggleHubPage(id) {
        if (this._hubSettings && this._hubSection === id) {
            this.closeHubSettings();
            return;
        }
        if (!this._hubSettings)
            this.toggleHubSettings();
        this._showHubSection(id);
    }

    _hubSettingsActions() {
        return [{
            icon: 'window-close-symbolic',
            label: _('Close'),
            onClick: () => this.closeHubSettings(),
        }];
    }

    // The list of the sections (id null) or the settings of section `id`
    _hubSettingsPage(id) {
        if (id === null) {
            // the version of the hub at the bottom, and a new one when there is
            const version = this._panel.versionCheck.buildNotice(url => openPage(() => this._panel.dateMenu.menu.close(), url));
            return buildSectionList(sectionId => this._showHubSection(sectionId), this._extraSections(), version);
        }
        if (id === UPDATES_SECTION) {
            return this._panel.updates.buildPage(count => {
                const label = this._hubSettings?.side?.countLabel;
                if (label && this._hubSection === UPDATES_SECTION)
                    label.text = count === null ? '' : String(count);
            });
        }
        return buildSectionPage(this._panel.settings, id, {
            closePanel: () => this._panel.dateMenu.menu.close(),
            reloadCalendars: () => this._panel.calendarView.reloadCalendars(),
            widgetRegistry: this._panel.widgetRegistry,
        });
    }

    // The pages after our sections in the list: "System updates" on
    // systems without Octopi
    _extraSections() {
        const updates = this._panel.updates?.settingsEntry;
        return updates ? [updates] : [];
    }

    // Another page of our settings in the same card: the page and the header
    // change, the card stays (id null: back to the list)
    _showHubSection(id) {
        const side = this._hubSettings?.side;
        const inner = side?.page?.get_parent();
        if (!inner)
            return;
        const page = this._hubSettingsPage(id);
        const title = id === null
            ? 'Smart Calendar Hub'
            : id === UPDATES_SECTION
                ? _('System updates')
                : settingsSections().find(section => section.id === id)?.title ?? '';
        const header = this.sideHeader(title, null, this._hubSettingsActions(),
            id === null ? null : () => this._showHubSection(null));
        inner.insert_child_above(page, side.page);
        page.add_style_class_name('sch-hub-page');
        side.page.destroy();
        side.page = page;
        this.card.insert_child_below(header, side.scroll);
        side.header?.destroy();
        side.header = header;
        side.countLabel = header.countLabel;
        side.scroll.vadjustment.value = 0;
        this._hubSection = id;
    }

    // Our settings away from the card: the calendar back as it was
    closeHubSettings() {
        const hub = this._hubSettings;
        if (!hub)
            return;
        this._hubSettings = null;
        this.hideSidePage(hub);
    }
}
