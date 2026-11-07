// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria
//
// New versions of Smart Calendar Hub, at the bottom of the list of our
// settings (the card the gear opens). The extension is published on GitHub,
// not on extensions.gnome.org, so nobody else tells the user about a new
// release.
//
// - When: only when that list is shown, at most once a day (the time of the
//   last check is kept in our settings), and never with the switch
//   check-new-versions off.
// - What: one GET of the latest release of our own repository from the
//   GitHub API, with a generic User-Agent and nothing about the user. Only
//   its tag (vX.Y) is used: the page of the release and the address of the
//   zip are built from it, so they can only point to our repository.
// - Newer (numbers compared one by one, 1.10 > 1.9): a card with "What's
//   new" (the page of the release) and "Update", which downloads the zip
//   attached to that release into ~/.cache/smart-calendar-hub and gives it
//   to `gnome-extensions install --force`. That tool unpacks the zip in
//   ~/.cache, deletes the old folder and moves the new one in its place:
//   the files GNOME Shell has open are never written over, and the new
//   version starts at the next login.
// - Up to date: one quiet line with the version.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import St from 'gi://St';

import {_} from './sch-i18n.js';
import {logError, logWarning} from './sch-log.js';
import {pageKit as kit} from './sch-page-kit.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.File.prototype, 'make_directory_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'delete_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const REPO = 'bria-bria/smart-calendar-hub';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASE_PAGE = tag => `https://github.com/${REPO}/releases/tag/${tag}`;
// the zip built by build-and-install.sh, attached to every release
const ASSET = 'smart-calendar-hub@bria-bria.github.io.shell-extension.zip';
const ASSET_URL = tag => `https://github.com/${REPO}/releases/download/${tag}/${ASSET}`;
const USER_AGENT = 'Smart-Calendar-Hub';
const DAY_S = 24 * 60 * 60;
// the zip is a few hundred kB: anything much larger is not ours
const MAX_BYTES = 10 * 1024 * 1024;
const TAG = /^v?(\d+(?:\.\d+){0,3})$/;

// "v1.10" → [1, 10]; null for anything else
function versionNumbers(text) {
    const m = TAG.exec(String(text ?? '').trim());
    return m ? m[1].split('.').map(Number) : null;
}

// Whether version a is newer than version b (both from versionNumbers)
function isNewer(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y)
            return x > y;
    }
    return false;
}

const isCancelled = e => e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

// The release installed by "Update" in this session, plain data only: the
// card says "log out" instead of offering it again. Kept while the panel is
// taken down on screen lock, forgotten in disable().
let installedTag = null;

export function forgetInstalledVersion() {
    installedTag = null;
}

export class VersionCheck {
    // version: the version-name of our metadata.json
    constructor(settings, version) {
        this._settings = settings;
        this._version = version ?? '';
        this._current = versionNumbers(this._version);
        this._cancellable = new Gio.Cancellable();
        this._session = null;
        this._checking = false;
        // null, 'download', 'install' or {error}
        this._update = null;
        this._listeners = new Set();
    }

    destroy() {
        this._cancellable.cancel();
        this._session?.abort();
        this._session = null;
        this._listeners.clear();
    }

    // The piece at the bottom of the list of our settings; showing it is
    // what starts a check, when one is due.
    // openPage(url): opens a page in the browser (and closes the panel).
    // Built once and changed in place: "Update" is never destroyed by its
    // own click.
    buildNotice(openPage) {
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const line = new St.Label({
            style_class: 'sch-set-description sch-version-line',
            x_align: Clutter.ActorAlign.CENTER,
        });
        const row = kit.row({icon: 'software-update-available-symbolic', wrap: true});
        const update = kit.button({label: _('Update'), primary: true, onClick: () => this._install(this._newerTag())});
        const card = kit.card(row, kit.buttons(
            kit.button({label: _('What’s new'), onClick: () => openPage(RELEASE_PAGE(this._newerTag()))}),
            update));
        box.add_child(line);
        box.add_child(card);
        const sync = () => this._fill({line, card, row, update});
        this._listeners.add(sync);
        box.connect('destroy', () => this._listeners.delete(sync));
        sync();
        this._checkIfDue();
        return box;
    }

    _changed() {
        for (const sync of [...this._listeners])
            sync();
    }

    // The newest release found, when it is newer than ours: its tag
    _newerTag() {
        if (!this._settings.get_boolean('check-new-versions'))
            return null;
        const tag = this._settings.get_string('version-latest');
        const found = versionNumbers(tag);
        return found && this._current && isNewer(found, this._current) ? tag : null;
    }

    _fill({line, card, row, update}) {
        const tag = this._newerTag();
        line.visible = !tag && this._version !== '';
        card.visible = !!tag;
        if (!tag) {
            // "up to date" only once GitHub has answered
            const known = this._settings.get_boolean('check-new-versions') && this._current &&
                versionNumbers(this._settings.get_string('version-latest'));
            line.text = known
                ? _('Version {version} · up to date', {version: this._version})
                : _('Version {version}', {version: this._version});
            return;
        }

        const state = installedTag === tag ? 'done' : this._update;
        let subtitle = _('You have version {version}', {version: this._version});
        if (state === 'download')
            subtitle = _('Downloading…');
        else if (state === 'install')
            subtitle = _('Installing…');
        else if (state === 'done')
            subtitle = _('Log out and back in to use the new version');
        else if (state?.error)
            subtitle = _('The update did not work: {error}', {error: state.error});
        row.titleLabel.text = _('Smart Calendar Hub {version} is available', {version: tag.replace(/^v/, '')});
        row.subtitleLabel.text = subtitle;
        update.setSensitive(state !== 'download' && state !== 'install');
        update.visible = state !== 'done';
    }

    // One request to GitHub, at most once a day
    async _checkIfDue() {
        if (this._checking || !this._settings.get_boolean('check-new-versions') || !this._current)
            return;
        const now = Math.floor(Date.now() / 1000);
        const last = this._settings.get_int64('version-checked-at');
        // a time in the future (a clock set back) counts as due
        if (last > 0 && last <= now && now - last < DAY_S)
            return;
        this._checking = true;
        // set before asking: a failed request is not repeated within the day
        this._settings.set_int64('version-checked-at', now);
        try {
            const release = JSON.parse(new TextDecoder().decode(
                await this._get(LATEST_URL, 'application/vnd.github+json')));
            const tag = String(release?.tag_name ?? '');
            // a release counts only with our zip attached
            const complete = (release?.assets ?? []).some(asset => asset?.name === ASSET);
            if (!versionNumbers(tag) || !complete || release.draft || release.prerelease)
                throw new Error(`no usable release (${tag || 'no tag'})`);
            if (this._settings.get_string('version-latest') !== tag)
                this._settings.set_string('version-latest', tag);
        } catch (e) {
            if (isCancelled(e))
                return;
            logWarning(`cannot check for a new version: ${e.message}`);
        } finally {
            this._checking = false;
        }
        this._changed();
    }

    // The body of a GET, as a Uint8Array
    async _get(url, accept) {
        this._session ??= new Soup.Session({timeout: 30, user_agent: USER_AGENT});
        const message = Soup.Message.new('GET', url);
        message.request_headers.append('Accept', accept);
        const bytes = await this._session.send_and_read_async(message,
            GLib.PRIORITY_DEFAULT, this._cancellable);
        if (message.get_status() !== Soup.Status.OK)
            throw new Error(`HTTP ${message.get_status()}`);
        const data = bytes.get_data() ?? new Uint8Array();
        if (data.length > MAX_BYTES)
            throw new Error('the answer is too large');
        return data;
    }

    // "Update": the zip of release `tag` from our repository, installed for
    // this user with gnome-extensions
    async _install(tag) {
        if (!tag || this._update === 'download' || this._update === 'install')
            return;
        const dir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), 'smart-calendar-hub']));
        const zip = dir.get_child(ASSET);
        const cancellable = this._cancellable;
        let written = false;
        const step = state => {
            this._update = state;
            if (!cancellable.is_cancelled())
                this._changed();
        };
        try {
            step('download');
            const data = await this._get(ASSET_URL(tag), 'application/octet-stream');
            // a zip starts with "PK"
            if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b)
                throw new Error(_('the download is not a zip file'));
            try {
                await dir.make_directory_async(GLib.PRIORITY_DEFAULT, cancellable);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                    throw e;
            }
            written = true;
            await zip.replace_contents_bytes_async(new GLib.Bytes(data), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable);

            step('install');
            const program = GLib.find_program_in_path('gnome-extensions');
            if (!program)
                throw new Error(_('the gnome-extensions program is missing'));
            // gnome-extensions unpacks into its cache folder and moves the
            // result into the extensions folder: a folder cannot be moved
            // from one disk to another, so its cache is put next to the
            // extensions (a separate ~/.cache would make the install fail)
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            launcher.setenv('XDG_CACHE_HOME', GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell']), true);
            const proc = launcher.spawnv([program, 'install', '--force', zip.get_path()]);
            // never killed when the panel goes: the install is short and must
            // not stop halfway; only the wait for it is cancelled
            const [, stderr] = await proc.communicate_utf8_async(null, cancellable);
            if (!proc.get_successful())
                throw new Error(stderr?.trim() || `gnome-extensions ${proc.get_exit_status()}`);
            installedTag = tag;
            step(null);
        } catch (e) {
            if (isCancelled(e))
                return;
            logError(`cannot update to ${tag}: ${e.message}`);
            step({error: e.message});
        } finally {
            // the zip is not needed any more, also after a failure (not while
            // gnome-extensions may still be reading it: then it stays in the
            // cache and the next update writes over it)
            if (written && !cancellable.is_cancelled())
                zip.delete_async(GLib.PRIORITY_DEFAULT, null).catch(() => {});
        }
    }
}
