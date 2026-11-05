// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// Smart Calendar Hub: turns the date menu into a side panel.
// Vertical order: tray icons → weather (with the settings button) → date →
// collapsible calendar → notifications → world clocks + Clear.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import GWeather from 'gi://GWeather';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {_, loadUserTranslations, unloadUserTranslations} from './sch-i18n.js';
import {CalendarView} from './sch-calendar.js';
import {SkyView} from './sch-sky.js';
import {IP_ROLE, IpView, PanelIpBox} from './sch-net.js';
import {CityWeather, buildForecast} from './sch-weather.js';

const TBO_SCHEMA = 'org.gnome.shell.extensions.top-bar-organizer';
// An icon counts as "normal" for an app only after being shown this long
const NORMAL_ICON_MIN_SECONDS = 600;
const TBO_KEYS = ['left-box-order', 'center-box-order', 'right-box-order'];

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
        this._ipView = new IpView(this._settings);
        // IP addresses in the side panel, under the tray (if switched on)
        this._ipPanel = new PanelIpBox(this._ipView, this._settings);
        this._ipPanelBin.set_child(this._ipPanel.actor);

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

        // First, so its panel role is freed even if a later step fails
        try {
            this._ipPanel?.destroy();
            this._ipPanel = null;
            this._ipView?.destroy();
        } catch (e) {
            console.error(`Smart Calendar Hub: cannot remove the IP indicator: ${e}`);
        }
        this._ipView = null;

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

        const safeDisconnect = (obj, id) => {
            try {
                obj.disconnect(id);
            } catch (_e) {
                // already destroyed
            }
        };
        for (const [source, ids] of this._alertSources ?? [])
            ids.forEach(id => safeDisconnect(source, id));
        this._alertSources = null;
        for (const source of [...this._bannerPolicies?.keys() ?? []])
            this._releaseBanners(source);
        this._bannerPolicies = null;
        this._unpatchNotificationMessages();
        for (const [sni, ids] of this._alertTray ?? []) {
            this._accountTrayIcon(sni); // last stretch of time of its icon
            ids.forEach(id => safeDisconnect(sni, id));
        }
        if (this._iconSaveId) {
            GLib.source_remove(this._iconSaveId);
            this._iconSaveId = 0;
        }
        this._saveIconStats();
        this._alertTray = null;
        this._iconStats = null;
        this._iconShown = null;
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
        try {
            this._setBottomCompact(false); // texts back on GNOME's buttons
        } catch (e) {
            console.error(`Smart Calendar Hub: cannot restore the bottom buttons: ${e}`);
        }
        if (this._clearButton) {
            this._clearButton.remove_style_class_name('sch-clear-button');
            this._clearButton.remove_style_class_name('sch-bottom-btn');
            Object.assign(this._clearButton, this._clearOrig);
            this._clearButton = null;
            this._clearOrig = null;
        }
        if (this._clocksOrig) {
            this._dateMenu._clocksItem.remove_style_class_name('sch-bottom-btn');
            Object.assign(this._dateMenu._clocksItem, this._clocksOrig);
            this._clocksOrig = null;
        }
        this._bottomRow = null;
        this._clearBox = null;
        this._clearLabel = null;
        this._clocksGrid = null;

        // Before the panel goes: it is connected to GNOME's calendar and events
        this._calendarView?.destroy();
        this._skyView?.destroy();
        this._skyView = null;
        this._sidebar?.destroy();
        this._sidebar = null;
        this._traySection = null;
        this._ipPanelBin = null;
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
        this._weatherSummaryIcon = null;
        this._cityWeather?.destroy();
        this._cityWeather = null;
        this._citySelector = null;
        this._cityDots = null;
        this._cityCard = null;
        this._gnomeWeatherBin = null;
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
        case 'muted-apps':
            this._mutedCache = null;
            this._updateAlertDot();
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

        // Always in place (transparent when off): showing and hiding it
        // would move the clock and the widgets next to it.
        this._alertDot = new St.Widget({
            style_class: 'sch-alert-dot',
            y_align: Clutter.ActorAlign.CENTER,
            opacity: 0,
        });
        this._alertDotOn = false;
        // on the left of the time
        clockBox.insert_child_below(this._alertDot, clock);
        // Another extension may destroy the box we live in (see the weather badge).
        this._alertDot.connect('destroy', () => {
            this._alertDot = null;
        });

        this._connect(Main.messageTray, 'source-added', (_t, source) => this._watchSource(source));
        this._connect(Main.messageTray, 'source-removed', (_t, source) => {
            this._alertSources.get(source)?.forEach(id => source.disconnect(id));
            this._alertSources.delete(source);
            this._releaseBanners(source);
            this._updateAlertDot();
        });
        for (const source of Main.messageTray.getSources())
            this._watchSource(source);
        this._patchNotificationMessages();
        this._buildAlertTip();
        this._syncTrayAlerts();
    }

    // ------------------------------------------------------------------
    // Silencing apps: no banner, no red dot, notifications kept in the list.
    // muted-apps: "key TAB name TAB until" (until = Unix seconds, 0 = always)
    // ------------------------------------------------------------------

    // Parsed once per change of the setting (see _onSettingChanged)
    _mutedEntries() {
        const now = Date.now() / 1000;
        this._mutedCache ??= this._settings.get_strv('muted-apps');
        return this._mutedCache
            .map(line => {
                const [key, label = key, until = '0', choice = ''] = line.split('\t');
                return {key, label, until: Number(until) || 0, choice: choice === '' ? -1 : Number(choice)};
            })
            .filter(e => e.key && (e.until === 0 || e.until > now));
    }

    _isMuted(key) {
        return this._mutedEntries().some(e => e.key === key);
    }

    // until: Unix seconds when the silence ends, 0 = always
    // choice: index of the duration button (shown highlighted); until null = unmute
    _mute(source, until, choice = -1) {
        const key = this._sourceKey(source);
        if (!key)
            return;
        const label = (source.title || key).replace(/[\t\n]/g, ' ');
        const list = this._mutedEntries().filter(e => e.key !== key)
            .map(e => `${e.key}\t${e.label}\t${e.until}\t${e.choice}`);
        if (until !== null)
            list.push(`${key}\t${label}\t${Math.round(until)}\t${choice}`);
        this._settings.set_strv('muted-apps', list);
        this._mutedCache = null;
    }

    // No banner for a silenced app. GNOME shows a banner only if
    // source.policy.showBanners is true (or the notification is critical): the
    // policy of the source answers false while the app is silenced. The
    // urgency of the notifications is NOT changed: GNOME's message group
    // counts urgent messages on every urgency change and, lowered from normal
    // to low, it moved the message to a wrong place and the message vanished.
    _holdBanners(source) {
        const policy = source.policy;
        if (this._bannerPolicies?.get(source) !== policy)
            this._releaseBanners(source); // the source got a new policy
        if (!policy || Object.prototype.hasOwnProperty.call(policy, 'showBanners'))
            return;
        let proto = Object.getPrototypeOf(policy);
        while (proto && !Object.getOwnPropertyDescriptor(proto, 'showBanners'))
            proto = Object.getPrototypeOf(proto);
        const original = proto && Object.getOwnPropertyDescriptor(proto, 'showBanners').get;
        if (!original)
            return;
        Object.defineProperty(policy, 'showBanners', {
            configurable: true,
            get: () => (!this._settings || !this._isMuted(this._sourceKey(source))) &&
                original.call(policy),
        });
        this._bannerPolicies ??= new Map();
        this._bannerPolicies.set(source, policy);
    }

    // The policy goes back to the getter of its class
    _releaseBanners(source) {
        const policy = this._bannerPolicies?.get(source);
        if (policy)
            delete policy.showBanners;
        this._bannerPolicies?.delete(source);
    }

    _mutedEntry(key) {
        return this._mutedEntries().find(e => e.key === key) ?? null;
    }

    // A bell next to the X of every notification in the panel: it opens a
    // row with the durations. Hooked into GNOME's message group, undone on
    // disable.
    _patchNotificationMessages() {
        const proto = MessageList.NotificationMessageGroup?.prototype;
        if (!proto?._addNotification || this._origAddNotification)
            return;
        this._muteButtons = new Set();
        const ext = this;
        const orig = this._origAddNotification = proto._addNotification;
        this._addNotificationWrapper = proto._addNotification = function (notification) {
            const result = orig.call(this, notification);
            try {
                const message = this._notificationToMessage?.get(notification);
                if (message)
                    ext._addMuteButton(message, notification, this.source);
            } catch (e) {
                console.error(`Smart Calendar Hub: cannot add the silence button: ${e}`);
            }
            return result;
        };

        // Notifications already in the list (login, screen unlock)
        const groups = this._dateMenu._messageList?._messageView?._notificationSourceToGroup;
        for (const group of groups?.values() ?? []) {
            for (const [notification, message] of group._notificationToMessage ?? [])
                this._addMuteButton(message, notification, group.source);
        }
    }

    _unpatchNotificationMessages() {
        const proto = MessageList.NotificationMessageGroup?.prototype;
        // Put back the original only if nobody patched it after us
        if (this._origAddNotification && proto?._addNotification === this._addNotificationWrapper)
            proto._addNotification = this._origAddNotification;
        else if (this._origAddNotification)
            console.warn('Smart Calendar Hub: _addNotification patched by someone else, left as is');
        this._origAddNotification = null;
        this._addNotificationWrapper = null;
        for (const actor of this._muteButtons ?? []) {
            try {
                actor.destroy();
            } catch (_e) {
                // the notification is already gone
            }
        }
        this._muteButtons = null;
    }

    // groupSource: the source of GNOME's message group, which always knows
    // the app (notification.source can be missing, e.g. with GSConnect)
    _addMuteButton(message, notification, groupSource = null) {
        const sourceOf = () => notification.source ?? groupSource;
        const header = message._header;
        const vbox = message.get_child();
        if (!header?.closeButton || !vbox || message._schMuteBell)
            return;

        const bell = new St.Button({
            style_class: 'message-close-button sch-mute-button',
            icon_name: 'notifications-disabled-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: _('Silence notifications from this app'),
        });
        header.insert_child_below(bell, header.closeButton);
        message._schMuteBell = bell;
        // Handlers on GNOME's message: the message outlives the extension
        // (disabled on screen lock, enabled again on unlock), so they go away
        // with the bell instead of touching destroyed widgets later.
        const messageIds = [];
        bell.connect('destroy', () => {
            delete message._schMuteBell;
            for (const id of messageIds) {
                try {
                    message.disconnect(id);
                } catch (_e) {
                    // the message is already gone
                }
            }
        });

        // The notification itself is a button: a click in the gaps of the row
        // must not open the app. The row must NOT swallow press/release events:
        // on GNOME 51 St.Button recognizes clicks with a Clutter.ClickGesture,
        // and stopping those events kept the duration buttons from working.
        // The message's own "clicked" is stopped instead when the pointer is
        // on the row (it runs before GNOME's default handler, vfunc_clicked).
        const row = new St.BoxLayout({style_class: 'sch-mute-row', visible: false, x_expand: true});
        messageIds.push(message.connect('clicked', () => {
            if (!row.visible || !row.mapped)
                return;
            const [x, y] = global.get_pointer();
            const box = row.get_transformed_extents();
            if (x >= box.get_x() && x < box.get_x() + box.get_width() &&
                y >= box.get_y() && y < box.get_y() + box.get_height())
                GObject.signal_stop_emission_by_name(message, 'clicked');
        }));
        const hour = 3600;
        const choices = [
            [_('1 hour'), () => Date.now() / 1000 + hour],
            [_('8 hours'), () => Date.now() / 1000 + 8 * hour],
            // until 8:00 of the next morning (the same day if it is still night)
            [_('Until tomorrow'), () => {
                const d = new Date();
                const day = d.getHours() < 5 ? d.getDate() : d.getDate() + 1;
                return new Date(d.getFullYear(), d.getMonth(), day, 8).getTime() / 1000;
            }],
            [_('Always'), () => 0],
        ];
        const buttons = [];
        // "Silenced until 12:40", under the durations
        const note = new St.Label({style_class: 'sch-mute-note', visible: false});
        // the panel is narrow: the note goes on two lines instead of being cut
        note.clutter_text.line_wrap = true;
        note.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        // Shows the current state: chosen duration in colour, note, bell in colour
        const sync = () => {
            const source = sourceOf();
            const entry = source ? this._mutedEntry(this._sourceKey(source)) : null;
            buttons.forEach((b, i) => {
                if (entry && entry.choice === i)
                    b.add_style_class_name('sch-mute-choice-on');
                else
                    b.remove_style_class_name('sch-mute-choice-on');
            });
            if (entry)
                bell.add_style_class_name('sch-mute-on');
            else
                bell.remove_style_class_name('sch-mute-on');
            note.visible = !!entry && row.visible;
            if (entry) {
                if (entry.until === 0) {
                    note.text = _('Silenced always · press the coloured button again to turn it back on');
                } else {
                    const end = GLib.DateTime.new_from_unix_local(entry.until);
                    const sameDay = end.format('%F') === GLib.DateTime.new_now_local().format('%F');
                    note.text = _('Silenced until {time} · press the coloured button again to turn it back on', {time: end.format(sameDay ? '%H:%M' : '%a %H:%M')});
                }
            }
        };
        choices.forEach(([label, until], i) => {
            const btn = new St.Button({label, style_class: 'sch-mute-choice', x_expand: true, can_focus: true});
            btn.connect('clicked', () => {
                const source = sourceOf();
                if (!source)
                    return;
                // clicking the chosen duration again turns the silence off
                const entry = this._mutedEntry(this._sourceKey(source));
                this._mute(source, entry?.choice === i ? null : until(), i);
                sync();
            });
            buttons.push(btn);
            row.add_child(btn);
        });
        vbox.add_child(row);
        vbox.add_child(note);
        bell.connect('clicked', () => {
            row.visible = !row.visible;
            sync();
        });
        // other notifications of the same app, and expired silences, follow
        // the setting (the bell is also re-checked when the panel opens)
        const settingsId = this._settings.connect('changed::muted-apps', sync);
        bell.connect('destroy', () => this._settings?.disconnect(settingsId));
        messageIds.push(message.connect('notify::mapped', () => {
            if (message.mapped)
                sync();
        }));
        sync();

        for (const actor of [bell, row, note]) {
            this._muteButtons?.add(actor);
            actor.connect('destroy', () => this._muteButtons?.delete(actor));
        }
    }

    // Stable identifier of the app behind a notification source.
    _sourceKey(source) {
        return source.app?.get_id?.() || source.title || '';
    }

    _watchSource(source) {
        if (this._alertSources.has(source))
            return;
        this._alertSources.set(source, [
            source.connect('notify::count', () => {
                this._rememberSource(source);
                this._updateAlertDot();
            }),
            // the policy can be replaced: silence the new one too
            source.connect('notify::policy', () => this._holdBanners(source)),
        ]);
        this._holdBanners(source);
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
            const key = this._sourceKey(s);
            // silenced apps: no banner and no red dot, only the panel list
            if (s.count > 0 && wanted.has(key) && !this._isMuted(key))
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
        this._alertDotOn = apps.length > 0;
        this._alertDot.opacity = this._alertDotOn ? 255 : 0;
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
            if (this._dateMenu.hover && this._alertDotOn && !this._dateMenu.menu.isOpen)
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
            /attention|unread|updates-available/i.test(sni.icon?.name ?? '') ||
            this._trayIconChanged(sni);
    }

    // ------------------------------------------------------------------
    // Apps that only change their tray icon (a badge drawn in the image,
    // e.g. WhatsApp, MEGA): the icon shown longest is learnt as "normal";
    // any other icon counts as an alert. Times are kept across sessions in
    // tray-icon-stats: "app id TAB fingerprint TAB seconds".
    // ------------------------------------------------------------------

    // Name + checksum of the image (and of the overlay, used by some apps)
    _iconFingerprint(sni) {
        try {
            const parts = [];
            for (const icon of [sni.icon, sni.hasOverlayIcon ? sni.overlayIcon : null]) {
                if (!icon)
                    continue;
                parts.push(icon.name ?? '');
                const pixmap = icon.pixmap;
                if (pixmap && pixmap.n_children?.() > 0) {
                    parts.push(GLib.compute_checksum_for_bytes(GLib.ChecksumType.MD5,
                        pixmap.get_data_as_bytes()));
                }
            }
            return parts.join('|') || null;
        } catch (_e) {
            return null;
        }
    }

    _loadIconStats() {
        this._iconStats = new Map(); // app id -> Map(fingerprint -> seconds)
        this._iconShown = new Map(); // sni -> {fp, since}
        for (const line of this._settings.get_strv('tray-icon-stats')) {
            const [id, fp, secs] = line.split('\t');
            if (!id || !fp)
                continue;
            if (!this._iconStats.has(id))
                this._iconStats.set(id, new Map());
            this._iconStats.get(id).set(fp, Number(secs) || 0);
        }
    }

    // Animated icons (e.g. a sync spinner) change many times a second:
    // write the setting at most once a minute (and on disable).
    _queueSaveIconStats() {
        if (this._iconSaveId)
            return;
        this._iconSaveId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60, () => {
            this._iconSaveId = 0;
            this._saveIconStats();
            return GLib.SOURCE_REMOVE;
        });
    }

    _saveIconStats() {
        if (!this._iconStats)
            return;
        const lines = [];
        for (const [id, fps] of this._iconStats) {
            // the three icons seen longest are enough
            [...fps].sort((a, b) => b[1] - a[1]).slice(0, 3)
                .forEach(([fp, secs]) => lines.push(`${id}\t${fp}\t${Math.round(secs)}`));
        }
        const old = this._settings.get_strv('tray-icon-stats');
        if (old.length !== lines.length || old.some((l, i) => l !== lines[i]))
            this._settings.set_strv('tray-icon-stats', lines);
    }

    // Adds the time the current icon has been shown, then restarts the count
    _accountTrayIcon(sni) {
        const shown = this._iconShown?.get(sni);
        const now = Date.now() / 1000;
        if (shown?.fp) {
            if (!this._iconStats.has(sni.id))
                this._iconStats.set(sni.id, new Map());
            const fps = this._iconStats.get(sni.id);
            fps.set(shown.fp, (fps.get(shown.fp) ?? 0) + Math.max(0, now - shown.since));
        }
        this._iconShown?.set(sni, {fp: this._iconFingerprint(sni), since: now});
    }

    _trayIconChanged(sni) {
        const shown = this._iconShown?.get(sni);
        const fps = this._iconStats?.get(sni.id);
        if (!shown?.fp || !fps)
            return false;
        const running = Date.now() / 1000 - shown.since;
        let normal = null;
        let best = 0;
        for (const [fp, secs] of fps) {
            const total = secs + (fp === shown.fp ? running : 0);
            if (total > best) {
                best = total;
                normal = fp;
            }
        }
        return best >= NORMAL_ICON_MIN_SECONDS && normal !== shown.fp;
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
            if (!this._iconStats)
                this._loadIconStats();
            this._iconShown.set(sni, {fp: this._iconFingerprint(sni), since: Date.now() / 1000});
            const ids = [
                sni.connect('icon', () => {
                    this._accountTrayIcon(sni);
                    this._queueSaveIconStats();
                    this._updateAlertDot();
                }),
                sni.connect('status', update),
                sni.connect('destroy', () => {
                    this._accountTrayIcon(sni);
                    this._iconShown?.delete(sni);
                    this._queueSaveIconStats();
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

        // 0. Tray icons, and the settings button as the last item. Always
        // shown, even with no icons, so the settings button can be reached.
        this._traySection = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-tray-section',
            x_expand: true,
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

        // 0b. IP addresses (sch-net.js PanelIpBox, added once IpView exists)
        this._ipPanelBin = new St.Bin({x_expand: true});
        this._sidebar.add_child(this._ipPanelBin);

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
        // "Weather · 12° Brescia [icon of today's weather]"   >
        const weatherLine = new St.BoxLayout({x_expand: true, style_class: 'sch-weather-line'});
        this._weatherSummary = new St.Label({
            text: _('Weather'),
            style_class: 'sch-calendar-expander-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        weatherLine.add_child(this._weatherSummary);
        this._weatherSummaryIcon = new St.Icon({
            icon_size: 16,
            style_class: 'sch-weather-summary-icon',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        weatherLine.add_child(this._weatherSummaryIcon);
        weatherLine.add_child(new St.Widget({x_expand: true}));
        this._weatherArrow = new St.Icon({
            icon_name: 'pan-end-symbolic',
            icon_size: 16,
            style_class: 'sch-calendar-expander-arrow',
        });
        weatherLine.add_child(this._weatherArrow);
        weatherExpander.set_child(weatherLine);
        weatherRow.add_child(weatherExpander);

        // Cities saved in GNOME Weather: up/down arrows between the weather
        // and the gear (only with two or more cities)
        this._citySelector = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-city-selector',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        for (const [icon, delta, name] of [['pan-up-symbolic', -1, _('Previous city')],
            ['pan-down-symbolic', 1, _('Next city')]]) {
            const btn = new St.Button({
                style_class: 'sch-city-arrow',
                can_focus: true,
                accessible_name: name,
                child: new St.Icon({icon_name: icon, icon_size: 12}),
            });
            btn.connect('clicked', () => this._cityWeather?.move(delta));
            this._citySelector.add_child(btn);
        }
        weatherRow.add_child(this._citySelector);

        // placed at the end of the tray by _layoutTray()
        const gear = this._gearButton = new St.Button({
            style_class: 'sch-gear-button',
            can_focus: true,
            accessible_name: _('Settings'),
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 16}),
        });
        gear.connect('clicked', () => {
            dm.menu.close();
            this.openPreferences();
        });

        this._weatherBody = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._sidebar.add_child(this._weatherBody);
        // GNOME's weather (first city) in a box of ours, so it can be hidden
        // while another city is shown (GNOME drives its own visibility)
        this._gnomeWeatherBin = new St.Bin({x_expand: true});
        this._weatherBody.add_child(this._gnomeWeatherBin);
        this._adopt(dm._weatherItem, this._gnomeWeatherBin);
        // Another city: a card with its name and the next hours
        this._cityCard = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sch-city-card',
            x_expand: true,
            visible: false,
        });
        this._weatherBody.add_child(this._cityCard);
        weatherExpander.connect('clicked', () => {
            weatherExpanded = !weatherExpanded;
            this._syncWeatherExpanded();
        });
        this._syncWeatherExpanded();

        // Dots under the row: which of the cities is shown
        this._cityDots = new St.BoxLayout({style_class: 'sch-city-dots', x_align: Clutter.ActorAlign.CENTER, visible: false});
        this._sidebar.insert_child_above(this._cityDots, weatherRow);

        const client = this._weatherClient = dm._weatherItem?._weatherClient;
        this._cityWeather = new CityWeather(() => this._updateWeatherSummary(this._weatherClient));
        if (client)
            this._connect(client, 'changed', () => this._updateWeatherSummary(client));
        this._updateWeatherSummary(client);

        // 2. Sky (sun, moon, moon phase) on the left, date on the right
        const dateRow = new St.BoxLayout({style_class: 'sch-date-row', x_expand: true});
        this._sidebar.add_child(dateRow);
        this._skyView = new SkyView(dm._weatherItem?._weatherClient ?? null, this._settings);
        dateRow.add_child(this._skyView.actor);
        this._adopt(dm._date, dateRow);
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
                this._cityWeather?.refresh();
                this._skyView?.start();
            } else {
                this._trayMenuManager?.activeMenu?.close();
                this._skyView?.stop();
            }
        });

        // 4. Notifications
        if (dm._messageList) {
            dm._messageList.x_expand = true;
            dm._messageList.y_expand = true;
            this._adopt(dm._messageList, this._sidebar);
        }

        // 5. Bottom row, three buttons of the same shape and width:
        //    world clocks · New event · Clear (calendar open: only New event)
        this._bottomRow = new St.BoxLayout({style_class: 'sch-bottom-row', x_expand: true});
        this._sidebar.add_child(this._bottomRow);
        if (dm._clocksItem) {
            this._clocksOrig = {x_expand: dm._clocksItem.x_expand, visible: dm._clocksItem.visible, width: -1};
            dm._clocksItem.x_expand = true;
            dm._clocksItem.add_style_class_name('sch-bottom-btn');
            this._adopt(dm._clocksItem, this._bottomRow);
        }
        // "New event" (GNOME Calendar), in the middle; alone when the
        // calendar is open. Hidden when GNOME Calendar is not installed.
        this._newEventButton = new St.Button({
            style_class: 'sch-new-event sch-bottom-btn',
            x_expand: true,
            can_focus: true,
            visible: !!this._calendarView?.hasCalendarApp,
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
        this._bottomRow.add_child(this._newEventButton);
        const clear = dm._messageList?._clearButton;
        if (clear) {
            this._clearButton = clear;
            // width -1 = back to its natural width
            this._clearOrig = {x_expand: clear.x_expand, x_align: clear.x_align, width: -1};
            clear.x_expand = false;
            clear.x_align = Clutter.ActorAlign.FILL;
            clear.add_style_class_name('sch-clear-button');
            clear.add_style_class_name('sch-bottom-btn');
            // In a box of ours: GNOME drives the button's own visibility (only
            // with notifications), we hide the box while the calendar is open.
            this._clearBox = new St.Bin({style_class: 'sch-clear-box'});
            this._bottomRow.add_child(this._clearBox);
            this._adopt(clear, this._clearBox);
            // GNOME shows "Clear" only with notifications: share the row again
            this._connect(clear, 'notify::visible', () => this._layoutBottomRow());
        }

        this._updateSidebarSize();
    }

    // The visible buttons of the bottom row share its width equally
    _layoutBottomRow() {
        if (!this._bottomRow)
            return;
        const items = [];
        if (this._clocksOrig && this._dateMenu._clocksItem.visible)
            items.push(this._dateMenu._clocksItem);
        if (this._newEventButton?.visible)
            items.push(this._newEventButton);
        if (this._clearBox?.visible && this._clearButton?.visible)
            items.push(this._clearButton);
        if (!items.length)
            return;
        // panel padding (4) + row margins (8), 6 px between buttons
        const inner = this._settings.get_int('sidebar-width') - 12;
        const width = Math.floor((inner - 6 * (items.length - 1)) / items.length);
        for (const item of items)
            item.width = width;
        // Too narrow for the text: icons instead (the text stays as accessible name)
        this._setBottomCompact(width < 130);
    }

    _setBottomCompact(compact) {
        const clear = this._clearButton;
        if (clear) {
            if (compact && !this._clearLabel) {
                this._clearLabel = clear.label;
                clear.child = new St.Icon({icon_name: 'edit-clear-all-symbolic', icon_size: 16});
            } else if (!compact && this._clearLabel) {
                clear.label = this._clearLabel;
                this._clearLabel = null;
            }
        }
        const clocks = this._clocksOrig ? this._dateMenu._clocksItem : null;
        if (clocks) {
            // only the "Add world clocks…" title becomes an icon; a list of
            // clocks stays as GNOME shows it
            const iconify = compact && (clocks._locations?.length ?? 0) === 0;
            if (iconify && !this._clocksGrid) {
                this._clocksGrid = clocks.child;
                this._clocksAccessible = clocks.accessible_name;
                clocks.child = new St.Icon({icon_name: 'preferences-system-time-symbolic', icon_size: 16});
                clocks.accessible_name = _('World clocks');
            } else if (!iconify && this._clocksGrid) {
                clocks.child = this._clocksGrid;
                clocks.accessible_name = this._clocksAccessible;
                this._clocksGrid = null;
            }
        }
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
        const city = this._cityWeather?.current();
        const info = city ? city.info : client?.info;
        const hasLocation = city ? true : !!client?.hasLocation;
        let text = _('Weather');
        let icon = null;
        if (hasLocation && info?.is_valid()) {
            const [ok, temp] = info.get_value_temp(GWeather.TemperatureUnit.DEFAULT);
            const place = city?.name ?? info.get_location_name() ?? '';
            if (ok && Number.isFinite(temp))
                text = _('Weather · {temp}° {place}', {temp: Math.round(temp), place}).trim();
            icon = info.get_symbolic_icon_name() || null;
        } else if (city) {
            text = _('Weather · {temp}° {place}', {temp: '…', place: city.name});
        }
        this._weatherSummary.text = text;
        if (this._weatherSummaryIcon) {
            this._weatherSummaryIcon.icon_name = icon ?? 'weather-clear-symbolic';
            this._weatherSummaryIcon.visible = !!icon;
        }

        // Selector, dots, and which weather the open section shows
        const count = this._cityWeather?.count ?? 0;
        if (this._citySelector)
            this._citySelector.visible = count > 1;
        if (this._cityDots) {
            this._cityDots.visible = count > 1;
            this._cityDots.destroy_all_children();
            for (let i = 0; i < count; i++) {
                this._cityDots.add_child(new St.Widget({
                    style_class: i === this._cityWeather.index ? 'sch-city-dot sch-city-dot-on' : 'sch-city-dot',
                }));
            }
        }
        if (this._gnomeWeatherBin)
            this._gnomeWeatherBin.visible = !city;
        if (this._cityCard) {
            this._cityCard.visible = !!city;
            this._cityCard.destroy_all_children();
            if (city) {
                const head = new St.BoxLayout({style_class: 'sch-city-card-head', x_expand: true});
                head.add_child(new St.Label({text: _('Weather'), x_expand: true}));
                head.add_child(new St.Label({text: city.name}));
                this._cityCard.add_child(head);
                this._cityCard.add_child(buildForecast(info));
            }
        }
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
        const hasApp = !!this._calendarView?.hasCalendarApp;
        if (this._newEventButton)
            this._newEventButton.visible = hasApp;
        // calendar open: only "New event" (the world clocks only if there is no Calendar app)
        if (this._clocksOrig)
            this._dateMenu._clocksItem.visible = !(expanded && hasApp);
        // "Clear" is about the notifications, hidden while the calendar is open
        if (this._clearBox)
            this._clearBox.visible = !expanded;
        this._layoutBottomRow();
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
        this._layoutBottomRow();
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
        // the settings button closes the last row
        const containers = [...this._movedTrayItems.values()].map(i => i.container);
        if (this._gearButton)
            containers.push(this._gearButton);

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
