// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// "System updates" in the card beside the panel: how many updates there are
// and where they come from, read only, and buttons that open the program of
// the system that installs them. Nothing is ever installed from here, and no
// package manager runs inside GNOME Shell as root:
// - Arch and its family (CachyOS…): checkupdates (pacman-contrib), which
//   works on a copy of the package database; Octopi, or Cachy-Update,
//   installs them. Not PackageKit, which Arch advises against.
// - Other systems (Fedora, Ubuntu…): PackageKit over D-Bus; GNOME Software,
//   or Ubuntu's Software Updater, installs them. Snap packages too, if any.
// - Everywhere: Flatpak apps and firmware (fwupd over D-Bus), installed by
//   GNOME Software.
// The check runs when the page opens (its result is kept for ten minutes,
// until the panel is taken down)
// or on "Check again", every source at the same time, without waiting on
// any of them: each row fills in when its own source answers.
//
// The page opens beside the menu of Octopi's tray icon (with our item on
// top of it to close and open it again) and, on systems without Octopi,
// from the list of our settings (the gear).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {_} from './sch-i18n.js';
import {logWarning} from './sch-log.js';
import {pageKit as kit} from './sch-page-kit.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');
Gio._promisify(Gio.DBusConnection.prototype, 'call');

// The titles of the rows, translated when the page is built (the user's
// translation file may still be loading when the system is found)
const TITLES = {
    packages: () => _('System packages'),
    snap: () => _('Snap packages'),
    flatpak: () => _('Flatpak apps'),
    firmware: () => _('Firmware'),
};

// The tray icon of Octopi (its StatusNotifierItem id)
const OCTOPI_NOTIFIER = 'octopi-notifier';
// The id of the page among our settings
export const UPDATES_SECTION = 'system-updates';

const KEEP_RESULT_MS = 10 * 60 * 1000;
const CHECK_TIMEOUT_S = 120;

const PACKAGEKIT = 'org.freedesktop.PackageKit';
const PACKAGEKIT_TRANSACTION = 'org.freedesktop.PackageKit.Transaction';
// the "none" filter of PackageKit: every update
const PACKAGEKIT_FILTER_NONE = 1 << 1;
const FWUPD = 'org.freedesktop.fwupd';

function desktopApp(id) {
    return Shell.AppSystem.get_default().lookup_app(id);
}

function hasProgram(name) {
    return GLib.find_program_in_path(name) !== null;
}

// /etc/os-release as {KEY: value}
async function readOsRelease() {
    for (const path of ['/etc/os-release', '/usr/lib/os-release']) {
        try {
            const [bytes] = await Gio.File.new_for_path(path).load_contents_async(null);
            const fields = {};
            for (const line of new TextDecoder().decode(bytes).split('\n')) {
                const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
                if (m)
                    fields[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
            }
            return fields;
        } catch (_e) {
            // not there: the next one
        }
    }
    return {};
}

async function findSystem() {
    const os = await readOsRelease();
    const ids = [os.ID ?? '', ...(os.ID_LIKE ?? '').split(/\s+/)].map(id => id.toLowerCase());
    const arch = ids.includes('arch');
    const ubuntu = ids.includes('ubuntu');
    // looked up once: GLib.find_program_in_path reads the folders of PATH
    const checkupdates = arch && hasProgram('checkupdates');
    const sources = [{
        id: 'packages',
        icon: 'package-x-generic-symbolic',
        run: arch ? cancellable => checkUpdates(checkupdates, cancellable) : packageKitUpdates,
    }];
    if (hasProgram('snap'))
        sources.push({id: 'snap', icon: 'package-x-generic-symbolic', run: snapUpdates});
    if (hasProgram('flatpak'))
        sources.push({id: 'flatpak', icon: 'application-x-addon-symbolic', run: flatpakUpdates});
    sources.push({id: 'firmware', icon: 'computer-symbolic', run: firmwareUpdates});

    // who installs the updates of the system packages
    const octopi = arch ? desktopApp('octopi.desktop') : null;
    let installer = null;
    if (arch)
        installer = octopi ?? desktopApp('arch-update.desktop');
    else if (ubuntu)
        installer = desktopApp('update-manager.desktop');
    return {
        name: os.PRETTY_NAME || os.NAME || '',
        // with Octopi the page opens from its tray icon
        octopi: octopi !== null,
        sources,
        installer,
        // GNOME Software on its updates page
        software: hasProgram('gnome-software') && desktopApp('org.gnome.Software.desktop') !== null,
    };
}

// A program run to its end: {status, out}. Cancelling stops it.
async function run(argv, cancellable) {
    const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
    const id = cancellable.connect(() => proc.force_exit());
    try {
        const [out] = await proc.communicate_utf8_async(null, cancellable);
        return {status: proc.get_if_exited() ? proc.get_exit_status() : -1, out: out ?? ''};
    } finally {
        cancellable.disconnect(id);
    }
}

const lines = text => text.split('\n').map(line => line.trim()).filter(line => line);

// Arch: "name old -> new", one per line; exit 2 = no updates
async function checkUpdates(installed, cancellable) {
    if (!installed)
        return {state: 'missing', message: _('Install pacman-contrib to count them')};
    const {status, out} = await run(['checkupdates', '--nocolor'], cancellable);
    if (status === 2)
        return {state: 'done', names: []};
    if (status !== 0)
        throw new Error(`checkupdates exited with ${status}`);
    return {state: 'done', names: lines(out).map(line => line.split(/\s+/)[0])};
}

// PackageKit: a transaction, its Package signals, then Finished
async function packageKitUpdates(cancellable) {
    const bus = Gio.DBus.system;
    const reply = await bus.call(PACKAGEKIT, '/org/freedesktop/PackageKit', PACKAGEKIT,
        'CreateTransaction', null, new GLib.VariantType('(o)'), Gio.DBusCallFlags.NONE, -1, cancellable);
    const [path] = reply.deepUnpack();
    const names = await new Promise((resolve, reject) => {
        const found = [];
        const ids = [];
        let cancelId = 0;
        let ended = false;
        const end = (fn, value) => {
            if (ended)
                return;
            ended = true;
            ids.forEach(id => bus.signal_unsubscribe(id));
            if (cancelId)
                cancellable.disconnect(cancelId);
            fn(value);
        };
        const on = (member, handler) => ids.push(bus.signal_subscribe(PACKAGEKIT, PACKAGEKIT_TRANSACTION,
            member, path, null, Gio.DBusSignalFlags.NONE,
            (_bus, _sender, _path, _iface, _member, params) => handler(params.deepUnpack())));
        // package id: "name;version;arch;repository"
        on('Package', ([, packageId]) => found.push(packageId.split(';')[0]));
        on('ErrorCode', ([, details]) => end(reject, new Error(`PackageKit: ${details}`)));
        on('Finished', () => end(resolve, found));
        if (cancellable.is_cancelled()) {
            end(reject, new Error('cancelled'));
            return;
        }
        cancelId = cancellable.connect(() => end(reject, new Error('cancelled')));
        bus.call(PACKAGEKIT, path, PACKAGEKIT_TRANSACTION, 'GetUpdates',
            new GLib.Variant('(t)', [PACKAGEKIT_FILTER_NONE]), null, Gio.DBusCallFlags.NONE, -1, cancellable)
            .catch(e => end(reject, e));
    });
    return {state: 'done', names: [...new Set(names)]};
}

// Snap: a header line, then one line per snap; nothing on stdout when
// everything is up to date
async function snapUpdates(cancellable) {
    const {status, out} = await run(['snap', 'refresh', '--list'], cancellable);
    if (status !== 0)
        throw new Error(`snap exited with ${status}`);
    return {state: 'done', names: lines(out).slice(1).map(line => line.split(/\s+/)[0])};
}

// Flatpak, every installation (the user's and the system's)
async function flatpakUpdates(cancellable) {
    const {status, out} = await run(['flatpak', 'remote-ls', '--updates', '--columns=name,application'],
        cancellable);
    if (status !== 0)
        throw new Error(`flatpak exited with ${status}`);
    return {
        state: 'done',
        names: lines(out).map(line => {
            const [name, application] = line.split('\t');
            return name?.trim() || application?.trim() || line;
        }),
    };
}

// fwupd: the devices, then the upgrades of each (an error: none for it)
async function firmwareUpdates(cancellable) {
    const bus = Gio.DBus.system;
    let reply;
    try {
        reply = await bus.call(FWUPD, '/', FWUPD, 'GetDevices', null,
            new GLib.VariantType('(aa{sv})'), Gio.DBusCallFlags.NONE, -1, cancellable);
    } catch (e) {
        if (e.matches(Gio.DBusError, Gio.DBusError.SERVICE_UNKNOWN) ||
            e.matches(Gio.DBusError, Gio.DBusError.NAME_HAS_NO_OWNER))
            return {state: 'missing', message: _('fwupd is not installed')};
        throw e;
    }
    const devices = reply.recursiveUnpack()[0];
    const upgrades = await Promise.allSettled(devices.map(device => bus.call(FWUPD, '/', FWUPD,
        'GetUpgrades', new GLib.Variant('(s)', [device.DeviceId ?? '']), new GLib.VariantType('(aa{sv})'),
        Gio.DBusCallFlags.NONE, -1, cancellable)));
    const names = devices.filter((device, i) => upgrades[i].status === 'fulfilled' &&
        upgrades[i].value.recursiveUnpack()[0].length > 0).map(device => device.Name ?? device.DeviceId);
    return {state: 'done', names};
}

export class SystemUpdates {
    constructor(panel) {
        this._panel = panel;
        this._cancellable = null;
        this._timeoutId = 0;
        this._partial = null;
        this._listeners = new Set();
        this._destroyed = false;
        // what this system is and which sources it has
        this._system = null;
        // the last check that ended: {time, results: Map(source → result)}
        this._lastCheck = null;
        this._ready = findSystem().then(found => {
            this._system = found;
        });
    }

    destroy() {
        this._destroyed = true;
        this._listeners.clear();
        this._stop();
    }

    // The entry of the page among our settings, on systems without Octopi
    // (null with it, and before the system is known)
    get settingsEntry() {
        if (!this._system || this._system.octopi)
            return null;
        return {id: UPDATES_SECTION, title: _('System updates'), icon: 'software-update-available-symbolic'};
    }

    // Called on every tidy of a visit (see PanelPages.tidy): in Octopi's
    // menu our item on top, and the first time the page beside it.
    // Octopi builds its menu anew at times: our item is then put back.
    attach(shown) {
        if (shown?.info?.key !== OCTOPI_NOTIFIER || !shown.box || this._panel.pages.visit !== shown)
            return;
        let ours = shown.updates;
        const first = !ours;
        if (first) {
            ours = shown.updates = {item: null, separator: null};
            (shown.onClose ??= []).push(() => {
                ours.item?.destroy();
                ours.separator?.destroy();
            });
        }
        if (!ours.item || !ours.separator) {
            ours.item?.destroy();
            ours.separator?.destroy();
            const item = new PopupMenu.PopupImageMenuItem(_('System updates'), 'software-update-available-symbolic');
            // not added with addMenuItem(): the menu would close on
            // activate, and the card with it
            item.connect('activate', () => this._toggle(shown));
            item.connect('destroy', () => {
                ours.item = null;
            });
            const separator = new PopupMenu.PopupSeparatorMenuItem();
            separator.connect('destroy', () => {
                ours.separator = null;
            });
            shown.box.insert_child_at_index(separator, 0);
            shown.box.insert_child_at_index(item, 0);
            Object.assign(ours, {item, separator});
        }
        if (first)
            this._toggle(shown);
    }

    _toggle(shown) {
        const side = this._panel.side;
        if (this._panel.pages.visit !== shown)
            return;
        if (shown.side) {
            side.hideSidePage(shown);
            return;
        }
        side.showSidePage(shown, () => this.buildPage(count => {
            if (shown.side?.countLabel)
                shown.side.countLabel.text = count === null ? '' : String(count);
        }), {
            sideTitle: _('System updates'),
            sideActions: [{
                icon: 'window-close-symbolic',
                label: _('Close'),
                onClick: () => side.hideSidePage(shown),
            }],
        });
    }

    // The page; onCount(total | null) when the number of updates changes
    buildPage(onCount = null) {
        const page = kit.page();
        const state = {destroyed: false, listener: null};
        page.connect('destroy', () => {
            state.destroyed = true;
            this._listeners.delete(state.listener);
            // nobody left to show the result to
            if (!this._listeners.size)
                this._stop();
        });
        this._ready.then(() => {
            if (!state.destroyed && !this._destroyed)
                state.listener = this._fill(page, onCount);
        }).catch(e => logWarning(`system updates: ${e}`));
        return page;
    }

    // The rows and buttons of the page; returns the function that brings
    // them up to date (called on every change of the check)
    _fill(page, onCount) {
        const system = this._system;
        const rows = new Map();
        for (const source of system.sources)
            rows.set(source.id, kit.row({icon: source.icon, title: TITLES[source.id](), wrap: true}));
        if (system.name)
            page.add_child(kit.section(system.name));
        page.add_child(kit.card([...rows.values()]));
        const time = kit.section('');
        page.add_child(time);

        const check = kit.button({label: _('Check again'), onClick: () => this.check(true)});
        const installer = system.installer;
        const install = installer
            ? kit.button({
                label: _('Update with {app}', {app: installer.get_name()}),
                primary: true,
                onClick: () => this._launch(() => installer.activate()),
            })
            : null;
        page.add_child(kit.buttons(check, install));
        if (system.software) {
            page.add_child(kit.buttons(kit.button({
                label: _('Open GNOME Software'),
                primary: !install,
                onClick: () => this._launch(() =>
                    Gio.Subprocess.new(['gnome-software', '--mode=updates'], Gio.SubprocessFlags.NONE)),
            })));
        }
        const by = installer?.get_name() ?? (system.software ? 'GNOME Software' : '');
        if (by) {
            page.add_child(kit.notice({
                text: _('Read only: the hub counts the updates, {app} installs them.', {app: by}),
            }));
        }

        const sync = () => {
            const results = this._results();
            for (const source of system.sources) {
                const result = results.get(source.id) ?? {state: 'checking'};
                const row = rows.get(source.id);
                row.subtitleLabel.text = describe(result);
                row.setTrailing(kit.value(result.state === 'done' ? String(result.names.length) : '–'));
            }
            check.setSensitive(!this._cancellable);
            const lastCheck = this._lastCheck;
            time.text = lastCheck && !this._cancellable
                ? _('Last checked at {time}', {
                    time: GLib.DateTime.new_from_unix_local(Math.floor(lastCheck.time / 1000)).format('%H:%M'),
                })
                : '';
            time.visible = !!time.text;
            const done = [...results.values()].filter(result => result.state === 'done');
            onCount?.(this._cancellable || !done.length
                ? null
                : done.reduce((n, result) => n + result.names.length, 0));
        };
        this._listeners.add(sync);
        sync();
        this.check(false);
        return sync;
    }

    // What the rows show now: the check running, or the last one
    _results() {
        return this._cancellable ? this._partial : this._lastCheck?.results ?? new Map();
    }

    _notify() {
        for (const listener of this._listeners)
            listener();
    }

    _launch(start) {
        try {
            start();
        } catch (e) {
            logWarning(`system updates: ${e}`);
            return;
        }
        this._panel.dateMenu.menu.close();
    }

    // A check, unless one is running or (without force) the last one is recent
    check(force) {
        this._check(force).catch(e => logWarning(`system updates: ${e}`));
    }

    async _check(force) {
        const system = this._system;
        if (this._cancellable || this._destroyed || !system)
            return;
        if (!force && this._lastCheck && Date.now() - this._lastCheck.time < KEEP_RESULT_MS)
            return;
        const cancellable = this._cancellable = new Gio.Cancellable();
        const partial = this._partial = new Map();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CHECK_TIMEOUT_S, () => {
            this._timeoutId = 0;
            cancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });
        this._notify();
        await Promise.all(system.sources.map(async source => {
            let result;
            try {
                result = await source.run(cancellable);
            } catch (e) {
                if (cancellable.is_cancelled())
                    return;
                logWarning(`system updates, ${source.id}: ${e.message}`);
                result = {state: 'error'};
            }
            if (this._cancellable !== cancellable || cancellable.is_cancelled())
                return;
            partial.set(source.id, result);
            this._notify();
        }));
        // stopped meanwhile (the page went): nothing kept
        if (this._cancellable !== cancellable)
            return;
        // too long: what did not answer is shown as such
        for (const source of system.sources) {
            if (!partial.has(source.id))
                partial.set(source.id, {state: 'error', message: _('The check took too long')});
        }
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        this._cancellable = null;
        this._partial = null;
        this._lastCheck = {time: Date.now(), results: partial};
        this._notify();
    }

    _stop() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        const cancellable = this._cancellable;
        this._cancellable = null;
        this._partial = null;
        cancellable?.cancel();
    }
}

// The line under the title of a row
function describe(result) {
    switch (result.state) {
    case 'checking':
        return _('Checking…');
    case 'missing':
        return result.message;
    case 'error':
        return result.message ?? _('Could not check');
    }
    const names = result.names;
    if (!names.length)
        return _('No updates');
    if (names.length <= 3)
        return names.join(', ');
    return _('{names} and {count} more', {names: names.slice(0, 3).join(', '), count: names.length - 3});
}
