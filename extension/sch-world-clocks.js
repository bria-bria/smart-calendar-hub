// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// World clocks at the bottom of the side panel: one analogue clock per city
// of GNOME Clocks (the same list GNOME shows), hands on the time of that
// city, the minute hand in GNOME's accent colour, a darker dial where it is
// night. Hovering a clock shows "city · time"; a click opens GNOME Clocks.
// With more clocks than room, an arrow on each side moves the view (like the
// tray). Before the clocks, the alarms and timers of GNOME Clocks: the
// alarms that still ring today (one switched off in GNOME Clocks that would
// ring today with the pause sign), and each timer with its duration. GNOME Clocks keeps the countdown
// of its running timers to itself and never reads changes made by others, so
// a click on a timer starts OUR countdown of that duration: click again to
// pause (pause sign) and to resume, right click to reset; at the end a
// notification with the alarm sound. Alarms are switched on and off in
// GNOME Clocks (a click opens it). With nothing to show, one short line that
// opens GNOME Clocks (the card never disappears without a word).
//
// Where the alarms and timers are: GNOME Clocks installed from the system
// keeps them in GSettings (schema org.gnome.clocks); installed as a Flatpak
// (Flathub gives it no access to dconf) in the keyfile of its sandbox,
// read here asynchronously and again whenever it changes. The cities come
// to GNOME Shell over D-Bus in both cases (org.gnome.shell.world-clocks).

import 'cairo'; // makes the Cairo context of St.DrawingArea usable
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {_} from './sch-i18n.js';
import {logError} from './sch-log.js';

const DIAL = 34; // px, before the screen scale
const TICK_SECONDS = 30;
const FINISH_CHECK_MS = 60000; // at least once a minute: late after a suspend
const IDLE_ICON = 'appointment-soon-symbolic';
const PAUSE_ICON = 'media-playback-pause-symbolic';

const CLOCKS_ID = 'org.gnome.clocks';
const CLOCKS_DESKTOP = `${CLOCKS_ID}.desktop`;
// the keyfile of GLib's settings inside the Flatpak sandbox, and its group
// for the schema org.gnome.clocks (path /org/gnome/clocks/)
const FLATPAK_KEYFILE = ['.var', 'app', CLOCKS_ID, 'config', 'glib-2.0', 'settings', 'keyfile'];
const KEYFILE_GROUP = 'org/gnome/clocks';
const KEYFILE_DELAY_MS = 300; // one read for the burst of events of one save

Gio._promisify(Gio.File.prototype, 'load_contents_async');

// {alarms, timers} of the keyfile of GNOME Clocks in Flatpak, unpacked like
// GSettings values; a key never changed in GNOME Clocks is not in the file
function parseClocksKeyfile(bytes) {
    const keyfile = new GLib.KeyFile();
    keyfile.load_from_bytes(new GLib.Bytes(bytes), GLib.KeyFileFlags.NONE);
    // (has_key() is not available from JavaScript)
    const keys = keyfile.has_group(KEYFILE_GROUP) ? keyfile.get_keys(KEYFILE_GROUP)[0] : [];
    const read = key => {
        if (!keys.includes(key))
            return [];
        const text = keyfile.get_value(KEYFILE_GROUP, key);
        return GLib.Variant.parse(new GLib.VariantType('aa{sv}'), text, null, null).recursiveUnpack();
    };
    return {alarms: read('alarms'), timers: read('timers')};
}

// Our countdowns of the timers of GNOME Clocks, by timer:
// {name, duration, end (µs, wall clock) while running | left (s) while
// paused, done}. At module level, with the wait for their end: they go on
// and ring while the screen is locked (the card is taken away then)
const runs = new Map();
let finishId = 0;
let onFinish = null; // the card on screen: its chips follow

// Ended countdowns: notification and sound; then the next end is waited for
// (at least once a minute: the wait runs late after a suspend)
function finishRuns() {
    const now = GLib.get_real_time();
    for (const run of runs.values()) {
        if (run.end && !run.done && run.end <= now + 300000) {
            run.done = true;
            notifyFinished(run);
        }
    }
    if (finishId)
        GLib.source_remove(finishId);
    finishId = 0;
    const ends = [...runs.values()].filter(r => r.end && !r.done).map(r => r.end);
    if (ends.length) {
        const ms = Math.max(0, Math.ceil((Math.min(...ends) - now) / 1000));
        finishId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.min(ms, FINISH_CHECK_MS), () => {
            finishId = 0;
            finishRuns();
            onFinish?.();
            return GLib.SOURCE_REMOVE;
        });
    }
    return ends.length > 0;
}

function notifyFinished(run) {
    const duration = formatDuration(run.duration);
    try {
        const source = MessageTray.getSystemSource();
        source.addNotification(new MessageTray.Notification({
            source,
            title: _('Timer finished'),
            body: run.name ? `${run.name} · ${duration}` : duration,
            gicon: new Gio.ThemedIcon({name: 'alarm-symbolic'}),
            urgency: MessageTray.Urgency.HIGH,
        }));
        global.display.get_sound_player().play_from_theme('alarm-clock-elapsed', _('Timer finished'), null);
    } catch (e) {
        logError(`timer: ${e}`);
    }
}

// The extension switched off: no countdown left behind
export function stopTimerCountdowns() {
    if (finishId)
        GLib.source_remove(finishId);
    finishId = 0;
    onFinish = null;
    runs.clear();
}

// "4:05", "1:02:09"
function formatCountdown(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function remaining(run, now = GLib.get_real_time()) {
    if (run.done)
        return 0;
    const left = run.end ? (run.end - now) / 1e6 : run.left;
    return Math.max(0, Math.ceil(left));
}

// "1 h", "5 min", "1 h 30", "45 s"
function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h && m)
        return `${h} h ${String(m).padStart(2, '0')}`;
    if (h)
        return `${h} h`;
    if (m)
        return `${m} min`;
    return `${seconds} s`;
}

export class WorldClocksCard {
    // onOpen(): called before GNOME Clocks is opened (closes the panel)
    constructor(onOpen) {
        this._onOpen = onOpen;
        this._clocks = []; // {name, tz, area}
        this._timerId = 0;
        this._arrowsId = 0;
        this._tickId = 0; // countdowns on screen, while the panel is open
        this._open = false;
        this._timerChips = [];

        this.actor = new St.BoxLayout({style_class: 'sch-clocks-card', x_expand: true, visible: false});
        const arrow = (icon, delta, name) => {
            const btn = new St.Button({
                style_class: 'sch-tray-arrow',
                can_focus: true,
                accessible_name: name,
                y_align: Clutter.ActorAlign.CENTER,
                visible: false,
                child: new St.Icon({icon_name: icon, icon_size: 12}),
            });
            btn.connect('clicked', () => this._scrollBy(delta));
            return btn;
        };
        this._left = arrow('pan-start-symbolic', -1, _('Previous clocks'));
        this._right = arrow('pan-end-symbolic', 1, _('Next clocks'));
        this._box = new St.BoxLayout({style_class: 'sch-clocks-box', x_expand: true});
        // a spacer on each side: the clocks stay in the centre
        this._box.add_child(new St.Widget({x_expand: true}));
        this._endSpacer = new St.Widget({x_expand: true});
        this._box.add_child(this._endSpacer);
        // EXTERNAL: scrolls without a scrollbar and does not ask for the width
        // of all the clocks (NEVER would push the card wider than the panel)
        this._scroll = new St.ScrollView({
            x_expand: true,
            hscrollbar_policy: St.PolicyType.EXTERNAL,
            vscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: false,
            child: this._box,
        });
        this._scroll.connect('notify::width', () => this._syncArrows());
        for (const prop of ['value', 'upper', 'page-size'])
            this._box.hadjustment.connect(`notify::${prop}`, () => this._syncArrowEnds());
        this.actor.add_child(this._left);
        this.actor.add_child(this._scroll);
        this.actor.add_child(this._right);

        // nothing to show: one line in place of the row, it opens GNOME Clocks
        this._emptyLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER, x_expand: true});
        this._emptyLabel.clutter_text.line_wrap = true;
        this._emptyLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        const emptyLine = new St.BoxLayout({style_class: 'sch-clock-chip-line'});
        emptyLine.add_child(new St.Icon({icon_name: 'alarm-symbolic', icon_size: 14, y_align: Clutter.ActorAlign.CENTER}));
        emptyLine.add_child(this._emptyLabel);
        this._empty = new St.Button({
            style_class: 'sch-clock-empty',
            x_expand: true,
            visible: false,
            child: emptyLine,
        });
        this._empty.connect('clicked', () => this._openClocks());
        this.actor.add_child(this._empty);

        // the label "city · time", above the clock the pointer is on
        this._tip = new St.Label({style_class: 'sch-alert-tip', visible: false});
        Main.uiGroup.add_child(this._tip);

        // the dials follow the screen scale
        this._theme = St.ThemeContext.get_for_stage(global.stage);
        this._scaleId = this._theme.connect('notify::scale-factor', () => this._resize());

        this._settings = new Gio.Settings({schema_id: 'org.gnome.shell.world-clocks'});
        this._settingsId = this._settings.connect('changed::locations', () => this._load());
        // 12 or 24 hours, like GNOME's clock, for the times in the labels
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._formatId = this._interface.connect('changed::clock-format', () => {
            this._loadChips();
            this._repaintAll();
        });
        // alarms and timers: from the GNOME Clocks that is installed (system
        // or Flatpak), again when apps are installed or removed
        this._chips = [];
        this._clocksKind = null; // 'host', 'flatpak' or 'none'
        this._clocksLoaded = false; // alarms and timers read at least once
        this._clocksValues = {alarms: [], timers: []}; // read from the Flatpak keyfile
        this._keyfileId = 0;
        this._appSystem = Shell.AppSystem.get_default();
        this._appSystem.connectObject('installed-changed', () => this._syncClocksSource(), this);
        this.actor.connect('destroy', () => this._cleanup());
        this._syncClocksSource(false);
        this._load();
        this._onFinish = () => this._checkFinished();
        onFinish = this._onFinish;
        this._checkFinished(); // a timer may have ended while locked
    }

    destroy() {
        this.actor.destroy();
    }

    _cleanup() {
        this.stop();
        if (onFinish === this._onFinish)
            onFinish = null;
        this._timerChips = [];
        if (this._arrowsId)
            GLib.source_remove(this._arrowsId);
        this._arrowsId = 0;
        if (this._settingsId)
            this._settings?.disconnect(this._settingsId);
        this._settingsId = 0;
        this._settings = null;
        if (this._formatId)
            this._interface?.disconnect(this._formatId);
        this._formatId = 0;
        this._interface = null;
        this._appSystem?.disconnectObject(this);
        this._appSystem = null;
        this._dropClocksSource();
        if (this._scaleId)
            this._theme?.disconnect(this._scaleId);
        this._scaleId = 0;
        this._tip?.destroy();
        this._tip = null;
        this._box = null;
    }

    // Panel open: the hands follow the time; closed: no timer
    start() {
        this.stop();
        this._open = true;
        this._loadChips(); // alarms that already rang go away
        this._checkFinished(); // also starts the countdowns on screen
        this._repaintAll();
        if (!this._clocks.length)
            return;
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TICK_SECONDS, () => {
            this._repaintAll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        this._open = false;
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
        this._tip?.hide();
    }

    // The cities of GNOME Clocks, from west to east
    _load() {
        for (const {button} of this._clocks)
            button.destroy();
        this._clocks = [];
        const world = GWeather.Location.get_world();
        let list = [];
        try {
            for (const serialized of this._settings.get_value('locations').deepUnpack()) {
                const loc = world.deserialize(serialized);
                const tz = loc?.get_timezone();
                if (loc && tz)
                    list.push({name: loc.get_city_name() || loc.get_name(), tz});
            }
        } catch (e) {
            logError(`world clocks: ${e}`);
        }
        const now = GLib.DateTime.new_now_utc();
        const offset = c => now.to_timezone(c.tz).get_utc_offset();
        list = list.sort((a, b) => offset(a) - offset(b));

        for (const clock of list) {
            const area = new St.DrawingArea({
                style_class: 'sch-clock-dial',
                y_align: Clutter.ActorAlign.CENTER,
            });
            area.connect('repaint', a => this._repaint(a, clock));
            // in a button: reachable with the keyboard, Enter opens GNOME Clocks
            const button = new St.Button({
                style_class: 'sch-clock-button',
                can_focus: true,
                child: area,
                accessible_name: clock.name,
            });
            button.connect('notify::hover', () => this._showTip(button, clock, button.hover));
            button.connect('key-focus-in', () => this._showTip(button, clock, true));
            button.connect('key-focus-out', () => this._showTip(button, clock, false));
            button.connect('clicked', () => this._openClocks());
            this._box.insert_child_below(button, this._endSpacer);
            this._clocks.push({...clock, area, button});
        }
        this._resize();
        this._loadChips();
    }

    // Alarms (next ring) and timers (duration) of GNOME Clocks, before the
    // clocks
    _loadChips() {
        if (!this._box)
            return;
        for (const chip of this._chips)
            chip.destroy();
        this._chips = [];
        this._timerChips = [];
        const first = this._clocks[0]?.button ?? this._endSpacer;
        // tip: a function, the text of a timer changes while it runs
        // onClick(button): given for timers (also the right click)
        const add = (icon, text, tip, onClick = null) => {
            const line = new St.BoxLayout({style_class: 'sch-clock-chip-line'});
            const image = new St.Icon({icon_name: icon, icon_size: 14, y_align: Clutter.ActorAlign.CENTER});
            line.add_child(image);
            // never shortened ("…"): when they do not fit, the row scrolls
            // with the arrows instead
            const label = new St.Label({text, y_align: Clutter.ActorAlign.CENTER});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            line.add_child(label);
            const chip = new St.Button({
                style_class: 'sch-clock-chip',
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                child: line,
                accessible_name: tip(),
                button_mask: onClick ? St.ButtonMask.ONE | St.ButtonMask.THREE : St.ButtonMask.ONE,
            });
            const item = {name: ''};
            chip.connect('notify::hover', () => this._showTip(chip, item, chip.hover, tip()));
            chip.connect('key-focus-in', () => this._showTip(chip, item, true, tip()));
            chip.connect('key-focus-out', () => this._showTip(chip, item, false, tip()));
            chip.connect('clicked', (_chip, button) => (onClick ?? (() => this._openClocks()))(button));
            this._box.insert_child_below(chip, first);
            this._chips.push(chip);
            return {chip, image, label};
        };
        const now = GLib.DateTime.new_now_local();
        try {
            const alarms = this._readClocks('alarms');
            // only the alarms still to ring today: GNOME Clocks saves the
            // next ring of the alarms that are on (it already follows the
            // days of the week); one that rang today, or rings another day,
            // is not shown
            const today = now.format('%F');
            const isLater = when => when && when.compare(now) > 0 && when.format('%F') === today;
            const next = alarms
                .map(a => ({name: a.name ?? '', when: a.ring_time
                    ? GLib.DateTime.new_from_iso8601(a.ring_time, null)?.to_local() : null}))
                .filter(a => isLater(a.when))
                .sort((a, b) => a.when.compare(b.when));
            for (const alarm of next) {
                // like GNOME's clock, on the chip and in the label
                const time = this._format(alarm.when);
                const tip = alarm.name
                    ? _('Alarm · {name} · {time}', {name: alarm.name, time})
                    : _('Alarm · {time}', {time});
                add('alarm-symbolic', time, () => tip);
            }
            // switched off in GNOME Clocks (no next ring saved): the pause
            // sign, dimmed, only if switched on it would ring later today.
            // Its days of the week as GNOME Clocks saves them, 1 = Monday
            // as in GLib; no days: rings once, at the next hour:minute
            const weekday = now.get_day_of_week();
            for (const alarm of alarms.filter(a => !a.ring_time)) {
                const days = alarm.days ?? [];
                const when = GLib.DateTime.new_local(now.get_year(), now.get_month(),
                    now.get_day_of_month(), alarm.hour ?? 0, alarm.minute ?? 0, 0);
                if ((days.length && !days.includes(weekday)) || !isLater(when))
                    continue;
                const time = this._format(when);
                const tip = `${alarm.name
                    ? _('Alarm · {name} · {time}', {name: alarm.name, time})
                    : _('Alarm · {time}', {time})}\n${_('Off · click to switch it on in GNOME Clocks')}`;
                add(PAUSE_ICON, time, () => tip).chip.add_style_class_name('sch-clock-chip-off');
            }
            const timers = this._readClocks('timers');
            // by duration and name (the n-th timer equal to it), not by
            // position: adding or deleting another timer keeps the countdown
            const keys = new Set();
            timers.forEach(timer => {
                const seconds = timer.duration ?? 0;
                const name = timer.name ?? '';
                let n = 0;
                while (keys.has(`${seconds}|${name}|${n}`))
                    n++;
                const key = `${seconds}|${name}|${n}`;
                keys.add(key);
                const tc = {key, seconds, name};
                Object.assign(tc, add(IDLE_ICON, '', () => this._timerTip(tc),
                    button => this._toggleTimer(tc, button)));
                this._timerChips.push(tc);
            });
            // timers deleted in GNOME Clocks: their countdown goes too (not
            // before the keyfile of a Flatpak GNOME Clocks has been read)
            for (const key of [...runs.keys()]) {
                if (this._clocksLoaded && !keys.has(key))
                    runs.delete(key);
            }
            this._syncTimers();
        } catch (e) {
            logError(`alarms and timers: ${e}`);
        }
        this._syncEmpty();
        this._syncArrows();
    }

    // No city, alarm or timer: the line in place of the row. Without GNOME
    // Clocks it says so and does nothing on a click
    _syncEmpty() {
        const empty = !this._clocks.length && !this._chips.length;
        this._scroll.visible = !empty;
        this._empty.visible = empty;
        // the keyfile of a Flatpak GNOME Clocks is still being read
        this.actor.visible = !empty || this._clocksLoaded;
        if (!empty)
            return;
        this._left.visible = false;
        this._right.visible = false;
        const installed = this._clocksKind !== 'none';
        this._emptyLabel.text = installed
            ? _('No alarms today · add cities and alarms in Clocks')
            : _('Install GNOME Clocks for world clocks and alarms');
        this._empty.reactive = installed;
        this._empty.can_focus = installed;
        this._empty.accessible_name = this._emptyLabel.text;
    }

    // The alarms or the timers of GNOME Clocks, unpacked: [] when it is not
    // installed or has none
    _readClocks(key) {
        if (this._clocksKind === 'host')
            return this._clocksSettings.get_value(key).recursiveUnpack();
        return this._clocksValues[key] ?? [];
    }

    // Which GNOME Clocks is installed: the one GNOME starts (its .desktop
    // file; a Flatpak one has X-Flatpak), else the schema of a system one
    _syncClocksSource(reload = true) {
        const info = this._appSystem.lookup_app(CLOCKS_DESKTOP)?.get_app_info();
        const schema = Gio.SettingsSchemaSource.get_default()?.lookup(CLOCKS_ID, true);
        let kind = 'none';
        if (info?.has_key('X-Flatpak'))
            kind = 'flatpak';
        else if (schema)
            kind = 'host';
        if (kind === this._clocksKind)
            return;
        this._dropClocksSource();
        this._clocksKind = kind;
        this._clocksLoaded = kind !== 'flatpak';
        if (kind === 'host') {
            this._clocksSettings = new Gio.Settings({settings_schema: schema});
            this._clocksSettings.connectObject(
                'changed::alarms', () => this._loadChips(),
                'changed::timers', () => this._loadChips(), this);
        } else if (kind === 'flatpak') {
            this._keyfile = Gio.File.new_for_path(
                GLib.build_filenamev([GLib.get_home_dir(), ...FLATPAK_KEYFILE]));
            // GLib saves the keyfile by writing a new one and renaming it:
            // any event on it means "read it again"
            this._keyfileMonitor = this._keyfile.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._keyfileMonitor.connectObject('changed', () => this._scheduleKeyfileRead(), this);
            this._readKeyfile();
        }
        if (reload)
            this._loadChips();
    }

    _dropClocksSource() {
        this._clocksSettings?.disconnectObject(this);
        this._clocksSettings = null;
        this._keyfileMonitor?.disconnectObject(this);
        this._keyfileMonitor?.cancel();
        this._keyfileMonitor = null;
        this._keyfileCancel?.cancel();
        this._keyfileCancel = null;
        this._keyfile = null;
        if (this._keyfileId)
            GLib.source_remove(this._keyfileId);
        this._keyfileId = 0;
        this._clocksValues = {alarms: [], timers: []};
        this._clocksKind = null;
    }

    _scheduleKeyfileRead() {
        if (this._keyfileId)
            GLib.source_remove(this._keyfileId);
        this._keyfileId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, KEYFILE_DELAY_MS, () => {
            this._keyfileId = 0;
            this._readKeyfile();
            return GLib.SOURCE_REMOVE;
        });
    }

    // The keyfile of GNOME Clocks in Flatpak, read without blocking GNOME
    // Shell; missing (GNOME Clocks never saved anything): no alarms. Not
    // readable: what was read before stays (and so do the countdowns)
    async _readKeyfile() {
        this._keyfileCancel?.cancel();
        const cancel = new Gio.Cancellable();
        this._keyfileCancel = cancel;
        let values = {alarms: [], timers: []};
        try {
            const [bytes] = await this._keyfile.load_contents_async(cancel);
            values = parseClocksKeyfile(bytes);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                logError(`GNOME Clocks (Flatpak): ${e}`);
                if (this._keyfileCancel === cancel)
                    this._keyfileCancel = null;
                return;
            }
        }
        if (this._keyfileCancel !== cancel)
            return;
        this._keyfileCancel = null;
        this._clocksValues = values;
        this._clocksLoaded = true;
        this._loadChips();
    }

    _resize() {
        const size = DIAL * this._theme.scale_factor;
        for (const {area} of this._clocks)
            area.set_size(size, size);
        this._syncArrows();
    }

    _repaintAll() {
        for (const {area} of this._clocks)
            area.queue_repaint();
    }

    // click: start, pause, resume (a finished one: back to the start);
    // right click: reset
    _toggleTimer(tc, button) {
        const run = runs.get(tc.key);
        const now = GLib.get_real_time();
        if (button === Clutter.BUTTON_SECONDARY || run?.done)
            runs.delete(tc.key);
        else if (!run)
            runs.set(tc.key, {name: tc.name, duration: tc.seconds, end: now + tc.seconds * 1e6});
        else if (run.end)
            runs.set(tc.key, {...run, end: 0, left: remaining(run, now)});
        else
            runs.set(tc.key, {...run, end: now + run.left * 1e6, left: 0});
        this._checkFinished();
        if (this._tip?.visible)
            this._showTip(tc.chip, {name: ''}, true, this._timerTip(tc));
    }

    _timerTip(tc) {
        const duration = formatDuration(tc.seconds);
        const base = tc.name
            ? _('Timer · {name} · {duration}', {name: tc.name, duration})
            : _('Timer · {duration}', {duration});
        const run = runs.get(tc.key);
        let hint;
        if (!run)
            hint = _('Click: start');
        else if (run.done)
            hint = _('Finished · click: reset');
        else if (run.end)
            hint = _('{left} left · click: pause · right click: reset', {left: formatCountdown(remaining(run))});
        else
            hint = _('Paused · {left} left · click: resume · right click: reset', {left: formatCountdown(remaining(run))});
        return `${base}\n${hint}`;
    }

    // the chips of the timers as their countdowns: running (accent colour,
    // time left), paused (pause sign), finished, or the duration
    _syncTimers() {
        const now = GLib.get_real_time();
        for (const tc of this._timerChips) {
            const run = runs.get(tc.key);
            tc.label.text = run ? formatCountdown(remaining(run, now)) : formatDuration(tc.seconds);
            tc.image.icon_name = run && !run.done && !run.end ? PAUSE_ICON : IDLE_ICON;
            const state = !run ? '' : run.done ? 'done' : run.end ? 'running' : 'paused';
            for (const name of ['running', 'paused', 'done']) {
                if (name === state)
                    tc.chip.add_style_class_name(`sch-clock-chip-${name}`);
                else
                    tc.chip.remove_style_class_name(`sch-clock-chip-${name}`);
            }
        }
    }

    // Ended countdowns rung, the chips as the countdowns, and the seconds
    // ticking on screen while the panel is open and a timer runs
    _checkFinished() {
        const running = finishRuns();
        this._syncTimers();
        const tick = this._open && running;
        if (tick && !this._tickId) {
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                this._syncTimers();
                if (this._tip?.visible) {
                    const tc = this._timerChips.find(t => t.chip.hover || t.chip.has_key_focus());
                    if (tc)
                        this._tip.text = this._timerTip(tc);
                }
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!tick && this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    // GNOME Clocks, if installed (else a click does nothing)
    _openClocks() {
        const app = Shell.AppSystem.get_default().lookup_app('org.gnome.clocks.desktop');
        if (!app)
            return;
        this._onOpen?.();
        Main.overview.hide();
        app.activate();
    }

    _twelveHours() {
        return this._interface?.get_string('clock-format') === '12h';
    }

    // "17:30" or "5:30 PM", like GNOME's clock; twelve: always with AM/PM
    _format(time, twelve = this._twelveHours()) {
        return time.format(twelve ? '%l:%M %p' : '%H:%M').replace(/\s+/g, ' ').trim();
    }

    _time(clock) {
        return GLib.DateTime.new_now_utc().to_timezone(clock.tz);
    }

    // text: given for alarms and timers; for a clock "city · time"
    _showTip(actor, clock, show, text = null) {
        if (!this._tip)
            return;
        if (!show) {
            this._tip.hide();
            return;
        }
        // the hands show only 12 hours: the label says AM or PM
        text ??= `${clock.name} · ${this._format(this._time(clock), true)}`;
        this._tip.text = text;
        actor.accessible_name = text;
        this._tip.show();
        const [x, y] = actor.get_transformed_position();
        const [w] = actor.get_transformed_size();
        const [, tipW] = this._tip.get_preferred_width(-1);
        const [, tipH] = this._tip.get_preferred_height(-1);
        // centred on the clock, but inside the monitor
        const monitor = Main.layoutManager.findMonitorForActor(actor) ?? Main.layoutManager.primaryMonitor;
        const left = Math.max(monitor.x + 4,
            Math.min(monitor.x + monitor.width - tipW - 4, x + w / 2 - tipW / 2));
        this._tip.set_position(Math.round(left), Math.round(y - tipH - 6));
        Main.uiGroup.set_child_above_sibling(this._tip, null);
    }

    _repaint(area, clock) {
        const cr = area.get_context();
        try {
            const [w, h] = area.get_surface_size();
            const t = this._time(clock);
            const hour = t.get_hour();
            const night = hour < 6 || hour >= 20;
            const accent = area.get_theme_node().get_foreground_color();
            const r = Math.min(w, h) / 2 - 1;
            const cx = w / 2;
            const cy = h / 2;
            // dial: lighter by day, darker at night
            if (night)
                cr.setSourceRGBA(0.16, 0.16, 0.18, 1);
            else
                cr.setSourceRGBA(1, 1, 1, 0.14);
            cr.arc(cx, cy, r, 0, 2 * Math.PI);
            cr.fillPreserve();
            cr.setSourceRGBA(1, 1, 1, 0.35);
            cr.setLineWidth(1);
            cr.stroke();
            // the four hour marks
            cr.setSourceRGBA(1, 1, 1, 0.6);
            cr.setLineWidth(1.5);
            for (let i = 0; i < 4; i++) {
                const a = i * Math.PI / 2;
                cr.moveTo(cx + Math.sin(a) * r * 0.78, cy - Math.cos(a) * r * 0.78);
                cr.lineTo(cx + Math.sin(a) * r * 0.92, cy - Math.cos(a) * r * 0.92);
            }
            cr.stroke();
            cr.setLineCap(1); // round
            // hour hand
            const hourAngle = ((hour % 12) + t.get_minute() / 60) * Math.PI / 6;
            cr.setSourceRGBA(1, 1, 1, 1);
            cr.setLineWidth(Math.max(2, r * 0.14));
            cr.moveTo(cx, cy);
            cr.lineTo(cx + Math.sin(hourAngle) * r * 0.5, cy - Math.cos(hourAngle) * r * 0.5);
            cr.stroke();
            // minute hand, in the accent colour (.sch-clock-dial colour)
            const minuteAngle = t.get_minute() * Math.PI / 30;
            cr.setSourceRGBA(accent.red / 255, accent.green / 255, accent.blue / 255, 1);
            cr.setLineWidth(Math.max(1.5, r * 0.09));
            cr.moveTo(cx, cy);
            cr.lineTo(cx + Math.sin(minuteAngle) * r * 0.78, cy - Math.cos(minuteAngle) * r * 0.78);
            cr.stroke();
            cr.setSourceRGBA(1, 1, 1, 1);
            cr.arc(cx, cy, Math.max(1.5, r * 0.08), 0, 2 * Math.PI);
            cr.fill();
        } catch (e) {
            logError(`world clock: ${e}`);
        } finally {
            cr.$dispose();
        }
    }

    // Arrows only when the clocks do not fit (checked once the layout is done)
    _syncArrows() {
        if (this._arrowsId || !this._box)
            return;
        this._arrowsId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._arrowsId = 0;
            if (!this._box || !this._scroll.get_stage())
                return GLib.SOURCE_REMOVE;
            const [, natural] = this._box.get_preferred_width(-1);
            const arrows = this._left.visible ? this._left.width + this._right.width + 8 : 0;
            // the row is hidden when there is nothing to show
            const overflow = this._scroll.visible && natural > this._scroll.width + arrows + 1;
            this._left.visible = overflow;
            this._right.visible = overflow;
            if (!overflow)
                this._box.hadjustment.value = 0;
            this._syncArrowEnds();
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncArrowEnds() {
        const adj = this._box?.hadjustment;
        if (!adj)
            return;
        this._left.opacity = adj.value > adj.lower + 1 ? 255 : 90;
        this._right.opacity = adj.value < adj.upper - adj.page_size - 1 ? 255 : 90;
    }

    _scrollBy(delta) {
        const adj = this._box.hadjustment;
        const first = this._clocks[0]?.button;
        const step = first?.width > 0
            ? first.width + this._box.get_theme_node().get_length('spacing') : 40;
        const target = Math.max(adj.lower, Math.min(adj.upper - adj.page_size, adj.value + delta * step));
        adj.ease(target, {duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }
}
