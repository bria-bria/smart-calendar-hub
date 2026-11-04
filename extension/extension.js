// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Smart Calendar Hub: turns the date menu into a side panel.
// Vertical order: tray icons → weather (with the settings button) → date →
// collapsible calendar → notifications → world clocks + Clear.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {_, loadUserTranslations, unloadUserTranslations} from './sch-i18n.js';
import {CalendarView} from './sch-calendar.js';

const TBO_SCHEMA = 'org.gnome.shell.extensions.top-bar-organizer';
const TBO_KEYS = ['left-box-order', 'center-box-order', 'right-box-order'];

// Panel items that must never be moved inside the panel tray.
const ROLES_NEVER_IN_TRAY = new Set([
    'dateMenu',
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

// Items of the right box that are "GNOME menus": the clock goes just before them.
const MENU_TAIL_ROLES = ['EmojisMenu', 'clipboardIndicator', 'quickSettings'];

// Weather section open or closed. Module-level on purpose: it survives
// disable/enable (screen lock) and goes back to closed at the next login.
let weatherExpanded = false;

export default class SmartCalendarHubExtension extends Extension {
    enable() {
        // If a step fails, undo everything done so far instead of leaving the
        // date menu half rebuilt (GNOME does not call disable() after a failed
        // enable(), and it removes our stylesheet).
        try {
            this._enable();
        } catch (e) {
            console.error(`Smart Calendar Hub: enable failed, restoring GNOME: ${e}`);
            try {
                this.disable();
            } catch (e2) {
                console.error(`Smart Calendar Hub: restore failed: ${e2}`);
            }
            throw e;
        }
    }

    _enable() {
        this._dateMenu = Main.panel.statusArea.dateMenu;
        if (!this._dateMenu)
            return;

        this._settings = this.getSettings();
        this._signals = [];
        this._savedParents = [];
        this._movedTrayItems = new Map();
        this._idleId = 0;

        const dmContainer = this._dateMenu.container;
        const dmParent = dmContainer.get_parent();
        this._dateMenuOrigin = dmParent
            ? {parent: dmParent, index: dmParent.get_children().indexOf(dmContainer)}
            : null;

        this._initTopBarOrganizer();
        this._syncTopBarOrganizer();
        this._buildSidebar();
        this._syncTray();
        this._patchBoxPointer();
        this._buildWeatherBadge();
        this._buildAlertDot();
        this._applyTopBarPosition();
        this._watchPanelBoxes();

        this._connect(this._settings, 'changed', (_s, key) => this._onSettingChanged(key));

        // Languages other than Italian/English: load the user's file, then
        // translate again the texts already shown (only if still enabled).
        const token = this._enableToken = {};
        loadUserTranslations()
            .then(() => {
                if (this._enableToken === token)
                    this._applyStaticTexts();
            })
            .catch(e => console.error(`Smart Calendar Hub: translations: ${e}`));
    }

    // Texts set once when the panel is built (translated again after loading
    // the user's translation file).
    _applyStaticTexts() {
        if (this._calendarLabel)
            this._calendarLabel.text = _('Calendar and events');
        if (this._newEventLabel)
            this._newEventLabel.text = _('New event');
        if (this._gearButton)
            this._gearButton.accessible_name = _('Settings');
        if (this._weatherClient)
            this._updateWeatherSummary(this._weatherClient);
        for (const sni of this._alertTray?.keys() ?? [])
            this._rememberTrayApp(sni);
    }

    disable() {
        if (!this._dateMenu)
            return;

        this._enableToken = null;
        unloadUserTranslations();

        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }

        for (const [obj, id] of this._signals ?? []) {
            try {
                obj.disconnect(id);
            } catch (_e) {
                // the object may already be gone
            }
        }
        this._signals = null;

        for (const [source, id] of this._alertSources ?? [])
            source.disconnect(id);
        this._alertSources = null;
        for (const [sni, ids] of this._alertTray ?? [])
            ids.forEach(id => sni.disconnect(id));
        this._alertTray = null;
        this._alertDot?.destroy();
        this._alertTip?.destroy();
        this._alertTip = null;
        this._alertDot = null;

        this._weatherBox?.destroy();
        this._weatherBox = null;
        this._weatherIcon = null;
        this._weatherTemp = null;

        this._restoreAllTrayItems();
        this._movedTrayItems = null;
        this._excludedTray = null;
        this._trayMenuManager = null;

        this._unpatchBoxPointer();

        if (this._dateMenu._messageList)
            this._dateMenu._messageList.visible = this._sessionShowsNotifications();
        this._restoreDateAlign();

        // Put the original widgets back in reverse order: every saved index
        // was taken after the previous widgets had already been removed.
        for (const {actor, parent, index} of (this._savedParents ?? []).reverse()) {
            try {
                actor.get_parent()?.remove_child(actor);
                parent.insert_child_at_index(actor, index);
            } catch (e) {
                console.error(`Smart Calendar Hub: cannot restore a widget: ${e}`);
            }
        }
        this._savedParents = null;

        // Undo the bottom-row tweaks after the widgets are back in place.
        if (this._clearButton) {
            this._clearButton.remove_style_class_name('sch-clear-button');
            Object.assign(this._clearButton, this._clearOrig);
            this._clearButton = null;
            this._clearOrig = null;
        }
        if (this._clocksOrig) {
            Object.assign(this._dateMenu._clocksItem, this._clocksOrig);
            this._clocksOrig = null;
        }
        this._bottomRow = null;

        // Before the panel goes: it is connected to GNOME's calendar and events
        this._calendarView?.destroy();
        this._sidebar?.destroy();
        this._sidebar = null;
        this._traySection = null;
        this._trayBox = null;
        this._calendarBox = null;
        this._calendarScroll = null;
        this._calendarView = null;
        this._newEventButton = null;
        this._newEventLabel = null;
        this._calendarArrow = null;
        this._weatherBody = null;
        this._weatherArrow = null;
        this._weatherSummary = null;
        this._weatherClient = null;
        this._calendarLabel = null;
        this._gearButton = null;

        this._origBin?.show();
        this._origBin = null;

        this._restoreTopBarOrganizer();
        this._tbo = null;

        const container = this._dateMenu.container;
        const origin = this._dateMenuOrigin;
        if (origin && container.get_parent() !== origin.parent) {
            container.get_parent()?.remove_child(container);
            origin.parent.insert_child_at_index(container, origin.index);
        }
        this._dateMenuOrigin = null;

        this._settings = null;
        this._dateMenu = null;
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    _connect(obj, signal, callback) {
        this._signals.push([obj, obj.connect(signal, callback)]);
    }

    _relayout() {
        this._dateMenu?.menu?._boxPointer?.queue_relayout();
    }

    _onSettingChanged(key) {
        switch (key) {
        case 'tray-mode':
        case 'tray-excluded':
            this._syncTray();
            this._applyTopBarPosition();
            break;
        case 'top-bar-position':
            this._syncTopBarOrganizer();
            this._applyTopBarPosition();
            break;
        case 'sync-top-bar-organizer':
            if (this._settings.get_boolean(key))
                this._syncTopBarOrganizer();
            else
                this._restoreTopBarOrganizer();
            this._applyTopBarPosition();
            break;
        case 'alert-apps':
            this._updateAlertDot();
            break;
        case 'sidebar-width':
            this._calendarView?.setWidth(this._settings.get_int(key));
            this._updateSidebarSize();
            this._layoutTray();
            break;
        }
        this._relayout();
    }

    // Moves a date-menu widget into the panel, remembering where it was.
    _adopt(actor, newParent) {
        if (!actor)
            return;
        const parent = actor.get_parent();
        if (parent) {
            this._savedParents.push({actor, parent, index: parent.get_children().indexOf(actor)});
            parent.remove_child(actor);
        }
        newParent.add_child(actor);
    }

    // ------------------------------------------------------------------
    // Top Bar Organizer (optional, off by default)
    // ------------------------------------------------------------------

    _initTopBarOrganizer() {
        this._tbo = null;
        this._tboOrig = undefined; // undefined = clock position not saved yet
        const schema = Gio.SettingsSchemaSource.get_default()?.lookup(TBO_SCHEMA, true);
        if (schema)
            this._tbo = new Gio.Settings({settings_schema: schema});
    }

    // Reads the three TBO lists without 'dateMenu' and tells where it was.
    _readTopBarOrganizer() {
        const lists = {};
        let where = null;
        for (const key of TBO_KEYS) {
            const list = this._tbo.get_strv(key);
            const i = list.indexOf('dateMenu');
            if (i !== -1 && !where)
                where = {key, index: i};
            lists[key] = list.filter(x => x !== 'dateMenu');
        }
        return {lists, where};
    }

    // Writes only the lists that actually changed (no needless dconf writes).
    _writeTopBarOrganizer(lists) {
        for (const key of TBO_KEYS) {
            const old = this._tbo.get_strv(key);
            if (old.length !== lists[key].length || old.some((x, i) => x !== lists[key][i]))
                this._tbo.set_strv(key, lists[key]);
        }
    }

    // Called only on enable and when a related setting changes, never on
    // panel changes: TBO reorders the panel when its settings change.
    _syncTopBarOrganizer() {
        if (!this._tbo || !this._settings.get_boolean('sync-top-bar-organizer'))
            return;
        try {
            const {lists, where} = this._readTopBarOrganizer();
            // Remember only where the clock was, so on restore the entries
            // TBO added in the meantime are kept.
            if (this._tboOrig === undefined)
                this._tboOrig = where;

            const mode = this._settings.get_string('top-bar-position');
            const left = lists['left-box-order'];
            const center = lists['center-box-order'];
            const right = lists['right-box-order'];
            if (mode === 'right-between-tray-and-menu') {
                let i = right.findIndex(r => MENU_TAIL_ROLES.includes(r));
                if (i === -1)
                    i = right.length;
                right.splice(i, 0, 'dateMenu');
            } else if (mode === 'right-before-tray') {
                right.unshift('dateMenu');
            } else if (mode === 'left-after-menu') {
                left.push('dateMenu');
            } else {
                center.splice(Math.min(1, center.length), 0, 'dateMenu');
            }
            this._writeTopBarOrganizer(lists);
        } catch (e) {
            console.error(`Smart Calendar Hub: Top Bar Organizer sync failed: ${e}`);
        }
    }

    _restoreTopBarOrganizer() {
        if (!this._tbo || this._tboOrig === undefined)
            return;
        try {
            const {lists} = this._readTopBarOrganizer();
            const where = this._tboOrig;
            if (where) {
                const list = lists[where.key];
                list.splice(Math.min(where.index, list.length), 0, 'dateMenu');
            }
            this._writeTopBarOrganizer(lists);
        } catch (e) {
            console.error(`Smart Calendar Hub: Top Bar Organizer restore failed: ${e}`);
        }
        this._tboOrig = undefined;
    }

    // ------------------------------------------------------------------
    // Clock position in the top bar
    // ------------------------------------------------------------------

    _applyTopBarPosition() {
        const container = this._dateMenu?.container;
        if (!container || this._positioning)
            return;

        const mode = this._settings.get_string('top-bar-position');
        this._positioning = true;
        try {
            let box, index;
            if (mode === 'right-between-tray-and-menu') {
                box = Main.panel._rightBox;
                const tails = MENU_TAIL_ROLES
                    .map(r => Main.panel.statusArea[r]?.container)
                    .filter(Boolean);
                const children = box.get_children().filter(c => c !== container);
                index = children.findIndex(c => tails.includes(c));
                if (index === -1)
                    index = children.length;
            } else if (mode === 'right-before-tray') {
                box = Main.panel._rightBox;
                index = 0;
            } else if (mode === 'left-after-menu') {
                box = Main.panel._leftBox;
                index = box.get_children().filter(c => c !== container).length;
            } else {
                box = Main.panel._centerBox;
                index = 0;
            }

            const parent = container.get_parent();
            if (parent !== box) {
                parent?.remove_child(container);
                box.insert_child_at_index(container, index);
            } else if (box.get_children().indexOf(container) !== index) {
                box.set_child_at_index(container, index);
            }
        } catch (e) {
            console.error(`Smart Calendar Hub: cannot move the clock: ${e}`);
        } finally {
            this._positioning = false;
        }
    }

    // When other extensions add icons, re-check tray and clock position (once per idle).
    _watchPanelBoxes() {
        for (const box of [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox]) {
            this._connect(box, 'child-added', () => {
                if (this._positioning || this._syncingTray || this._idleId)
                    return;
                this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._idleId = 0;
                    this._syncTray();
                    this._applyTopBarPosition();
                    return GLib.SOURCE_REMOVE;
                });
            });
        }
    }

    // ------------------------------------------------------------------
    // Red dot next to the clock for notifications of the chosen apps
    // ------------------------------------------------------------------

    _buildAlertDot() {
        const clock = this._dateMenu._clockDisplay;
        const clockBox = clock?.get_parent();
        this._alertSources = new Map();
        this._alertTray = new Map();
        if (!clockBox)
            return;

        this._alertDot = new St.Widget({
            style_class: 'sch-alert-dot',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        // on the left of the time
        clockBox.insert_child_below(this._alertDot, clock);
        // Another extension may destroy the box we live in (see the weather badge).
        this._alertDot.connect('destroy', () => {
            this._alertDot = null;
        });

        this._connect(Main.messageTray, 'source-added', (_t, source) => this._watchSource(source));
        this._connect(Main.messageTray, 'source-removed', (_t, source) => {
            const id = this._alertSources.get(source);
            if (id)
                source.disconnect(id);
            this._alertSources.delete(source);
            this._updateAlertDot();
        });
        for (const source of Main.messageTray.getSources())
            this._watchSource(source);
        this._buildAlertTip();
        this._syncTrayAlerts();
    }

    // Stable identifier of the app behind a notification source.
    _sourceKey(source) {
        return source.app?.get_id?.() || source.title || '';
    }

    _watchSource(source) {
        if (this._alertSources.has(source))
            return;
        this._alertSources.set(source, source.connect('notify::count', () => {
            this._rememberSource(source);
            this._updateAlertDot();
        }));
        this._rememberSource(source);
        this._updateAlertDot();
    }

    // Adds the app to the list shown in the preferences (kept across sessions).
    _rememberSource(source) {
        const key = this._sourceKey(source);
        if (key)
            this._rememberApp(key, source.title || key);
    }

    _rememberApp(key, rawLabel) {
        const label = rawLabel.replace(/[\t\n]/g, ' ');
        const line = `${key}\t${label}`;
        const seen = this._settings.get_strv('notify-apps-seen');
        if (seen.includes(line))
            return;
        const list = seen.filter(l => !l.startsWith(`${key}\t`));
        list.push(line);
        list.sort();
        // Keep at most 150 entries, but never drop an app switched on for the dot.
        const chosen = new Set(this._settings.get_strv('alert-apps'));
        let extra = list.length - 150;
        const kept = list.filter(l => {
            if (extra > 0 && !chosen.has(l.slice(0, l.indexOf('\t')))) {
                extra--;
                return false;
            }
            return true;
        });
        this._settings.set_strv('notify-apps-seen', kept);
    }

    // Names of the chosen apps that are alerting right now (no duplicates).
    _alertingApps() {
        const wanted = new Set(this._settings.get_strv('alert-apps'));
        const names = new Set();
        for (const s of this._alertSources?.keys() ?? []) {
            if (s.count > 0 && wanted.has(this._sourceKey(s)))
                names.add(s.title || this._sourceKey(s));
        }
        for (const sni of this._alertTray?.keys() ?? []) {
            if (wanted.has(`tray:${sni.id}`) && this._trayIsAlerting(sni))
                names.add(sni.title || sni.id);
        }
        return [...names];
    }

    _updateAlertDot() {
        if (!this._alertDot)
            return;
        const apps = this._alertingApps();
        this._alertDot.visible = apps.length > 0;
        if (this._alertTip?.visible)
            this._showAlertTip();
    }

    // Label under the clock, while the pointer is on it and the dot is on,
    // telling which apps the dot is about.
    _buildAlertTip() {
        // Not reactive, on top of everything (raised again when shown)
        this._alertTip = new St.Label({style_class: 'sch-alert-tip', visible: false, reactive: false});
        Main.uiGroup.add_child(this._alertTip);
        this._connect(this._dateMenu, 'notify::hover', () => {
            if (this._dateMenu.hover && this._alertDot?.visible && !this._dateMenu.menu.isOpen)
                this._showAlertTip();
            else
                this._alertTip.hide();
        });
        this._connect(this._dateMenu.menu, 'open-state-changed', () => this._alertTip.hide());
    }

    _showAlertTip() {
        const apps = this._alertingApps();
        if (!apps.length) {
            this._alertTip.hide();
            return;
        }
        this._alertTip.text = _('Notifications from: {apps}', {apps: apps.join(', ')});
        Main.uiGroup.set_child_above_sibling(this._alertTip, null);
        this._alertTip.show();
        // Under the clock, kept inside its monitor
        const button = this._dateMenu;
        const [bx, by] = button.get_transformed_position();
        const [bw, bh] = button.get_transformed_size();
        const monitor = Main.layoutManager.findMonitorForActor(button) ?? Main.layoutManager.primaryMonitor;
        const [, natWidth] = this._alertTip.get_preferred_width(-1);
        const x = Math.min(Math.max(bx + (bw - natWidth) / 2, monitor.x + 4),
            monitor.x + monitor.width - natWidth - 4);
        this._alertTip.set_position(Math.floor(x), Math.floor(by + bh + 6));
    }

    // Tray icons (AppIndicator) can also ask for attention: either with the
    // NeedsAttention status, or, like Telegram, by switching to an icon whose
    // name says so. Apps that only draw a badge inside the image cannot be read.
    _trayIsAlerting(sni) {
        return sni.status === 'NeedsAttention' ||
            /attention|unread|updates-available/i.test(sni.icon?.name ?? '');
    }

    // Follows every AppIndicator icon (wherever it is) for the red dot.
    _syncTrayAlerts() {
        if (!this._alertTray)
            return;
        for (const indicator of Object.values(Main.panel.statusArea)) {
            const sni = indicator?._indicator;
            if (!sni?.id || this._alertTray.has(sni) || typeof sni.connect !== 'function')
                continue;
            const update = () => this._updateAlertDot();
            const ids = [
                sni.connect('icon', update),
                sni.connect('status', update),
                sni.connect('destroy', () => {
                    this._alertTray?.delete(sni);
                    this._updateAlertDot();
                }),
            ];
            this._alertTray.set(sni, ids);
            this._rememberTrayApp(sni);
        }
        this._updateAlertDot();
    }

    _rememberTrayApp(sni) {
        this._rememberApp(`tray:${sni.id}`, _('{app} (tray icon)', {app: sni.title || sni.id}));
    }

    // ------------------------------------------------------------------
    // Temperature next to the clock
    // ------------------------------------------------------------------

    _buildWeatherBadge() {
        const dm = this._dateMenu;
        const clockBox = dm._clockDisplay?.get_parent();
        const client = dm._weatherItem?._weatherClient;
        if (!clockBox || !client)
            return;

        this._weatherIcon = new St.Icon({
            style_class: 'sch-panel-weather-icon system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._weatherTemp = new St.Label({
            style_class: 'sch-panel-weather-temp',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._weatherBox = new St.BoxLayout({
            style_class: 'sch-panel-weather-box',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._weatherBox.add_child(this._weatherIcon);
        this._weatherBox.add_child(this._weatherTemp);
        clockBox.add_child(this._weatherBox);
        // Another extension may destroy the box we live in (Weather O'Clock
        // wraps the clock in its own box and destroys it when turned off).
        this._weatherBox.connect('destroy', () => {
            this._weatherBox = null;
            this._weatherIcon = null;
            this._weatherTemp = null;
        });

        const isWeather = actor => (actor.style_class ?? '').includes('weather');

        const update = () => {
            if (!this._weatherBox)
                return;
            // Another extension already shows the weather next to the clock:
            // either it wrapped the clock in its own box (Weather O'Clock
            // loaded after us) or a weather widget sits beside the clock.
            const other = dm._clockDisplay.get_parent() !== clockBox ||
                clockBox.get_children().some(ch => ch !== this._weatherBox &&
                    (isWeather(ch) || ch.get_children().some(isWeather)));
            const info = client.info;
            const [ok, temp] = info?.is_valid()
                ? info.get_value_temp(GWeather.TemperatureUnit.DEFAULT)
                : [false, 0];
            if (other || !client.hasLocation || !ok || !Number.isFinite(temp)) {
                this._weatherBox.visible = false;
                return;
            }
            this._weatherIcon.icon_name = info.get_symbolic_icon_name() || 'weather-clear-symbolic';
            this._weatherTemp.text = `${Math.round(temp)}°`;
            this._weatherBox.visible = true;
        };

        this._connect(client, 'changed', update);
        this._connect(clockBox, 'child-added', update);
        this._connect(clockBox, 'child-removed', update);
        update();
    }

    // ------------------------------------------------------------------
    // Side panel layout
    // ------------------------------------------------------------------

    _buildSidebar() {
        const dm = this._dateMenu;
        const menuBox = dm.menu.box;

        this._origBin = menuBox.get_first_child();
        this._origBin?.hide();

        this._sidebar = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-sidebar-box',
            x_expand: true,
            y_expand: true,
        });
        menuBox.add_child(this._sidebar);
        this._trayMenuManager = new PopupMenu.PopupMenuManager(this._sidebar);

        // 0. Tray icons
        this._traySection = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-tray-section',
            x_expand: true,
            visible: false,
        });
        // Rows of icons laid out by _layoutTray(). Clutter.FlowLayout is not
        // used: on GNOME 51 it gives panel buttons a height of 0.
        this._trayBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-tray-box',
            x_expand: true,
        });
        this._traySection.add_child(this._trayBox);
        this._sidebar.add_child(this._traySection);

        // 1. Weather, collapsible; the settings button sits on the same row
        // (no title row, to save space).
        const weatherRow = new St.BoxLayout({style_class: 'sch-weather-row', x_expand: true});
        this._sidebar.add_child(weatherRow);

        const weatherExpander = new St.Button({
            style_class: 'sch-calendar-expander sch-weather-expander',
            x_expand: true,
            can_focus: true,
            visible: !!dm._weatherItem,
        });
        const weatherLine = new St.BoxLayout({x_expand: true});
        this._weatherSummary = new St.Label({
            text: _('Weather'),
            style_class: 'sch-calendar-expander-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        weatherLine.add_child(this._weatherSummary);
        this._weatherArrow = new St.Icon({
            icon_name: 'pan-end-symbolic',
            icon_size: 16,
            style_class: 'sch-calendar-expander-arrow',
        });
        weatherLine.add_child(this._weatherArrow);
        weatherExpander.set_child(weatherLine);
        weatherRow.add_child(weatherExpander);

        const gear = this._gearButton = new St.Button({
            style_class: 'sch-gear-button',
            can_focus: true,
            accessible_name: _('Settings'),
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 16}),
        });
        weatherRow.add_child(gear);
        gear.connect('clicked', () => {
            dm.menu.close();
            this.openPreferences();
        });

        this._weatherBody = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._sidebar.add_child(this._weatherBody);
        this._adopt(dm._weatherItem, this._weatherBody);
        weatherExpander.connect('clicked', () => {
            weatherExpanded = !weatherExpanded;
            this._syncWeatherExpanded();
        });
        this._syncWeatherExpanded();

        const client = this._weatherClient = dm._weatherItem?._weatherClient;
        if (client) {
            this._connect(client, 'changed', () => this._updateWeatherSummary(client));
            this._updateWeatherSummary(client);
        }

        // 2. Date, aligned on the right
        this._adopt(dm._date, this._sidebar);
        this._dateAlignOrig = [dm._date?._dayLabel, dm._date?._dateLabel]
            .filter(Boolean)
            .map(label => {
                const orig = {label, x_align: label.x_align};
                label.x_align = Clutter.ActorAlign.END;
                return orig;
            });

        // 3. Collapsible calendar + events
        const expander = new St.Button({
            style_class: 'sch-calendar-expander',
            x_expand: true,
            can_focus: true,
        });
        const row = new St.BoxLayout({x_expand: true});
        this._calendarLabel = new St.Label({
            text: _('Calendar and events'),
            style_class: 'sch-calendar-expander-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.add_child(this._calendarLabel);
        this._calendarArrow = new St.Icon({
            icon_name: 'pan-end-symbolic',
            icon_size: 16,
            style_class: 'sch-calendar-expander-arrow',
        });
        row.add_child(this._calendarArrow);
        expander.set_child(row);
        this._sidebar.add_child(expander);

        this._calendarBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-calendar-box',
            x_expand: true,
            visible: false,
        });
        // In a scroll view: with weather open and many events the panel would
        // otherwise grow past the screen and push the bottom row out of view.
        this._calendarScroll = new St.ScrollView({
            style_class: 'sch-calendar-scroll',
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
            visible: false,
            child: this._calendarBox,
        });
        this._sidebar.add_child(this._calendarScroll);
        // Our own calendar (month grid + agenda). GNOME's calendar and events
        // stay hidden in the original menu: GNOME's calendar still requests
        // the events of the month we show.
        this._calendarView = new CalendarView(dm, this._settings);
        this._calendarBox.add_child(this._calendarView.actor);

        expander.connect('clicked', () => this._setCalendarExpanded(!this._calendarBox.visible));

        this._connect(dm.menu, 'open-state-changed', (_m, isOpen) => {
            if (isOpen) {
                if (this._settings.get_boolean('calendar-collapsed'))
                    this._setCalendarExpanded(false);
                this._syncTray();
                this._updateSidebarSize();
                this._calendarView?.reloadCalendars();
            } else {
                this._trayMenuManager?.activeMenu?.close();
            }
        });

        // 4. Notifications
        if (dm._messageList) {
            dm._messageList.x_expand = true;
            dm._messageList.y_expand = true;
            this._adopt(dm._messageList, this._sidebar);
        }

        // 5. Bottom row: world clocks (3/5) + "Clear" of the notifications (2/5)
        this._bottomRow = new St.BoxLayout({style_class: 'sch-bottom-row', x_expand: true});
        this._sidebar.add_child(this._bottomRow);
        if (dm._clocksItem) {
            this._clocksOrig = {x_expand: dm._clocksItem.x_expand, visible: dm._clocksItem.visible};
            dm._clocksItem.x_expand = true;
            this._adopt(dm._clocksItem, this._bottomRow);
        }
        // With the calendar open, "New event" (GNOME Calendar) takes the
        // place of the world clocks.
        this._newEventButton = new St.Button({
            style_class: 'sch-new-event',
            x_expand: true,
            can_focus: true,
            visible: false,
        });
        const newEventLine = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
        newEventLine.add_child(new St.Icon({icon_name: 'list-add-symbolic', icon_size: 16}));
        this._newEventLabel = new St.Label({text: _('New event'), y_align: Clutter.ActorAlign.CENTER});
        newEventLine.add_child(this._newEventLabel);
        this._newEventButton.set_child(newEventLine);
        this._newEventButton.connect('clicked', () => {
            dm.menu.close();
            this._calendarView?.openNewEvent();
        });
        this._bottomRow.insert_child_at_index(this._newEventButton, 0);
        const clear = dm._messageList?._clearButton;
        if (clear) {
            this._clearButton = clear;
            // width -1 = back to its natural width
            this._clearOrig = {x_expand: clear.x_expand, x_align: clear.x_align, width: -1};
            clear.x_expand = false;
            clear.x_align = Clutter.ActorAlign.FILL;
            clear.add_style_class_name('sch-clear-button');
            this._adopt(clear, this._bottomRow);
        }

        this._updateSidebarSize();
    }

    // Same rule GNOME uses for the notification list (DateMenuButton._sessionUpdated)
    _sessionShowsNotifications() {
        return Main.sessionMode.hasNotifications && !Main.sessionMode.isGreeter;
    }

    _restoreDateAlign() {
        for (const {label, x_align} of this._dateAlignOrig ?? [])
            label.x_align = x_align;
        this._dateAlignOrig = null;
    }

    _syncWeatherExpanded() {
        if (!this._weatherBody)
            return;
        this._weatherBody.visible = weatherExpanded;
        this._weatherArrow.icon_name = weatherExpanded ? 'pan-down-symbolic' : 'pan-end-symbolic';
        this._relayout();
    }

    // "Weather · 10° Brescia" on the collapsed row.
    _updateWeatherSummary(client) {
        if (!this._weatherSummary)
            return;
        let text = _('Weather');
        const info = client.info;
        if (client.hasLocation && info?.is_valid()) {
            const [ok, temp] = info.get_value_temp(GWeather.TemperatureUnit.DEFAULT);
            const place = info.get_location_name() ?? '';
            if (ok && Number.isFinite(temp))
                text = _('Weather · {temp}° {place}', {temp: Math.round(temp), place}).trim();
        }
        this._weatherSummary.text = text;
    }

    _setCalendarExpanded(expanded) {
        if (!this._calendarBox)
            return;
        this._calendarScroll.visible = expanded;
        this._calendarBox.visible = expanded;
        // The calendar takes the place of the notifications while it is open
        if (this._dateMenu._messageList)
            this._dateMenu._messageList.visible = !expanded && this._sessionShowsNotifications();
        this._calendarArrow.icon_name = expanded ? 'pan-down-symbolic' : 'pan-end-symbolic';
        const newEvent = expanded && this._calendarView?.hasCalendarApp;
        if (this._newEventButton)
            this._newEventButton.visible = !!newEvent;
        if (this._clocksOrig)
            this._dateMenu._clocksItem.visible = !newEvent;
        this._relayout();
    }

    _updateSidebarSize() {
        if (!this._sidebar)
            return;
        const monitor = Main.layoutManager.findIndexForActor(this._dateMenu.container);
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor);
        this._sidebar.width = this._settings.get_int('sidebar-width');
        // Fill the work area, but never be taller than it: 4 px gap at the
        // top plus the popup padding and border (about 24 px) and a margin.
        this._sidebar.height = Math.max(0, workArea.height - 40);
        // "Clear" takes 2/5 of the bottom row (sidebar padding ≈ 4 px,
        // margins and spacing ≈ 14 px); the world clocks fill the rest.
        if (this._clearButton)
            this._clearButton.width = Math.round((this._sidebar.width - 18) * 2 / 5);
    }

    // ------------------------------------------------------------------
    // Side panel position (patches the date menu BoxPointer)
    // ------------------------------------------------------------------

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

    // ------------------------------------------------------------------
    // Tray icons inside the panel
    // ------------------------------------------------------------------

    // Stable identifier of an icon, kept across sessions: the app id for
    // AppIndicator icons (the panel role of some apps changes every login),
    // the window class for legacy tray icons, otherwise the panel role.
    _trayKey(role, indicator) {
        return indicator._indicator?.id || indicator._icon?.wm_class || role;
    }

    _trayLabel(role, indicator) {
        const sni = indicator._indicator;
        // title first: the accessible name often contains unread counts,
        // which would rewrite the list at every new message
        return sni?.title || sni?.accessibleName || sni?.id ||
            indicator._icon?.title || indicator._icon?.wm_class ||
            indicator.accessible_name || role;
    }

    _wantsInTray(role, indicator) {
        return this._isTrayCandidate(role, indicator) &&
            !this._excludedTray.has(this._trayKey(role, indicator));
    }

    // Writes the icons that can be moved, for the preferences window
    // (only when the list changed, to avoid needless dconf writes).
    _publishTrayItems() {
        // With the tray turned off nothing is a candidate: keep the last list,
        // so the preferences show it greyed out instead of empty.
        if (this._settings.get_string('tray-mode') === 'disabled')
            return;
        const items = new Map();
        for (const [role, indicator] of Object.entries(Main.panel.statusArea)) {
            if (this._isTrayCandidate(role, indicator)) {
                const label = this._trayLabel(role, indicator).replace(/[\t\n]/g, ' ');
                items.set(this._trayKey(role, indicator), label);
            }
        }
        const list = [...items].map(([k, l]) => `${k}\t${l}`).sort();
        const old = this._settings.get_strv('tray-items-seen');
        if (old.length !== list.length || old.some((x, i) => x !== list[i]))
            this._settings.set_strv('tray-items-seen', list);
    }

    _isTrayCandidate(role, indicator) {
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
        return isTray || this._movedTrayItems.has(indicator) ||
            indicator.container.get_parent() === Main.panel._rightBox;
    }

    _syncTray() {
        if (!this._trayBox || this._syncingTray)
            return;
        this._syncingTray = true;
        this._excludedTray = new Set(this._settings.get_strv('tray-excluded'));
        try {
            for (const [indicator, info] of [...this._movedTrayItems]) {
                if (info.container.get_parent()?.get_parent() !== this._trayBox) {
                    // Another extension (e.g. Top Bar Organizer, which re-sorts
                    // every icon whenever one is added) took it back to the
                    // top bar: forget it, the loop below moves it in again.
                    this._releaseTrayItem(indicator, info);
                    this._movedTrayItems.delete(indicator);
                } else if (!this._wantsInTray(info.role, indicator)) {
                    this._restoreTrayItem(indicator, info);
                    this._movedTrayItems.delete(indicator);
                }
            }
            for (const [role, indicator] of Object.entries(Main.panel.statusArea)) {
                if (!this._movedTrayItems.has(indicator) && this._wantsInTray(role, indicator))
                    this._moveToTray(role, indicator);
            }
            this._publishTrayItems();
        } catch (e) {
            console.error(`Smart Calendar Hub: tray sync failed: ${e}`);
        } finally {
            this._syncingTray = false;
        }
        this._layoutTray();
        this._syncTrayAlerts();
    }

    // Puts the moved icons in rows that fit the panel width.
    _layoutTray() {
        if (!this._trayBox)
            return;
        // panel padding + section padding/margins ≈ 48 px; one icon ≈ 34 px
        const perRow = Math.max(1,
            Math.floor((this._settings.get_int('sidebar-width') - 48) / 34));
        const containers = [...this._movedTrayItems.values()].map(i => i.container);
        this._traySection.visible = containers.length > 0;

        // Nothing to do if the rows already match (avoids re-mapping every icon,
        // which makes AppIndicator reload them).
        const rows = this._trayBox.get_children();
        const current = rows.flatMap(r => r.get_children());
        if (current.length === containers.length &&
            current.every((c, i) => c === containers[i]) &&
            rows.every((r, i) => r.get_n_children() ===
                Math.min(perRow, containers.length - i * perRow)))
            return;

        for (const row of rows) {
            for (const child of row.get_children())
                row.remove_child(child);
        }
        this._trayBox.destroy_all_children();

        let row = null;
        containers.forEach((container, i) => {
            if (i % perRow === 0) {
                // packed on the right, not spread over the row
                row = new St.BoxLayout({
                    style_class: 'sch-tray-row',
                    x_expand: false,
                    x_align: Clutter.ActorAlign.END,
                });
                this._trayBox.add_child(row);
            }
            container.get_parent()?.remove_child(container);
            row.add_child(container);
        });
        this._traySection.visible = containers.length > 0;
    }

    _moveToTray(role, indicator) {
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
            menuId: 0,
            destroyId: 0,
        };

        const menu = indicator.menu;
        if (menu && typeof menu.connect === 'function') {
            // removeMenu() never fails, so check first whether the panel owns it
            info.hadPanelMenu = Main.panel.menuManager._menus?.includes(menu) ?? false;
            if (info.hadPanelMenu)
                Main.panel.menuManager.removeMenu(menu);
            this._trayMenuManager.addMenu(menu);
            info.menuId = menu.connect('open-state-changed', (m, isOpen) => {
                if (isOpen && m.actor)
                    Main.uiGroup.set_child_above_sibling(m.actor, null);
            });
        }

        // _layoutTray() puts it in a row
        parent.remove_child(container);
        container.add_style_class_name('sch-tray-item');
        container.y_expand = false;
        container.x_expand = false;

        // The empty slot is filled at the next layout (next time the panel opens).
        info.destroyId = container.connect('destroy', () => {
            this._movedTrayItems?.delete(indicator);
            if (this._traySection)
                this._traySection.visible = this._movedTrayItems.size > 0;
        });
        this._movedTrayItems.set(indicator, info);
    }

    // Undoes everything _moveToTray did except the position of the container.
    _releaseTrayItem(indicator, info) {
        info.container.disconnect(info.destroyId);
        const menu = indicator.menu;
        if (menu && info.menuId) {
            menu.disconnect(info.menuId);
            this._trayMenuManager?.removeMenu(menu);
            if (info.hadPanelMenu)
                Main.panel.menuManager.addMenu(menu);
        }
        info.container.remove_style_class_name('sch-tray-item');
        info.container.y_expand = info.yExpand;
        info.container.x_expand = info.xExpand;
    }

    _restoreTrayItem(indicator, info) {
        try {
            this._releaseTrayItem(indicator, info);
            info.container.get_parent()?.remove_child(info.container);
            const n = info.parent.get_n_children();
            info.parent.insert_child_at_index(info.container, Math.min(info.index, n));
        } catch (e) {
            console.error(`Smart Calendar Hub: cannot restore a tray icon: ${e}`);
        }
    }

    _restoreAllTrayItems() {
        if (!this._movedTrayItems)
            return;
        // Reverse order, so saved indices are still valid.
        for (const [indicator, info] of [...this._movedTrayItems].reverse())
            this._restoreTrayItem(indicator, info);
        this._movedTrayItems.clear();
    }
}
