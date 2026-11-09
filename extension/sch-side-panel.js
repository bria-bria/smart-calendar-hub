// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// The date menu turned into a side panel, built in the user session and
// taken down on screen lock. Each part is a widget (sch-widgets.js), in the
// order of the active profile, by default: tray icons (and the settings
// button) → IP addresses → weather → sky and date → collapsible calendar →
// "Today" → notifications → world clocks; then always the bottom row. GNOME's
// own widgets are moved in and given back where they were; each part of the
// panel is a module of its own, which frees what it creates.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {_, loadUserTranslations, unloadUserTranslations} from './sch-i18n.js';
import {AlertDot} from './sch-alert-dot.js';
import {BottomRow} from './sch-bottom-row.js';
import {CalendarView} from './sch-calendar.js';
import {ClockWeather} from './sch-clock-weather.js';
import {Connections} from './sch-signals.js';
import {ExtIcons, VESPERAL_ROLE} from './sch-ext-icons.js';
import {IpView, PanelIpBox} from './sch-net.js';
import {Notifications} from './sch-notifications.js';
import {PanelGeometry} from './sch-panel-geometry.js';
import {PanelPages} from './sch-panel-pages.js';
import {ResizeEdge} from './sch-resize-edge.js';
import {SettingsSwaps} from './sch-settings-swaps.js';
import {SideCard} from './sch-side-card.js';
import {SystemUpdates} from './sch-updates.js';
import {VersionCheck} from './sch-version-check.js';
import {SkyView} from './sch-sky.js';
import {TodayCard} from './sch-today.js';
import {TopBarOrganizer} from './sch-top-bar-organizer.js';
import {Tray} from './sch-tray.js';
import {WeatherSection} from './sch-weather-section.js';
import {WorldClocksCard} from './sch-world-clocks.js';
import {logError} from './sch-log.js';
import {placeWidgets, widgetOrder} from './sch-widgets.js';
import {moveClock} from './sch-topbar-style.js';
import {vesperalCoords, vesperalSettings} from './sch-ext-settings.js';

export class SidePanel {
    // version: the version-name of our metadata.json
    constructor(dateMenu, settings, version) {
        this.dateMenu = dateMenu;
        this.settings = settings;
        this.version = version;
        // true once the panel is going: callbacks still queued do nothing
        this.disabling = false;
        this._savedParents = [];
        this._signals = new Connections();
        this._idleId = 0;
        this._positioning = false;
        this._vesperalSettings = null;
        this._widgets = new Map(); // id → the actors of that widget in the sidebar

        const container = dateMenu.container;
        const parent = container.get_parent();
        this._dateMenuOrigin = parent
            ? {parent, index: parent.get_children().indexOf(container)}
            : null;

        // A step that fails undoes the ones done so far, instead of leaving
        // the date menu half rebuilt
        try {
            this._topBarOrganizer = new TopBarOrganizer(settings);
            this._topBarOrganizer.sync();
            this._build();
            this.tray.sync();
            this._extIcons = new ExtIcons(settings);
            this._applyTopBarPosition();
            this._watchPanelBoxes();
            this._ipView = new IpView(settings);
            this._ipPanel = new PanelIpBox(this._ipView, settings);
            this._ipPanelBin.set_child(this._ipPanel.actor);
        } catch (e) {
            this.destroy();
            throw e;
        }

        this._signals.connect(settings, 'changed', (_s, key) => this._onSettingChanged(key));

        // Languages other than Italian/English: create or complete the user's
        // file (new sentences appended at the end), load it, then translate
        // again the texts already shown (only if the panel is still there).
        loadUserTranslations({merge: true})
            .then(() => {
                if (!this.disabling)
                    this._retranslate();
            })
            .catch(e => logError(`translations: ${e}`));
    }

    // Every part is optional here: destroy() also undoes a build that failed
    // halfway (see the constructor)
    destroy() {
        this.disabling = true;
        unloadUserTranslations();
        this.resize?.destroy();
        this._extIcons?.destroy();
        this.today?.destroy();

        // First, so its role in the top bar is freed even if a later step fails
        this._ipPanel?.destroy();
        this._ipView?.destroy();

        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;
        this._signals.disconnectAll();

        this.alerts?.destroy();
        this._notifications?.destroy();
        this._clockWeather?.destroy();

        this.side?.closeHubSettings();
        this.pages?.close();
        this.tray?.destroy();
        this.swaps?.destroy();
        this.updates?.destroy();
        this.versionCheck?.destroy();
        this.geometry?.destroy();

        if (this.dateMenu._messageList)
            this.dateMenu._messageList.visible = this._sessionShowsNotifications();
        for (const {label, x_align} of this._dateAlignOrig ?? [])
            label.x_align = x_align;

        // Put the original widgets back in reverse order: every saved index
        // was taken after the previous widgets had already been removed.
        for (const {actor, parent, index} of this._savedParents.reverse()) {
            actor.get_parent()?.remove_child(actor);
            parent.insert_child_at_index(actor, index);
        }
        this._savedParents = [];
        // GNOME's buttons of the bottom row, now back in their places
        this.bottom?.destroy();
        this.worldClocks?.destroy();

        // One card again, then the panel goes: it is connected to GNOME's
        // calendar and events
        this.side?.destroy();
        this.calendarView?.destroy();
        this._skyView?.destroy();
        this.weather?.destroy();
        this.pages?.destroy();
        // every piece of ours inside it goes with it
        if (this.sidebar) {
            this.sidebar.disconnect(this._sidebarDestroyId);
            this.sidebar.destroy();
        }
        this._forgetSidebar();

        this._origBin?.show();
        this._topBarOrganizer?.restore();

        const container = this.dateMenu.container;
        const origin = this._dateMenuOrigin;
        if (origin && container.get_parent() !== origin.parent) {
            container.get_parent()?.remove_child(container);
            origin.parent.insert_child_at_index(container, origin.index);
        }
    }

    // The calendar is open inside the panel
    get calendarExpanded() {
        return !!this.calendarBox?.visible;
    }

    relayout() {
        this.dateMenu.menu._boxPointer?.queue_relayout();
    }

    // Moves a date-menu widget into the panel, remembering where it was.
    adopt(actor, newParent) {
        if (!actor)
            return;
        const parent = actor.get_parent();
        if (parent) {
            this._savedParents.push({actor, parent, index: parent.get_children().indexOf(actor)});
            parent.remove_child(actor);
        }
        newParent.add_child(actor);
    }

    // The calendar takes the place of the notifications while it is open;
    // "Today" and the bottom row follow it
    setCalendarExpanded(expanded) {
        // (nothing to do once GNOME destroyed the panel at logout)
        if (!this.calendarBox)
            return;
        this.calendarScroll.visible = expanded;
        this.calendarBox.visible = expanded;
        this.today.sync();
        if (this.dateMenu._messageList)
            this.dateMenu._messageList.visible = !expanded && this._sessionShowsNotifications();
        this._calendarArrow.icon_name = expanded ? 'pan-down-symbolic' : 'pan-end-symbolic';
        this.bottom.setCalendarOpen(expanded);
        this.relayout();
    }

    // The menu of Vesperal in the panel, as a tray menu (its icon stays next
    // to the clock, with its own floating menu)
    openVesperalMenu() {
        const indicator = Main.panel.statusArea[VESPERAL_ROLE];
        if (!indicator?.menu)
            return;
        indicator.menu.close();
        this.pages.showTrayMenu(indicator, {role: VESPERAL_ROLE, key: VESPERAL_ROLE, cell: null});
    }

    _build() {
        const dm = this.dateMenu;
        const menuBox = dm.menu.box;

        this._origBin = menuBox.get_first_child();
        this._origBin.hide();

        this.sidebar = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-sidebar-box',
            x_expand: true,
            y_expand: true,
        });
        menuBox.add_child(this.sidebar);
        // At logout GNOME Shell destroys the panel without calling disable():
        // from then on nothing may touch its widgets (icons still being
        // destroyed queue a layout)
        this._sidebarDestroyId = this.sidebar.connect('destroy', () => {
            this.disabling = true;
            this.pages.forget();
            this.tray.forget();
            this._forgetSidebar();
        });
        this.geometry = new PanelGeometry(this);
        this.resize = new ResizeEdge(this);

        // the weather inside the clock pill, unless another extension
        // already shows it next to the clock; before the red dot, which
        // goes into the pill next to the clock
        const client = dm._weatherItem?._weatherClient;
        if (dm._clockDisplay?.get_parent() && client)
            this._clockWeather = new ClockWeather(dm, client, this.settings);
        this._notifications = new Notifications(dm, this.settings);
        this.alerts = new AlertDot(dm, this.settings, this._notifications);

        // Tray icons, with the settings button on their right; the menu of a
        // tray icon shows inside the panel, in the card under them
        this._widget('tray', () => {
            this.tray = new Tray(this);
            this.sidebar.add_child(this.tray.actor);
            this.pages = new PanelPages(this);
            this.sidebar.add_child(this.pages.actor);
        });

        // IP addresses (sch-net.js PanelIpBox, added once IpView exists)
        this._widget('ip', () => {
            this._ipPanelBin = new St.Bin({x_expand: true});
            this.sidebar.add_child(this._ipPanelBin);
        });

        this._widget('weather', () => {
            this.weather = new WeatherSection(this, () => this._skyView.refresh());
        });
        this._widget('date', () => this._buildDateRow());
        this._widget('calendar', () => this._buildCalendar());
        this.side = new SideCard(this);
        this.swaps = new SettingsSwaps(this);
        this.updates = new SystemUpdates(this);
        this.versionCheck = new VersionCheck(this.settings, this.version);

        // GNOME's "Today" card, above the notifications
        this._widget('today', () => {
            this.today = new TodayCard(this);
            this.sidebar.add_child(this.today.actor);
        });

        this._widget('notifications', () => {
            if (dm._messageList) {
                dm._messageList.x_expand = true;
                dm._messageList.y_expand = true;
                this.adopt(dm._messageList, this.sidebar);
            }
        });

        // World clocks: a card of analogue clocks (the notifications take
        // the free room)
        this._widget('clocks', () => {
            this.worldClocks = new WorldClocksCard(this.settings, () => dm.menu.close());
            // free room above the clocks while an app's menu is shown with the
            // calendar and the clocks under it (tray-menu-fill)
            this.fillSpacer = new St.Widget({y_expand: true, visible: false});
            this.sidebar.add_child(this.fillSpacer);
            this.sidebar.add_child(this.worldClocks.actor);
        });

        this.bottom = new BottomRow(this);
        this.sidebar.add_child(this.bottom.actor);
        this._placeWidgets();

        this._signals.connect(dm.menu, 'open-state-changed', (_m, isOpen) => {
            if (isOpen)
                this._panelOpened();
            else
                this._panelClosed();
        });
        this.geometry.update();
    }

    // A widget: the actors build() adds to the sidebar
    _widget(id, build) {
        const before = new Set(this.sidebar.get_children());
        build();
        this._widgets.set(id, this.sidebar.get_children().filter(child => !before.has(child)));
    }

    _placeWidgets() {
        placeWidgets(this.sidebar, this._widgets, widgetOrder(this.settings));
    }

    // Sky (sun, moon, moon phase) on the left, date on the right
    _buildDateRow() {
        const dm = this.dateMenu;
        const dateRow = new St.BoxLayout({style_class: 'sch-date-row', x_expand: true});
        this.sidebar.add_child(dateRow);
        // the whole row can be switched off (date, sun and moon)
        const syncDate = () => {
            dateRow.visible = this.settings.get_boolean('show-date');
        };
        this.settings.connectObject('changed::show-date', syncDate, dateRow);
        syncDate();
        // the sky follows the city shown in the weather (arrows), or Vesperal
        this._skyView = new SkyView(dm._weatherItem?._weatherClient ?? null, this.settings,
            () => this._skyCoords());
        this._skyButton = new St.Button({
            style_class: 'sch-sky-button',
            child: this._skyView.actor,
            reactive: false,
            accessible_name: _('Sunrise and sunset'),
        });
        this._skyButton.connect('clicked', () => this.openVesperalMenu());
        dateRow.add_child(this._skyButton);
        this.adopt(dm._date, dateRow);
        this._dateAlignOrig = [dm._date?._dayLabel, dm._date?._dateLabel]
            .filter(Boolean)
            .map(label => {
                const orig = {label, x_align: label.x_align};
                label.x_align = Clutter.ActorAlign.END;
                return orig;
            });
    }

    // Collapsible calendar + events
    _buildCalendar() {
        const expander = new St.Button({
            style_class: 'sch-calendar-expander',
            x_expand: true,
            can_focus: true,
        });
        const row = new St.BoxLayout({x_expand: true});
        this.calendarLabel = new St.Label({
            text: _('Calendar and events'),
            style_class: 'sch-calendar-expander-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.add_child(this.calendarLabel);
        this._calendarArrow = new St.Icon({
            icon_name: 'pan-end-symbolic',
            icon_size: 16,
            style_class: 'sch-calendar-expander-arrow',
        });
        row.add_child(this._calendarArrow);
        expander.set_child(row);
        this.sidebar.add_child(expander);

        this.calendarBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-calendar-box',
            x_expand: true,
            visible: false,
        });
        // In a scroll view: with weather open and many events the panel would
        // otherwise grow past the screen and push the bottom row out of view.
        this.calendarScroll = new St.ScrollView({
            style_class: 'sch-calendar-scroll',
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
            visible: false,
            child: this.calendarBox,
        });
        this.sidebar.add_child(this.calendarScroll);
        // Our own calendar (month grid + agenda). GNOME's calendar and events
        // stay hidden in the original menu: GNOME's calendar still requests
        // the events of the month we show.
        this.calendarView = new CalendarView(this.dateMenu, this.settings);
        this.calendarBox.add_child(this.calendarView.actor);

        expander.connect('clicked', () => {
            // our settings beside the panel give the card back first
            this.side.closeHubSettings();
            // an app's menu shown above (tray-menu-fill) stays open: the
            // calendar opens and closes under it, in the panel
            const shown = this.pages.visit;
            if (shown && !shown.side && !this.side.calendarSide && this.settings.get_boolean('tray-menu-fill')) {
                this.setCalendarExpanded(!this.calendarExpanded);
                // Esc and the arrows keep going to the menu
                this.pages.actor.grab_key_focus();
                return;
            }
            // otherwise the page goes first, with its side card
            this.pages.close();
            // with the calendar beside the panel, the row brings it back inside
            if (this.side.calendarSide) {
                this.side.setCalendarSide(false);
                this.setCalendarExpanded(true);
                return;
            }
            this.setCalendarExpanded(!this.calendarExpanded);
        });
    }

    _panelOpened() {
        if (this.settings.get_boolean('calendar-collapsed'))
            this.setCalendarExpanded(false);
        this.side.panelOpened();
        this.tray.sync();
        this.updates.panelOpened();
        this.geometry.update();
        this.calendarView.reloadCalendars();
        this.weather.refresh();
        this._skyView.start();
        // clickable only while Vesperal is there
        this._skyButton.reactive = !!Main.panel.statusArea[VESPERAL_ROLE]?.menu;
        this.worldClocks.start();
    }

    _panelClosed() {
        if (this.resize.panelClosed()) {
            this.geometry.update();
            this.tray.layout();
        }
        this.tray.menuManager.activeMenu?.close();
        this.side.closeHubSettings();
        this.pages.close();
        this._skyView.stop();
        this.worldClocks.stop();
    }

    // Texts set once when the panel is built (translated again after loading
    // the user's translation file)
    _retranslate() {
        this.calendarLabel.text = _('Calendar and events');
        this.bottom.retranslate();
        this.tray.retranslate();
        this.weather.retranslate();
        this.alerts.retranslate();
    }

    // The references to the pieces of the panel, once it is destroyed
    // (by destroy(), or by GNOME Shell at logout)
    _forgetSidebar() {
        this.sidebar = null;
        this.calendarBox = null;
        this.calendarScroll = null;
        this.calendarLabel = null;
        this.fillSpacer = null;
        this._calendarArrow = null;
        this._skyButton = null;
        this._ipPanelBin = null;
        this._widgets.clear();
    }

    _onSettingChanged(key) {
        switch (key) {
        case 'profiles':
        case 'active-profile':
            if (this.sidebar)
                this._placeWidgets();
            break;
        case 'sidebar-side':
            this.side.moveToSide();
            break;
        case 'tray-mode':
        case 'tray-excluded':
            this.tray.sync();
            this._applyTopBarPosition();
            break;
        case 'top-bar-position':
            this._topBarOrganizer.sync();
            this._applyTopBarPosition();
            break;
        case 'sync-top-bar-organizer':
            if (this.settings.get_boolean(key))
                this._topBarOrganizer.sync();
            else
                this._topBarOrganizer.restore();
            this._applyTopBarPosition();
            break;
        case 'vesperal-hide-icon':
        case 'freon-single-icon':
            this._extIcons.sync();
            break;
        case 'sidebar-width':
        case 'sidebar-width-gnome':
            this.geometry.update();
            this.tray.layout();
            break;
        default:
            return;
        }
        this.relayout();
    }

    _applyTopBarPosition() {
        if (this._positioning)
            return;
        // the move adds the clock to a box of the top bar: not a new icon
        // for _watchPanelBoxes
        this._positioning = true;
        try {
            moveClock(this.dateMenu.container, this.settings.get_string('top-bar-position'));
        } finally {
            this._positioning = false;
        }
    }

    // When other extensions add icons, check the tray, the clock
    // position and the icons of Vesperal and Freon again (once per idle)
    _watchPanelBoxes() {
        for (const box of [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox]) {
            this._signals.connect(box, 'child-added', () => {
                if (this._positioning || this.tray.syncing || this._idleId)
                    return;
                this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._idleId = 0;
                    this.tray.sync();
                    this._applyTopBarPosition();
                    this._extIcons.sync();
                    return GLib.SOURCE_REMOVE;
                });
            });
        }
    }

    // Where our sun and moon are computed: Vesperal's place when it is on
    // (the same as its menu), otherwise the city shown in the weather
    _skyCoords() {
        if (Main.panel.statusArea[VESPERAL_ROLE]) {
            this._vesperalSettings ??= vesperalSettings();
            const coords = vesperalCoords(this._vesperalSettings);
            if (coords)
                return coords;
        }
        return this.weather.coords();
    }

    // Same rule GNOME uses for the notification list (DateMenuButton._sessionUpdated)
    _sessionShowsNotifications() {
        return Main.sessionMode.hasNotifications && !Main.sessionMode.isGreeter;
    }
}
